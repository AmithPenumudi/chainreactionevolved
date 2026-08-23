import { GameSettings } from "@/game/settings";

let ctx: AudioContext | null = null;

/** Minimum gap (seconds) between successive explosion sounds to prevent audio clipping. */
const EXPLODE_THROTTLE_S = 0.07;
let lastExplodeTime = -Infinity;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Short, soft synthesized blip. Respects master + sfx settings and volume. */
export function playSfx(settings: GameSettings, kind: "place" | "explode") {
  if (!settings.masterSound || !settings.soundEffects) return;
  const audio = getCtx();
  if (!audio) return;

  const now = audio.currentTime;

  // Throttle rapid-fire explosion sounds to prevent audio clipping / distortion
  // during large chain reactions where many cells fire almost simultaneously.
  if (kind === "explode") {
    if (now - lastExplodeTime < EXPLODE_THROTTLE_S) return;
    lastExplodeTime = now;
  }

  const gain = audio.createGain();
  const osc = audio.createOscillator();
  const vol = (settings.sfxVolume / 100) * (kind === "place" ? 0.06 : 0.09);
  const freq = kind === "place" ? 420 : 180;
  osc.type = kind === "place" ? "sine" : "triangle";
  osc.frequency.setValueAtTime(freq, now);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.6, now + 0.12);
  gain.gain.setValueAtTime(vol, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
  osc.connect(gain).connect(audio.destination);
  osc.start();
  osc.stop(now + 0.18);
}
