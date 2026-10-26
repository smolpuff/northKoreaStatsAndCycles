// Real browser UI behavior with mocked Twitch responses. No app or account access.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import WebSocket from "ws";
import vm from "node:vm";
import { createRequire } from "node:module";

const nodeRequire = createRequire(import.meta.url);
const loaded = new Map();
function loadView(file) {
  file = path.resolve(file);
  if (loaded.has(file)) return loaded.get(file).exports;
  const module = { exports: {} }; loaded.set(file, module);
  const text = fs.readFileSync(file, "utf8").replaceAll("import.meta.url", JSON.stringify(pathToFileURL(file).href));
  const code = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const require = name => name.startsWith(".") ? loadView(path.resolve(path.dirname(file), `${name}.ts`)) : nodeRequire(name);
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(require, module, module.exports);
  return module.exports;
}
const views = loadView("src/views.ts");
const discord = loadView("src/discord-view.ts");
const lumia = loadView("src/lumia-view.ts");
const main = fs.readFileSync("src/main.ts", "utf8");
const ast = ts.createSourceFile("main.ts", main, ts.ScriptTarget.Latest, true);
const stateDeclaration = ast.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []).find(node => node.name.getText(ast) === "state");
const snapshot = vm.runInNewContext(`(${stateDeclaration.initializer.getText(ast)})`, { ...views, ...discord, ...lumia });
snapshot.watcherStatus = "Stopped";
snapshot.config.autoUpdateCheckEnabled = false;
const names = new Set(["readSettingsForm", "refreshToggleSaveStatus", "saveSettingsConfig", "saveSettingsToggle", "bindSettingsForm", "syncFeatureSections", "runButtonAction", "applyButtonFeedback"]);
const declarations = new Set(["settingsToggleSaveQueue", "settingsToggleSavesPending", "pendingSettingsConfig", "settingsToggleSaveError", "settingsToggleSaved"]);
const selected = ast.statements.filter(node => ts.isFunctionDeclaration(node) ? names.has(node.name?.text) : ts.isVariableStatement(node) && node.declarationList.declarations.some(decl => declarations.has(decl.name.getText(ast))));
assert.equal(selected.length, names.size + declarations.size, "All actual settings handlers must be tested");
const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const functionSource = (file, name) => {
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  return source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(source).replace(/^export /, "");
};
const screens = Object.fromEntries(["settings", "twitch", "streamer", "discord", "lumia"].map(page => [page, views.renderApplication(snapshot, page, { stats: false, cycles: false }, "all", { key: "cycles", direction: "desc" })]));
let source = `async function testSettings() {
const fixtures = ${JSON.stringify(screens)};
let state = ${JSON.stringify(snapshot)};
let persisted = structuredClone(state.config);
const writes = []; const pending = []; let failNext = false;
let themeSaveInProgress = false, themeSaveError = "", currentPage = "settings";
const buttonFeedback = new Map();
const discordEvents = ${JSON.stringify(discord.discordEvents)};
const defaultPromotionMessage = ${JSON.stringify(views.defaultPromotionMessage)};
const defaultWorldRecordMessage = ${JSON.stringify(views.defaultWorldRecordMessage)};
const normalizeTheme = value => value;
const bindUpdateSettings = () => {}; const applyTheme = () => {};
const raceMessageIsCustomized = () => false; const twitchMessageIsCustomized = () => false; const discordPreview = () => "";
const icons = {}; const escapeHtml = value => value;
const defaultLumiaConfig = () => (${JSON.stringify(lumia.defaultLumiaConfig())});
const defaultDiscordConfig = () => (${JSON.stringify(discord.defaultDiscordConfig())});
const invoke = async (command, args) => {
  if (command !== "save_config") throw Error("Unexpected command: " + command);
  writes.push(structuredClone(args.config));
  await new Promise(resolve => pending.push(resolve));
  if (failNext) { failNext = false; throw Error("Disk write failed"); }
  persisted = structuredClone(args.config);
  return { ...state, config: structuredClone(persisted) };
};
${transpile(functionSource("src/discord-view.ts", "readDiscordSettings"))}
${transpile(functionSource("src/lumia-view.ts", "readLumiaSettings"))}
${transpile(selected.map(node => node.getText(ast)).join("\n"))}
function render() {
  if (pendingSettingsConfig) state.config = pendingSettingsConfig;
  refreshToggleSaveStatus();
}
function page(name) {
  currentPage = name;
  document.getElementById("fields").innerHTML = fixtures[name];
  bindSettingsForm();
}
const check = (value, message) => { if (!value) throw Error(message); };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function toggle(id) {
  const input = document.getElementById(id);
  check(input && !input.disabled, "Toggle must be enabled: " + id);
  input.checked = !input.checked;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
async function finish() { await tick(); check(pending.length === 1, "One serialized save must be pending at " + window.testProgress + "/" + currentPage); pending.shift()(); await settingsToggleSaveQueue; }
// Every actual checkbox on all five pages must invoke native persistence immediately.
for (const name of Object.keys(fixtures)) {
  page(name);
  // Enable the master first so its event toggles can be tested as well.
  const master = document.querySelector(".connection-enable-toggle input");
  if (master && !master.checked) { toggle(master.id); await finish(); }
  for (const id of [...document.querySelectorAll('#settings-form input[type="checkbox"]')].filter(input => !input.disabled).map(input => input.id)) {
    window.testProgress = name + ":" + id; const count = writes.length; toggle(id); await finish();
    check(writes.length === count + 1, "Checkbox must save without a Save click: " + id);
    check(document.getElementById("settings-autosave-status").textContent === "Changes saved.", "Show confirmed saved status");
  }
}
window.testProgress = "cross-page";
// Every main and inline Save control must write, with submit prevented (no navigation).
for (const name of Object.keys(fixtures)) {
  page(name);
  const form = document.getElementById("settings-form");
  const event = new Event("submit", { cancelable: true });
  let count = writes.length;
  form.dispatchEvent(event);
  check(event.defaultPrevented, "Save must prevent page navigation: " + name);
  await finish(); await tick();
  check(writes.length === count + 1 && buttonFeedback.get("save-" + name)?.phase === "success", "Main Save must persist: " + name);
  buttonFeedback.clear();
  for (const button of document.querySelectorAll("[data-twitch-save], [data-discord-save]")) {
    if (button.matches(":disabled") || button.closest("[inert]")) continue;
    const details = button.closest("details"); if (details) details.open = true;
    count = writes.length; button.click(); await finish(); await tick();
    check(writes.length === count + 1, "Inline Save must persist: " + button.dataset.feedbackKey);
    buttonFeedback.clear();
  }
}
page("twitch");
for (const id of ["twitch-my-cycle-command", "twitch-my-stats-command"]) {
  const input = document.getElementById(id);
  if (!input.checked) { toggle(id); await finish(); }
}
for (const id of ["twitch-my-cycle-alias", "twitch-my-stats-alias"]) {
  const field = document.getElementById(id);
  check(field.closest("details.twitch-message-customization") && !field.closest(".feature-content").querySelector("small"), "Secondary command belongs in Customize without helper text");
}
document.getElementById("twitch-my-cycle-alias").value = "!progress";
document.getElementById("twitch-my-stats-alias").value = "!points";
document.getElementById("settings-form").dispatchEvent(new Event("submit", { cancelable: true }));
await finish(); await tick();
check(persisted.twitch.myCycleCommandAlias === "!progress" && persisted.twitch.myStatsCommandAlias === "!points", "Save persists both custom aliases");
// Header-only feature rows must never abort all settings binding.
document.querySelector('[data-feature-section="twitch-my-cycle-command"] .feature-content').remove();
syncFeatureSections();
buttonFeedback.clear();
page("settings");
const theme = document.getElementById("appearance-theme");
theme.value = "dark"; theme.dispatchEvent(new Event("change"));
await finish(); await tick();
check(persisted.theme === "dark", "Theme saves through the ordered settings queue");
// Cross-page changes before acknowledgement must retain earlier page's toggles.
page("settings");
document.getElementById("auto-start").checked = true;
document.getElementById("auto-start").dispatchEvent(new Event("change"));
await tick();
page("twitch");
document.getElementById("twitch-my-cycle-command").checked = true;
document.getElementById("twitch-my-cycle-command").dispatchEvent(new Event("change"));
await tick();
check(writes.at(-1).csv.autoStartWatcher, "First page toggle captured");
pending.shift()(); await tick();
check(writes.at(-1).csv.autoStartWatcher && writes.at(-1).twitch.myCycleCommand, "Second page must preserve pending first-page toggle");
// A stale backend snapshot must not replace pending config read by the next save.
state.config = ${JSON.stringify(snapshot.config)};
check(readSettingsForm().csv.autoStartWatcher, "Pending toggle survives stale snapshot");
pending.shift()(); await settingsToggleSaveQueue;
check(persisted.csv.autoStartWatcher && persisted.twitch.myCycleCommand, "Reloaded persisted settings retain both toggles");
window.testProgress = "save-button";
// Real global Save submit handler persists a changed text field, reports failures, and retries.
page("settings");
document.getElementById("promotion-message").value = "Saved promotion {url}";
const count = writes.length;
document.getElementById("settings-form").requestSubmit();
await tick();
check(writes.length === count + 1 && writes.at(-1).twitch.promotionMessageTemplate === "Saved promotion {url}", "Save settings must persist text edits");
pending.shift()(); await settingsToggleSaveQueue; await tick();
check(buttonFeedback.get("save-settings")?.phase === "success", "Save button confirms native write");
buttonFeedback.clear(); failNext = true;
document.getElementById("settings-form").requestSubmit();
await tick(); pending.shift()(); await settingsToggleSaveQueue; await tick();
check(buttonFeedback.get("save-settings")?.phase === "error", "Failed Save must show an error");
check(document.getElementById("settings-autosave-status").textContent.includes("Disk write failed"), "Surface native save failure");
buttonFeedback.clear(); document.getElementById("settings-form").requestSubmit();
await finish(); await tick();
check(buttonFeedback.get("save-settings")?.phase === "success", "Save can retry after failure");
return "PASS: all toggles and theme autosave; every main/inline Save persists without navigation; cross-page/rapid saves retain changes; failures display and retry.";
}`;
new vm.Script(`(${source})()`);
const browser = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(file => fs.existsSync(file));
assert(browser, "A browser is required for the settings regression");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "mosstats-settings-test-"));
let child, socket;
try {
  const file = path.join(root, "settings.html");
  fs.writeFileSync(file, `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' 'nonce-style-test'; style-src-attr 'unsafe-inline'; script-src 'nonce-test'; img-src 'none'; form-action 'none'"><style nonce="style-test">#fields{width:900px;padding:20px}</style><main id="fields"></main><pre id="result"></pre><script nonce="test">window.addEventListener("error",e=>document.getElementById("result").textContent="FAIL: "+e.message); (${source})().then(result=>document.getElementById('result').textContent=result).catch(error=>document.getElementById('result').textContent='FAIL: '+error.stack);</script>`);
  const profile = path.join(root, "profile");
  child = spawn(browser, ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-background-networking", `--user-data-dir=${profile}`, "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", "--window-size=1000,900", pathToFileURL(file).href], { windowsHide: true, stdio: "ignore" });
  let launchError;
  child.on("error", error => { launchError = error; });
  const deadline = Date.now() + 30000;
  const portFile = path.join(profile, "DevToolsActivePort");
  while (!fs.existsSync(portFile)) {
    if (launchError) throw launchError;
    assert(Date.now() < deadline && child.exitCode === null, "Test browser failed to start");
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const port = Number(fs.readFileSync(portFile, "utf8").split("\n")[0]);
  assert(Number.isInteger(port) && port > 0 && port <= 65535);
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  const target = targets.find(target => target.type === "page" && target.url === pathToFileURL(file).href);
  assert(target, "Test page was not opened");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await once(socket, "open");
  let serial = 0;
  const rpc = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { socket.off("message", onMessage); reject(Error("Browser probe timed out")); }, 10000);
    const onMessage = bytes => {
      const message = JSON.parse(bytes.toString());
      if (message.id !== id) return;
      clearTimeout(timer); socket.off("message", onMessage);
      if (message.error) reject(Error(message.error.message)); else resolve(message.result);
    };
    socket.on("message", onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
  let result;
  while (!result && Date.now() < deadline) {
    const response = await rpc("Runtime.evaluate", { expression: "document.getElementById('result')?.textContent", returnByValue: true });
    result = response.result?.value;
    if (!result) await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!result) { const debug = await rpc("Runtime.evaluate", { expression: "JSON.stringify({progress:window.testProgress,body:document.body.innerText.slice(-1000)})", returnByValue: true }); console.log(debug.result?.value); }
  assert(result?.startsWith("PASS:"), result || "Browser returned no settings result");
  console.log(result);
  await rpc("Browser.close").catch(() => {});
} finally {
  socket?.close();
  if (child?.exitCode === null) child.kill();
  if (path.dirname(path.resolve(root)) === path.resolve(os.tmpdir()) && path.basename(root).startsWith("mosstats-settings-test-")) {
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* Do not mask a failed regression. */ }
  }
}
