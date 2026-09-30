/**
 * Builds the signed Android App Bundle to upload to Play.
 *
 *   npm run release:android
 *
 * Play takes an .aab, not an .apk, and the APK the smoke test uses is debug-signed, so this is
 * a different artifact from anything else in the project. It runs the whole chain — web assets,
 * cap sync, gradle bundleRelease — then verifies the result is actually signed, because an
 * unsigned bundle builds perfectly happily and is only rejected once you reach the Console.
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const androidDir = join(root, "android");
const aab = join(androidDir, "app/build/outputs/bundle/release/app-release.aab");
const isWindows = process.platform === "win32";

function run(command, args, cwd = root) {
  const line = [command, ...args].join(" ");
  console.log(`\n> ${line}`);
  // execSync rather than execFileSync-with-shell: npm, npx and gradlew are all shell scripts or
  // .bat files on Windows and cannot be spawned directly, and passing an args array alongside
  // `shell: true` is deprecated. Every part here is a literal in this file, never input.
  execSync(line, { cwd, stdio: "inherit" });
}

// ------------------------------------------------------------- preflight

if (!existsSync(join(androidDir, "keystore/keystore.properties"))) {
  console.error(
    "\nandroid/keystore/keystore.properties is missing, so the bundle would build UNSIGNED\n" +
      "and Play would reject it. That file and the keystore beside it are deliberately not in\n" +
      "git — restore them from your backup before releasing.",
  );
  process.exit(1);
}

const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const versionCode = /^versionCode=(\d+)$/m.exec(
  readFileSync(join(androidDir, "version.properties"), "utf8"),
)?.[1];
console.log(`Building Chain Reaction: Evolved ${version} (versionCode ${versionCode})`);

// ------------------------------------------------------------- build

run("npm", ["run", "build:capacitor"]);
run("npx", ["cap", "sync", "android"]);
// The wrapper must be spelled relative: cmd.exe does not search the working directory for a
// bare `gradlew.bat`, and an absolute path cannot be used here because `shell: true` does not
// quote it and the project path contains a space.
run(isWindows ? ".\\gradlew.bat" : "./gradlew", ["bundleRelease", "--console=plain"], androidDir);

// ------------------------------------------------------------- verify

if (!existsSync(aab)) {
  console.error(`\nGradle reported success but ${aab} is not there.`);
  process.exit(1);
}

// jarsigner ships with the JDK that just built this, so it is always available here.
const jarsigner = process.env.JAVA_HOME
  ? join(process.env.JAVA_HOME, "bin", isWindows ? "jarsigner.exe" : "jarsigner")
  : "jarsigner";

let signedBy = "";
try {
  const out = execFileSync(jarsigner, ["-verify", "-verbose:summary", "-certs", aab], {
    encoding: "utf8",
  });
  // The self-signed and no-timestamp warnings are normal and expected for an Android upload
  // key; the only thing that matters is that it verified and who signed it.
  if (!/jar verified/i.test(out)) throw new Error("jarsigner did not report the bundle verified");
  signedBy = /- Signed by "([^"]+)"/.exec(out)?.[1] ?? "unknown";
} catch (error) {
  console.error(`\nCould not confirm the bundle is signed: ${error.message}`);
  console.error("Do not upload it. Check android/keystore/keystore.properties.");
  process.exit(1);
}

const mb = (statSync(aab).size / 1024 / 1024).toFixed(1);
console.log(`\n${aab}`);
console.log(`  ${mb} MB, signed by ${signedBy}`);
console.log(`  version ${version}, versionCode ${versionCode}`);
console.log("\nUpload this to the Play Console. See RELEASE.md for the rest of the checklist.");
