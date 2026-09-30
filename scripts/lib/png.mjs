/**
 * A tiny raster toolkit: enough PNG encode/decode and drawing to generate the project's
 * artwork (social card, Play Store assets) with no image dependencies at all.
 *
 * Deliberately dependency-free. These assets are regenerated rarely, usually long after
 * anyone last thought about the toolchain, and a build script that still runs in five years
 * is worth more than one that is clever.
 *
 * Scope: 8-bit, non-interlaced PNGs, colour types 0/2/4/6. That covers everything this
 * project produces or reads. Anything else throws rather than silently rendering wrongly.
 */
import { deflateSync, inflateSync } from "node:zlib";

// ---------------------------------------------------------------- colour

/**
 * oklch -> sRGB [r,g,b] 0-255, matching the values declared in src/styles.css so generated
 * artwork and the running app agree on the palette.
 */
export function oklch(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  });
}

/** "#rrggbb" -> [r,g,b]. */
export function hex(value) {
  const n = parseInt(value.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------- canvas

export class Canvas {
  constructor(width, height, background = [0, 0, 0]) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 3);
    this.fill(background);
  }

  fill(rgb) {
    for (let i = 0; i < this.width * this.height; i++) {
      this.data[i * 3] = rgb[0];
      this.data[i * 3 + 1] = rgb[1];
      this.data[i * 3 + 2] = rgb[2];
    }
  }

  blend(x, y, rgb, alpha) {
    if (alpha <= 0 || x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const a = Math.min(1, alpha);
    const i = (y * this.width + x) * 3;
    for (let c = 0; c < 3; c++) {
      this.data[i + c] = Math.round(this.data[i + c] * (1 - a) + rgb[c] * a);
    }
  }

  /** Anti-aliased filled circle, feathered over one pixel at the edge. */
  disc(cx, cy, r, rgb, alpha = 1) {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const cov = Math.min(1, Math.max(0, r + 0.5 - d));
        if (cov > 0) this.blend(x, y, rgb, cov * alpha);
      }
    }
  }

  /** Soft radial glow, falling off quadratically to nothing at `r`. */
  glow(cx, cy, r, rgb, strength) {
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(this.height - 1, cy + r); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(this.width - 1, cx + r); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
        if (d < 1) this.blend(x, y, rgb, (1 - d) ** 2 * strength);
      }
    }
  }

  hLine(x0, x1, y, rgb, alpha) {
    for (let x = Math.max(0, x0); x <= Math.min(this.width - 1, x1); x++) {
      this.blend(x, y, rgb, alpha);
    }
  }

  vLine(x, y0, y1, rgb, alpha) {
    for (let y = Math.max(0, y0); y <= Math.min(this.height - 1, y1); y++) {
      this.blend(x, y, rgb, alpha);
    }
  }

  /** Darkens the corners so the subject lifts off the background. */
  vignette(start = 0.45, strength = 0.55, reach = 1.25) {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const dx = (x - this.width / 2) / (this.width / 2);
        const dy = (y - this.height / 2) / (this.height / 2);
        const d = Math.min(1, Math.hypot(dx, dy) / reach);
        if (d > start) this.blend(x, y, [0, 0, 0], (d - start) * strength);
      }
    }
  }

  /**
   * Draws a decoded image scaled into the rectangle (dx, dy, dw, dh), sampling bilinearly and
   * honouring the source alpha. Source pixels outside the image are skipped, so a source
   * rectangle may legitimately hang off the edge — that is how the adaptive-icon crop works.
   */
  drawImage(img, dx, dy, dw, dh, { sx = 0, sy = 0, sw = img.width, sh = img.height } = {}) {
    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        // Sample at the centre of the destination pixel.
        const u = sx + ((x + 0.5) / dw) * sw - 0.5;
        const v = sy + ((y + 0.5) / dh) * sh - 0.5;
        const x0 = Math.floor(u);
        const y0 = Math.floor(v);
        const fx = u - x0;
        const fy = v - y0;

        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (const [ox, oy, w] of [
          [0, 0, (1 - fx) * (1 - fy)],
          [1, 0, fx * (1 - fy)],
          [0, 1, (1 - fx) * fy],
          [1, 1, fx * fy],
        ]) {
          const px = Math.min(img.width - 1, Math.max(0, x0 + ox));
          const py = Math.min(img.height - 1, Math.max(0, y0 + oy));
          const i = (py * img.width + px) * 4;
          const pa = img.data[i + 3] / 255;
          // Weight colour by alpha so fully transparent pixels contribute no colour —
          // otherwise the black behind a transparent edge bleeds into the result.
          r += img.data[i] * pa * w;
          g += img.data[i + 1] * pa * w;
          b += img.data[i + 2] * pa * w;
          a += pa * w;
        }
        if (a <= 0) continue;
        this.blend(dx + x, dy + y, [r / a, g / a, b / a], a);
      }
    }
  }
}

// ---------------------------------------------------------------- PNG

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Encodes a Canvas as an 8-bit PNG.
 *
 * `alpha: true` writes a fully opaque RGBA image rather than RGB. The pixels are identical
 * either way; it exists because the Play Console's icon slot expects a 32-bit PNG.
 */
export function encodePNG(canvas, { alpha = false } = {}) {
  const { width, height, data } = canvas;
  const channels = alpha ? 4 : 3;

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = alpha ? 6 : 2; // colour type: truecolour, with alpha or without
  // 10-12 (compression, filter, interlace) stay 0.

  // Each scanline carries a leading filter byte; None is plenty for flat artwork.
  const raw = Buffer.alloc(height * (width * channels + 1));
  for (let y = 0; y < height; y++) {
    const at = y * (width * channels + 1);
    raw[at] = 0;
    if (alpha) {
      for (let x = 0; x < width; x++) {
        const src = (y * width + x) * 3;
        const dst = at + 1 + x * 4;
        raw[dst] = data[src];
        raw[dst + 1] = data[src + 1];
        raw[dst + 2] = data[src + 2];
        raw[dst + 3] = 255;
      }
    } else {
      Buffer.from(data.buffer, y * width * 3, width * 3).copy(raw, at + 1);
    }
  }

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Decodes an 8-bit non-interlaced PNG to { width, height, data } with data as RGBA. */
export function decodePNG(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");

  let width = 0;
  let height = 0;
  let colourType = 0;
  const idat = [];

  let at = 8;
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString("ascii", at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      colourType = body[9];
      if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);
      if (body[12] !== 0) throw new Error("interlaced PNGs are not supported");
      if (![0, 2, 4, 6].includes(colourType)) {
        throw new Error(`unsupported colour type ${colourType} (palettes are not supported)`);
      }
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    at += 12 + length;
  }

  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colourType];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const line = new Uint8Array(stride);
  const prev = new Uint8Array(stride);

  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    for (let i = 0; i < stride; i++) {
      const x = raw[pos + i];
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let value;
      if (filter === 0) value = x;
      else if (filter === 1) value = x + a;
      else if (filter === 2) value = x + b;
      else if (filter === 3) value = x + ((a + b) >> 1);
      else if (filter === 4) value = x + paeth(a, b, c);
      else throw new Error(`unknown scanline filter ${filter}`);
      line[i] = value & 255;
    }
    pos += stride;

    for (let x = 0; x < width; x++) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      if (colourType === 6 || colourType === 2) {
        out[dst] = line[src];
        out[dst + 1] = line[src + 1];
        out[dst + 2] = line[src + 2];
        out[dst + 3] = colourType === 6 ? line[src + 3] : 255;
      } else {
        // Greyscale, with or without alpha.
        out[dst] = line[src];
        out[dst + 1] = line[src];
        out[dst + 2] = line[src];
        out[dst + 3] = colourType === 4 ? line[src + 1] : 255;
      }
    }
    prev.set(line);
  }

  return { width, height, data: out };
}
