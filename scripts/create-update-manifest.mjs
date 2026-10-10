import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const repository = "smolpuff/northKoreaStatsAndCycles";

export function createManifest(bytes, version, name = "marbles-stats.exe") {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Version must be major.minor.patch.");
  if (!/^[a-zA-Z0-9._-]+\.exe$/.test(name)) throw new Error("Use an EXE asset filename.");
  if (bytes.length < 64 || bytes.toString("ascii", 0, 2) !== "MZ") throw new Error("Invalid Windows executable.");
  const offset = bytes.readUInt32LE(60);
  if (offset < 64 || offset + 24 > bytes.length || bytes.readUInt32LE(offset) !== 0x4550) throw new Error("Invalid PE header.");
  const arch = { 0x8664: "x64", 0xaa64: "arm64" }[bytes.readUInt16LE(offset + 4)];
  if (!arch) throw new Error("Only Windows x64 and ARM64 updates are supported.");
  return {
    schemaVersion: 1, version,
    artifacts: { [`win32-${arch}`]: {
      url: `https://github.com/${repository}/releases/download/v${version}/${name}`,
      size: bytes.length,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    } },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const read = name => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
  const { version } = read("version.json");
  const cargoPackage = fs.readFileSync(path.join(root, "src-tauri/Cargo.toml"), "utf8").split(/^\[package\]\s*$/m)[1]?.split(/^\[/m)[0];
  const cargoVersion = cargoPackage?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (read("package.json").version !== version || read("src-tauri/tauri.conf.json").version !== version ||
      cargoVersion !== version) {
    throw new Error("Set the same version in version.json, package.json, Cargo.toml and tauri.conf.json before publishing.");
  }
  const exe = path.resolve(process.argv[2] ?? path.join(root, "src-tauri/target/release/marbles-stats.exe"));
  const output = path.resolve(process.argv[3] ?? path.join(path.dirname(exe), "desktop-update.json"));
  const manifest = createManifest(fs.readFileSync(exe), version, path.basename(exe));
  fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Created ${output} for v${version}. Upload it and ${path.basename(exe)} to release v${version}.`);
}
