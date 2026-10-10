import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { repository } from "./create-update-manifest.mjs";

export const versionFiles = ["package.json", "package-lock.json", "version.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"];
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const developmentBranch = "dev";

export function normalizeVersion(value) {
  const version = /^\d+\.\d+$/.test(value) ? `${value}.0` : value;
  if (!semver.test(version) || !version.split(".").map(Number).every(Number.isSafeInteger)) throw new Error("Version must be major.minor.patch (or major.minor) with safe integer parts.");
  return version;
}

function newerVersion(candidate, previous) {
  const next = candidate.split(".").map(Number);
  const old = previous.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    if (next[index] !== old[index]) return next[index] > old[index];
  }
  return false;
}

export function unreleasedNotes(root = projectRoot) {
  if (!fs.existsSync(path.join(root, "CHANGELOG.md"))) return [];
  const text = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  const section = text.match(/^## Unreleased\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1] ?? "";
  return section.split(/\r?\n/).filter(line => /^-\s+/.test(line)).map(line => line.replace(/^-\s+/, "").trim()).filter(Boolean);
}

export function releaseChangelog(text, version, notes, date = new Date()) {
  const heading = /^## Unreleased[^\r\n]*\r?\n[\s\S]*?(?=^## |$(?![\s\S]))/m;
  if (!heading.test(text)) throw new Error("CHANGELOG.md must have an Unreleased section.");
  if (text.includes(`## ${version} -`)) throw new Error(`CHANGELOG.md already contains ${version}.`);
  const day = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  return text.replace(heading, `## Unreleased\n\n## ${version} - ${day}\n\n${notes.map(note => `- ${note}`).join("\n")}\n\nValidation: release-script checks are recorded in the preceding development commit. GitHub build/tests and download verification are pending. No application was compiled or launched locally.\n\n`);
}

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

export function prepareRelease(root = projectRoot, kind = "patch", notes = [], exactVersion) {
  const { version: previous, contents } = readVersions(root);
  const version = exactVersion ? normalizeVersion(exactVersion) : bumpVersion(previous, kind);
  if (!newerVersion(version, previous)) throw new Error(`Release ${version} must be newer than ${previous}.`);
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
  const options = { bump: "patch", notes: [], dryRun: false, check: false, tag: undefined, version: undefined };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--check") options.check = true;
    else if (["--bump", "--version", "--notes", "--notes-file", "--tag"].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}.`);
      if (arg === "--bump") options.bump = value;
      if (arg === "--version") options.version = normalizeVersion(value);
      if (arg === "--tag") options.tag = value;
      if (arg === "--notes") options.notes.push(value);
      if (arg === "--notes-file") options.notes.push(...fs.readFileSync(value, "utf8").split(/\r?\n/).map(line => line.trim()).filter(Boolean));
    } else throw new Error(`Unknown option ${arg}. Use --version, --bump patch|minor|major, --notes, --notes-file or --dry-run.`);
  }
  return options;
}

export function runRelease(args, root = projectRoot, gitRunner) {
  const options = parseArgs(args);
  if (options.check) {
    const { version } = readVersions(root);
    if (options.tag && options.tag !== `v${version}`) throw new Error(`Tag ${options.tag} does not match v${version}.`);
    console.log(`Version files agree: v${version}`);
    return;
  }
  if (!options.notes.length) options.notes = unreleasedNotes(root);
  const release = prepareRelease(root, options.bump, options.notes, options.version);
  if (options.dryRun) {
    console.log(`Dry run: ${release.previous} -> ${release.version}. Would promote the complete ${developmentBranch} project to main, update ${versionFiles.join(", ")} and the local changelog if present, commit version files, tag ${release.tag}, and atomically push ${developmentBranch} + main + tag to ${repository}. GitHub builds and publishes; nothing is written, committed, pushed or built locally.`);
    return;
  }
  const git = gitRunner ?? ((...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim());
  if (!options.notes.length || options.notes.some(note => !note.trim())) throw new Error("Add notes to your local CHANGELOG.md, or supply --notes / --notes-file before publishing. Local documentation is not included in Git.");
  if (git("branch", "--show-current") !== developmentBranch) throw new Error(`Run releases from ${developmentBranch}. Main is only updated by a release.`);
  if (git("status", "--porcelain")) throw new Error("Commit your app changes first. Releases require a clean working tree, including untracked files.");
  const remote = git("remote", "get-url", "--push", "origin");
  if (![ `https://github.com/${repository}.git`, `https://github.com/${repository}`, `git@github.com:${repository}.git`, `ssh://git@github.com/${repository}.git` ].includes(remote)) throw new Error(`origin must point to ${repository}.`);
  git("fetch", "origin", "+refs/heads/main:refs/remotes/origin/main", `+refs/heads/${developmentBranch}:refs/remotes/origin/${developmentBranch}`, "--tags");
  const remoteMain = git("rev-parse", "origin/main");
  const remoteDevelopment = git("rev-parse", `origin/${developmentBranch}`);
  for (const [branch, commit] of [["main", remoteMain], [developmentBranch, remoteDevelopment]]) {
    if (git("merge-base", "HEAD", commit) !== commit) throw new Error(`Remote ${branch} has changes missing from ${developmentBranch}. Merge them before releasing; nothing will be overwritten.`);
  }
  const mainVersion = normalizeVersion(JSON.parse(git("show", "origin/main:version.json")).version);
  if (!newerVersion(release.version, mainVersion)) throw new Error(`Release must be newer than main's ${mainVersion}.`);
  if (git("tag", "--list", release.tag)) throw new Error(`${release.tag} already exists.`);
  const changelogPath = path.join(root, "CHANGELOG.md");
  const changelog = fs.existsSync(changelogPath) ? releaseChangelog(fs.readFileSync(changelogPath, "utf8"), release.version, options.notes) : undefined;
  for (const [file, text] of Object.entries(release.changes)) fs.writeFileSync(path.join(root, file), text);
  if (changelog !== undefined) fs.writeFileSync(changelogPath, changelog);
  git("add", "--", ...versionFiles);
  git("commit", "-m", `Release ${release.tag}`, "-m",
    `Promote the complete ${developmentBranch} project to main and synchronize all six version files from ${release.previous} to ${release.version}.\n\nRelease notes:\n${options.notes.map(note => `- ${note}`).join("\n")}\n\nKeep changelog and working documentation local; publish user-facing notes through version.json and GitHub. GitHub builds and tests before publishing one Windows executable and its verified updater manifest. No local app build is performed.`);
  git("tag", "-a", release.tag, "-m", `Marbles Stats ${release.tag}`);
  console.log(`Pushing ${release.tag}. No local build is performed.`);
  try {
    git("push", "--atomic", "origin", `HEAD:refs/heads/${developmentBranch}`, "HEAD:refs/heads/main", `refs/tags/${release.tag}`);
  } catch (error) {
    throw new Error(`Push failed. The local release commit and ${release.tag} are retained on ${developmentBranch}. Fix the push error, then retry: git push --atomic origin HEAD:refs/heads/${developmentBranch} HEAD:refs/heads/main refs/tags/${release.tag}. Do not run another version bump.`, { cause: error });
  }
  const localMain = git("rev-parse", "main");
  if (git("merge-base", "HEAD", localMain) === localMain) {
    try { git("branch", "-f", "main", "HEAD"); }
    catch { console.log("The release push succeeded. Local main could not be moved (it may be checked out in another worktree); the dev checkout remains at the release."); }
  } else console.log("Remote main was released; local main has separate commits and was left untouched.");
  console.log(`GitHub is building ${release.tag}: https://github.com/${repository}/actions\nDownload after the workflow finishes: https://github.com/${repository}/releases/tag/${release.tag}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runRelease(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
