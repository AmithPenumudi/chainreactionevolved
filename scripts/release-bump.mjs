/**
 * Bumps the release version ahead of a Play upload.
 *
 *   npm run release:bump              # versionCode +1, versionName unchanged
 *   npm run release:bump -- patch     # ...and 1.0.0 -> 1.0.1
 *   npm run release:bump -- minor     # ...and 1.0.0 -> 1.1.0
 *   npm run release:bump -- major     # ...and 1.0.0 -> 2.0.0
 *   npm run release:bump -- 1.2.3     # ...and an exact versionName
 *
 * versionCode always increases: Play rejects an upload whose code is not strictly greater than
 * every code previously uploaded, and a number can never be reused — not even after you delete
 * a draft or a review rejects the build. So it is bumped on every run, including when only
 * versionCode changes (a rebuild of the same versionName is still a new upload).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
const versionPath = fileURLToPath(new URL("../android/version.properties", import.meta.url));

const arg = process.argv[2];

// --------------------------------------------------------------- versionName

const pkgRaw = readFileSync(pkgPath, "utf8");
const pkg = JSON.parse(pkgRaw);
const current = pkg.version;

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const parts = SEMVER.exec(current);
if (!parts) {
  console.error(`package.json version "${current}" is not a plain x.y.z semver; fix it first.`);
  process.exit(1);
}
let [major, minor, patch] = parts.slice(1).map(Number);

let nextVersion = current;
if (arg === "major") nextVersion = `${major + 1}.0.0`;
else if (arg === "minor") nextVersion = `${major}.${minor + 1}.0`;
else if (arg === "patch") nextVersion = `${major}.${minor}.${patch + 1}`;
else if (arg && SEMVER.test(arg)) nextVersion = arg;
else if (arg) {
  console.error(`Unrecognised argument "${arg}". Use major, minor, patch, or an exact x.y.z.`);
  process.exit(1);
}

// --------------------------------------------------------------- versionCode

const propsRaw = readFileSync(versionPath, "utf8");
const codeMatch = /^versionCode=(\d+)$/m.exec(propsRaw);
if (!codeMatch) {
  console.error("android/version.properties has no versionCode= line.");
  process.exit(1);
}
const nextCode = Number(codeMatch[1]) + 1;

// --------------------------------------------------------------- write

// Rewrite package.json by string replacement rather than re-serialising, so key order and
// formatting survive untouched — a reformatted package.json makes for an awful release diff.
if (nextVersion !== current) {
  const replaced = pkgRaw.replace(
    /("version"\s*:\s*)"[^"]+"/,
    (_m, prefix) => `${prefix}"${nextVersion}"`,
  );
  if (replaced === pkgRaw) {
    console.error("Could not rewrite the version field in package.json.");
    process.exit(1);
  }
  writeFileSync(pkgPath, replaced);
}

writeFileSync(versionPath, propsRaw.replace(/^versionCode=\d+$/m, `versionCode=${nextCode}`));

console.log(`versionName  ${current} -> ${nextVersion}`);
console.log(`versionCode  ${codeMatch[1]} -> ${nextCode}`);
console.log("\nNext: npm run release:android");
