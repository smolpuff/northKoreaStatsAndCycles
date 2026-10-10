import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import prettier from "prettier";
import { bumpVersion, prepareRelease, readVersions, runRelease, versionFiles } from "../scripts/release.mjs";
import { createManifest, repository } from "../scripts/create-update-manifest.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mosstats-release-test-"));
try {
  for (const file of versionFiles) {
    const target = path.join(temp, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target);
  }
  const before = Object.fromEntries(versionFiles.map(file => [file, fs.readFileSync(path.join(temp, file), "utf8")]));
  const { version } = readVersions(temp);
  const release = prepareRelease(temp, "patch", ["Release notes with literal `backticks`, $variables and quotes."]);
  assert.equal(release.version, bumpVersion(version));
  assert.equal(release.tag, `v${release.version}`);
  for (const file of versionFiles) assert.equal(fs.readFileSync(path.join(temp, file), "utf8"), before[file], "Preparing a release must not modify files");
  for (const [file, text] of Object.entries(release.changes)) fs.writeFileSync(path.join(temp, file), text);
  assert.equal(readVersions(temp).version, release.version);
  const update = JSON.parse(release.changes["version.json"]);
  assert.deepEqual(update.notes, ["Release notes with literal `backticks`, $variables and quotes."]);
  assert.equal(update.downloadUrl, `https://github.com/${repository}/releases/latest`);
  const oldLock = before["src-tauri/Cargo.lock"].replace(/(name = "marbles-stats"\r?\nversion = ")[^"]+/, '$1VERSION');
  const newLock = release.changes["src-tauri/Cargo.lock"].replace(/(name = "marbles-stats"\r?\nversion = ")[^"]+/, '$1VERSION');
  assert.equal(newLock, oldLock, "Dependency versions and checksums must not change");
  assert.deepEqual(JSON.parse(prepareRelease(temp).changes["version.json"]).notes, [], "Do not reuse old release notes");
  assert.equal(bumpVersion("1.2.9", "minor"), "1.3.0");
  assert.equal(bumpVersion("1.2.9", "major"), "2.0.0");
  for (const invalid of ["1.2", "v1.2.3", "01.2.3", "1.2.3-beta"]) assert.throws(() => bumpVersion(invalid));
  assert.throws(() => bumpVersion("1.2.3", "wrong"));
  const broken = JSON.parse(fs.readFileSync(path.join(temp, "src-tauri/tauri.conf.json"), "utf8"));
  broken.version = "9.9.9";
  fs.writeFileSync(path.join(temp, "src-tauri/tauri.conf.json"), JSON.stringify(broken));
  assert.throws(() => prepareRelease(temp), /disagree/);

  const exe = Buffer.alloc(256);
  exe.write("MZ"); exe.writeUInt32LE(64, 60); exe.writeUInt32LE(0x4550, 64); exe.writeUInt16LE(0x8664, 68);
  const manifest = createManifest(exe, release.version);
  assert.equal(manifest.artifacts["win32-x64"].url, `https://github.com/${repository}/releases/download/${release.tag}/marbles-stats.exe`);
  const current = versionFiles.map(file => fs.readFileSync(path.join(root, file), "utf8"));
  let output = "";
  const originalLog = console.log;
  try {
    console.log = text => { output += text; };
    runRelease(["--dry-run"]);
    assert.throws(() => runRelease(["--check", "--tag", "v9.9.9"]), /does not match/);
  } finally { console.log = originalLog; }
  assert(output.includes("nothing is written, committed, pushed or built locally"));
  assert.deepEqual(versionFiles.map(file => fs.readFileSync(path.join(root, file), "utf8")), current);
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8");
  await prettier.format(workflow, { parser: "yaml" });
  assert(workflow.includes('tags:\n      - "v*"'));
  assert(workflow.includes("--draft=false --latest"));
  assert(workflow.indexOf("desktop-update.json\n\n      - name: Publish") > workflow.indexOf("draft: true"));
  console.log("Release tooling passed: synchronized six-file bumps, unchanged Cargo dependencies, notes, dry-run without writes, updater asset URLs and workflow YAML.");
} finally {
  for (const file of versionFiles) fs.unlinkSync(path.join(temp, file));
  fs.rmdirSync(path.join(temp, "src-tauri"));
  fs.rmdirSync(temp);
}
