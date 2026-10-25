// Source/configuration regression checks. Never launches the desktop app or reads stored credentials.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const read = file => fs.readFileSync(file, "utf8");
const config = JSON.parse(read("src-tauri/tauri.conf.json"));
for (const key of ["csp", "devCsp"]) {
  const directives = new Map(config.app.security[key].split(";").map(text => text.trim().split(/\s+/)).filter(parts => parts[0]).map(([key,...sources]) => [key,sources]));
  assert.deepEqual(directives.get("script-src"), ["'self'"], "Frontend scripts must stay local, with no inline/eval/network allowance");
  for (const key of ["object-src", "base-uri", "form-action"]) assert.deepEqual(directives.get(key), ["'none'"]);
  assert.deepEqual(directives.get("frame-src"), ["'self'"]);
  for (const sources of directives.values()) assert(!sources.includes("*"), "No unrestricted CSP origins");
}
const capability = JSON.parse(read("src-tauri/capabilities/default.json"));
assert.deepEqual(capability.windows, ["main"]);
assert(!capability.remote, "No remote origins may invoke native commands");
assert(capability.permissions.includes("main-window-commands"));
const backend = read("src-tauri/src/lib.rs");
const cycleImport = backend.split("async fn import_marble_cycle_results(")[1].split("\nfn reset_stats_totals(")[0];
assert(!cycleImport.includes("include_br_wins"), "Historical BR wins must always import as cycle first places");
assert(cycleImport.includes('result.raw_data.insert("MarbleCycleBrWinsAsFirst".into(), "true".into())'));
const cycleDownload = read("src-tauri/src/marble_cycle.rs");
assert(cycleDownload.includes("const MAX_SESSION_BYTES: u64 = 100 * 1024 * 1024;"));
assert(cycleDownload.includes("response.take(MAX_SESSION_BYTES + 1)"));
assert(cycleDownload.includes("bytes.len() as u64 > MAX_SESSION_BYTES"));
assert(cycleDownload.includes("Session exceeds the 100 MB import limit"));
assert(!read("src/marble-cycle-import.ts").includes("data-br-wins"), "BR-win inclusion has no opt-out checkbox");
const registered = backend.split(".invoke_handler(tauri::generate_handler![")[1].split("])")[0].trim().split(/,\s*/).filter(Boolean).map(name => name.trim().split("::").at(-1)).sort();
const permissions = read("src-tauri/permissions/main-window.toml");
const granted = [...permissions.split("commands.allow = [")[1].split("]")[0].matchAll(/"([a-z_]+)"/g)].map(match => match[1]).sort();
assert.deepEqual(granted, registered, "Every native command needs explicit review in the main-window allowlist");
for (const file of fs.readdirSync("src-tauri/capabilities")) {
  if (!file.endsWith(".json")) continue;
  const cap = JSON.parse(read(path.join("src-tauri/capabilities", file)));
  assert(!cap.remote && !cap.windows?.includes("*"), "Capabilities cannot expose native commands to remote or wildcard windows");
}
const helper = read("src-tauri/src/windows-update-helper.ps1");
assert(helper.includes("Get-FileHash -LiteralPath $path -Algorithm SHA256"));
assert(helper.includes("Verify-Executable $resolvedDownload"));
assert(helper.indexOf("Verify-Executable $target") >= 0 && helper.indexOf("Verify-Executable $target") < helper.indexOf('Open-App "--marbles-update-token=$token"'), "Verify the installed bytes before opening the update");
assert(read("src-tauri/src/updater.rs").includes('crate::secure_token::generate()?'), "Updater nonces must use the OS RNG");
assert(read("src-tauri/src/secure_token.rs").includes("BCryptGenRandom"));
for (const name of ["twitch.rs", "lumia.rs", "discord_credentials.rs"]) {
  const source = read("src-tauri/src/" + name).split("#[cfg(test)]")[0];
  assert(source.includes("CredentialBlob.is_null()") && source.includes("CredentialBlobSize == 0"), "Malformed saved credentials must be rejected before unsafe reads");
  const credentialReader = source.split("fn load_credential(")[1].split("fn delete_credential(")[0];
  assert(!/map_err\(\|error\||map_err\(\|e\|/.test(credentialReader), "Saved credential parse errors must not include decoded secret contents");
}
assert(read("src-tauri/src/streamer_bot.rs").includes("redirect(reqwest::redirect::Policy::none())"), "Local action requests must not redirect elsewhere");
const dropgate = fs.readFileSync("public/streamdeck/com.mosdropgate.plugin.streamDeckPlugin");
assert.equal(crypto.createHash("sha256").update(dropgate).digest("hex"), "ad384d1bce511a518d7875906bd739e526231de538ba32b5a4e1b02ce3889863", "A new bundled Drop Gate package needs its own source/provenance review");
for (const file of ["checks.yml", "release.yml"]) {
  const workflow = read(".github/workflows/" + file);
  for (const match of workflow.matchAll(/uses:\s+([^\s#]+)/g)) assert(/@[a-f0-9]{40}$/.test(match[1]), "Third-party actions must be pinned to immutable commits");
  assert(workflow.includes("persist-credentials: false"));
}
const release = read(".github/workflows/release.yml");
assert(!release.split("    steps:")[0].includes("GH_TOKEN"), "Publication credentials must not be job-wide build environment variables");
// Exercise real frontend renderers against adversarial CSV/imported/settings values.
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const source = read(file).replaceAll("import.meta.url", JSON.stringify(pathToFileURL(file).href));
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const req = name => name.startsWith(".") ? load(path.resolve(path.dirname(file), name + ".ts")) : require(name);
  vm.runInThisContext("(function(require,module,exports){" + js + "\n})", { filename: file })(req, module, module.exports);
  return module.exports;
}
const { renderApplication } = load("src/views.ts");
const attack = '\"><img src=x onerror=alert(1)>';
const player = { playerName: attack, username: "racer", displayName: attack, platform: "Twitch", nameColorHex: 'fff;background:url(https://attacker.invalid/)', placement: 1, seasonPointsEarned: 10, rawData: {} };
const game = { id: "sample", timestamp: "2026-10-17T12:00:00Z", gameType: "race", playerCount: 1, results: [player], mapName: attack, hasWorldRecord: false };
const state = { latestResult: game, recentResults: [game], sessionResults: [], raceCycles: [], cycleHistory: [], eventResultIds: [], totalRaceCount: 1, totalBattleRoyaleCount: 0, totalCycleRaceCount: 0, seasonPointsEarned: 10, session: { gamesPlayed: 0 }, logs: [{timestamp:game.timestamp,level:"warning",message:attack}], watcherStatus: "Stopped", streamerBotStatus: "Disabled", twitchStatus: "Disconnected", config: { csv: { path: attack }, seasons: { raceName: attack }, streamerBot: { enabled:false,events:{},actions:{} }, twitch: {messagePrefix:"Results",cycleMessageTemplate:"{player} {cycle}"} } };
for (const page of ["overview", "history", "logs", "settings", "overlays"]) {
  const html = renderApplication(state, page, false, "all", {key:"cycles",direction:"desc"}, false, undefined, attack);
  assert(!html.includes("<img src=x"), "Untrusted text must never become markup on " + page);
  assert(!html.includes("background:url(https://attacker.invalid/)"), "CSV color fields must not become arbitrary CSS");
}
for (const color of ["a1b2c3", "A1B2C3FF"]) {
  player.nameColorHex = color;
  assert(renderApplication(state,"overview",false,"all",{key:"cycles",direction:"desc"}).includes("--player-color:#" + color), "Valid Marbles RGB/RGBA colors must keep working");
}
console.log("Security regression checks passed: CSP, main-window command allowlist, updater integrity/nonce policy, safe credential reads, immutable CI actions, bundled plugin hash and adversarial frontend rendering.");
