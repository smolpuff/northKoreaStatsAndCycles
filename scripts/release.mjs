import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { repository } from "./create-update-manifest.mjs";

export const versionFiles = ["package.json", "package-lock.json", "version.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"];
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function bumpVersion(version, kind = "patch") {
  if (!semver.test(version)) throw new Error("Version must be major.minor.patch.");
  if (!["patch", "minor", "major"].includes(kind)) throw new Error("Use patch, minor or major.");
  const parts = version.split(".").map(Number);
  const index = { major: 0, minor: 1, patch: 2 }[kind];
  parts[index]++;
  for (let next = index + 1; next < parts.length; next++) parts[next] = 0;
  if (!parts.every(Number.isSafeInteger)) throw new Error("Version is too large.");
  return parts.join(".");
}

function cargoPackage(text) {
  return text.match(/(\[package\][\s\S]*?)(?=\n\[|$)/)?.[1];
}

function lockedPackage(text) {
  return text.split(/(?=\[\[package\]\])/).find(block => /^name\s*=\s*"marbles-stats"\s*$/m.test(block));
}

export function readVersions(root = projectRoot) {
  const contents = Object.fromEntries(versionFiles.map(file => [file, fs.readFileSync(path.join(root, file), "utf8")]));
  const json = file => JSON.parse(contents[file]);
  const version = json("package.json").version;
  if (!semver.test(version)) throw new Error("Version must be major.minor.patch.");
  const values = [json("package-lock.json").version, json("package-lock.json").packages?.[""]?.version,
    json("version.json").version, json("src-tauri/tauri.conf.json").version,
    cargoPackage(contents["src-tauri/Cargo.toml"])?.match(/^version\s*=\s*"([^"]+)"/m)?.[1],
    lockedPackage(contents["src-tauri/Cargo.lock"])?.match(/^version\s*=\s*"([^"]+)"/m)?.[1]];
  if (values.some(value => value !== version)) throw new Error("Version files disagree. Synchronize package.json, both lockfiles, version.json, Cargo.toml and tauri.conf.json.");
  return { version, contents };
}

export function prepareRelease(root = projectRoot, kind = "patch", notes = []) {
  const { version: previous, contents } = readVersions(root);
  const version = bumpVersion(previous, kind);
  const changes = {};
  for (const file of versionFiles.filter(file => file.endsWith(".json"))) {
    const data = JSON.parse(contents[file]);
    data.version = version;
    if (file === "package-lock.json") data.packages[""].version = version;
    if (file === "version.json") {
      data.downloadUrl = `https://github.com/${repository}/releases/latest`;
      data.notes = notes;
    }
    changes[file] = JSON.stringify(data, null, 2) + "\n";
  }
  for (const [file, block] of [["src-tauri/Cargo.toml", cargoPackage(contents["src-tauri/Cargo.toml"])], ["src-tauri/Cargo.lock", lockedPackage(contents["src-tauri/Cargo.lock"])]]) {
    changes[file] = contents[file].replace(block, block.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`));
  }
  return { previous, version, tag: `v${version}`, changes };
}

function parseArgs(args) {
  const options = { bump: "patch", notes: [], dryRun: false, check: false, tag: undefined };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--check") options.check = true;
    else if (["--bump", "--notes", "--notes-file", "--tag"].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}.`);
      if (arg === "--bump") options.bump = value;
      if (arg === "--tag") options.tag = value;
      if (arg === "--notes") options.notes.push(value);
      if (arg === "--notes-file") options.notes.push(...fs.readFileSync(value, "utf8").split(/\r?\n/).map(line => line.trim()).filter(Boolean));
    } else throw new Error(`Unknown option ${arg}. Use --bump patch|minor|major, --notes, --notes-file or --dry-run.`);
  }
  return options;
}

export function runRelease(args) {
  const options = parseArgs(args);
  if (options.check) {
    const { version } = readVersions();
    if (options.tag && options.tag !== `v${version}`) throw new Error(`Tag ${options.tag} does not match v${version}.`);
    console.log(`Version files agree: v${version}`);
    return;
  }
  const release = prepareRelease(projectRoot, options.bump, options.notes);
  if (options.dryRun) {
    console.log(`Dry run: ${release.previous} -> ${release.version}. Would update ${versionFiles.join(", ")}, commit, tag ${release.tag}, and atomically push main + tag to ${repository}. GitHub builds and publishes; nothing is written, committed, pushed or built locally.`);
    return;
  }
  const git = (...args) => execFileSync("git", args, { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
  if (git("branch", "--show-current") !== "main") throw new Error("Run releases from main.");
  if (git("status", "--porcelain")) throw new Error("Commit your app changes first. Releases require a clean working tree, including untracked files.");
  const remote = git("remote", "get-url", "--push", "origin");
  if (![ `https://github.com/${repository}.git`, `https://github.com/${repository}`, `git@github.com:${repository}.git`, `ssh://git@github.com/${repository}.git` ].includes(remote)) throw new Error(`origin must point to ${repository}.`);
  git("fetch", "origin", "main", "--tags");
  if (git("merge-base", "HEAD", "FETCH_HEAD") !== git("rev-parse", "FETCH_HEAD")) throw new Error("Remote main has changes you have not incorporated. Pull/rebase before releasing.");
  if (git("tag", "--list", release.tag)) throw new Error(`${release.tag} already exists.`);
  for (const [file, text] of Object.entries(release.changes)) fs.writeFileSync(path.join(projectRoot, file), text);
  git("add", "--", ...versionFiles);
  git("commit", "-m", `Release ${release.tag}`);
  git("tag", "-a", release.tag, "-m", `Marbles Stats ${release.tag}`);
  console.log(`Pushing ${release.tag}. No local build is performed.`);
  try {
    git("push", "--atomic", "origin", "HEAD:refs/heads/main", `refs/tags/${release.tag}`);
  } catch (error) {
    throw new Error(`Push failed. The local release commit and ${release.tag} are retained. Fix the push error, then retry: git push --atomic origin HEAD:refs/heads/main refs/tags/${release.tag}. Do not run another version bump.`, { cause: error });
  }
  console.log(`GitHub is building ${release.tag}: https://github.com/${repository}/actions\nDownload after the workflow finishes: https://github.com/${repository}/releases/tag/${release.tag}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runRelease(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
