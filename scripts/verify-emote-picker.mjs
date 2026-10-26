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
const snapshot = {
  eventResultIds: [], cycleHistory: [], recentResults: [], sessionResults: [], raceCycles: [], logs: [],
  totalRaceCount: 0, totalBattleRoyaleCount: 0, totalCycleRaceCount: 0, seasonPointsEarned: 0,
  watcherStatus: "Stopped", streamerBotStatus: "Disabled", twitchStatus: "Connected", twitchUsername: "first", session: { gamesPlayed: 0 },
  config: { seasons: {}, csv: { path: "LastSeasonRace.csv" }, streamerBot: { events: {}, actions: {} },
    twitch: { postResults: true, postCycleResults: true, postWorldRecords: true, promoteMissionApp: true,
      messagePrefix: views.defaultRaceIntro, cycleMessageTemplate: "Congrats {player}", worldRecordMessageTemplate: views.defaultWorldRecordMessage } },
};
const render = page => views.renderApplication(snapshot, page, false, "all", { key: "cycles", direction: "desc" }, false, { key: "placement", direction: "asc" }, "", "");
const screens = { twitch: render("twitch"), settings: render("settings"),
  lumia: render("lumia"), discord: render("discord"), streamer: render("streamer"),
  lumiaConfigured: views.renderApplication({ ...snapshot, lumiaConfigured: true, lumiaStatus: "Connected" }, "lumia", false, "all", { key: "cycles", direction: "desc" }),
  homeStatsPending: views.renderApplication(snapshot, "home", { stats: true, cycles: false }, "all", { key: "cycles", direction: "desc" }),
  homeCyclesPending: views.renderApplication(snapshot, "home", { stats: false, cycles: true }, "all", { key: "cycles", direction: "desc" }),
  logs: views.renderApplication({ ...snapshot, logs: [
    { timestamp: "2026-10-25T12:00:00Z", level: "info", message: "Old entry" },
    { timestamp: "2026-10-25T12:01:00Z", level: "info", message: "Newest entry" },
  ] }, "logs", false, "all", { key: "cycles", direction: "desc" }),
};
for (const page of ["lumia", "discord", "streamer"]) {
  assert(!screens[page].includes("data-emote-target="), `${page} must not offer Twitch emotes`);
  assert(!screens[page].includes('id="promote-mission-app"'), `${page} must not offer Twitch promotion`);
}
const enabledSidebar = views.renderApplication({ ...snapshot, config: { ...snapshot.config, lumia: { enabled: true }, discord: { enabled: true } } }, "home", false, "all", { key: "cycles", direction: "desc" });
assert(enabledSidebar.includes('navigation-status-discord-primary') && enabledSidebar.includes('navigation-status-lumia-primary'), "Collapsed status footer must use each integration's branded artwork");
assert(!screens.twitch.includes("race-podium-templates"));
assert(screens.settings.includes("Promote Korea's Mission App on stream"));
assert(views.twitchPreviewMessages("{race}", undefined, { raceEntryTemplate: "@{player}", racePodiumTemplates: ["OLD OVERRIDE"] })[0].includes("@rmrfkorea"));
assert(!views.twitchPreviewMessages("{race}", undefined, { raceEntryTemplate: "@{player}", racePodiumTemplates: ["OLD OVERRIDE"] })[0].includes("@@"));
assert.equal(views.cycleMessagePreview("Congrats @{player}"), "Congrats @rmrfkorea");
assert.equal(views.worldRecordMessagePreview("Congrats @{wrplayer}"), "Congrats @test_player_1");
assert.equal((screens.twitch.match(/data-emote-target=/g) || []).length, 6, "The real Twitch renderer must include six icon buttons before event binding");
assert.equal((screens.settings.match(/data-emote-target=/g) || []).length, 1, "The real promotion renderer must include its Emotes button");
const nativeEmotes = fs.readFileSync("src-tauri/src/twitch.rs", "utf8").split("pub fn list_emotes()")[1].split("pub fn send_results")[0];
assert(nativeEmotes.includes('https://api.twitch.tv/helix/chat/emotes"'));
assert(nativeEmotes.includes('append_pair("broadcaster_id", &credential.user_id)'));
assert(!nativeEmotes.includes('/emotes/user') && !nativeEmotes.includes('append_pair("user_id"'), "Only the signed-in broadcaster's own channel may be listed");
assert(!fs.readFileSync("src-tauri/src/twitch_oauth.rs", "utf8").includes("user:read:emotes"), "Channel emotes need no extra OAuth scope");

async function browserCheck() {
  const fixtures = __RENDERED_SCREENS__;
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const wait = async condition => {
    for (let i = 0; i < 100; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
    throw Error("Timed out waiting for picker state");
  };
  let mode = "ready", requests = 0, updates = 0, inputs = 0;
  const commands = [];
  const emote = name => ({ id: name, name, imageUrl: `https://static-cdn.jtvnw.net/emoticons/v2/${name}/static/dark/2.0` });
  const items = [emote("rmrfkoHeart"), emote("Kappa"), emote("<3"), ...Array.from({ length: 121 }, (_, i) => emote(`Emote${i}`)), { ...emote("bad"), imageUrl: "https://evil.example/image.png" }];
  let state = { twitchStatus: "Connected", twitchUsername: "first" };
  const invoke = async command => {
    commands.push(command);
    if (command === "connect_twitch") { mode = "ready"; return { twitchStatus: "Connected", twitchUsername: "second" }; }
    check(command === "list_twitch_emotes", "Picker must not invoke posting commands");
    requests++;
    if (mode === "error") { mode = "ready"; throw Error("Temporary network failure"); }
    return { login: state.twitchUsername, needsAuthorization: mode === "permission", emotes: items };
  };
  const module = { exports: {} };
  const require = name => {
    if (name === "@tauri-apps/api/core") return { invoke };
    if (name === "./dialog-motion") return { showAnimatedDialog: dialog => dialog.showModal() };
    if (name === "./icons") return { icons: { close: "×" } };
    throw Error(`Unexpected dependency ${name}`);
  };
  // The source is inserted here as ordinary script, without eval or Function.
  __PICKER_SOURCE__
  const picker = module.exports;
  const ids = ["promotion-message", "twitch-message-prefix", "twitch-race-message", "twitch-race-entry", "twitch-race-separator", "twitch-cycle-message", "twitch-world-record-message"];
  function fields() {
    const settings = document.createElement("template");
    settings.innerHTML = fixtures.settings;
    document.getElementById("fields").innerHTML = fixtures.twitch + settings.content.querySelector(".mission-promotion-panel").outerHTML;
    document.querySelectorAll("details").forEach(details => { details.open = true; });
    picker.installTwitchEmotePickers(state, snapshot => { state = snapshot; updates++; fields(); });
  }
  document.getElementById("fields").addEventListener("input", () => inputs++);
  let activeId = "twitch-race-message";
  const field = () => document.getElementById(activeId);
  const dialog = () => document.getElementById("twitch-emote-dialog");
  const open = () => field().closest(".emote-input-row").querySelector("button").click();
  const choose = name => [...dialog().querySelectorAll(".twitch-emote-choice")].find(button => button.title === name).click();
  const close = async () => { dialog().close(); await wait(() => !dialog()); };
  fields();
  check(document.querySelectorAll(".emote-picker-button").length === 7, "Every message field needs a picker");
  for (const id of ids) {
    const button = document.querySelector(`[data-emote-target="${id}"]`);
    const rect = button.getBoundingClientRect();
    check(button.querySelector("svg") && button.getAttribute("aria-label") === "Choose Twitch emote" && rect.width >= 28 && rect.width <= 36 && rect.height >= 25 && getComputedStyle(button).visibility === "visible", `Visible Emotes button missing beside real field ${id}`);
  }
  field().value = "Hello world";
  field().setSelectionRange(6, 11);
  open();
  await wait(() => dialog()?.querySelectorAll(".twitch-emote-choice").length === 60);
  const box = dialog().getBoundingClientRect();
  check(box.width <= 280 && box.height <= 340, "Picker must remain compact");
  check(dialog().querySelector("img").width === 20, "Emote images must be 20px");
  check(box.left >= 15 && box.right <= innerWidth - 15 && box.top >= 15 && box.bottom <= innerHeight - 15, "Popup must fit the viewport beside its field");
  dialog().querySelector("[data-emote-more]").click();
  check(dialog().querySelectorAll(".twitch-emote-choice").length === 120, "Show more");
  dialog().querySelector("[data-emote-more]").click();
  check(dialog().querySelectorAll(".twitch-emote-choice").length === 124, "Exclude unsafe image origins");
  const search = dialog().querySelector("input");
  search.value = "HEART";
  search.dispatchEvent(new Event("input"));
  check(dialog().querySelectorAll(".twitch-emote-choice").length === 1, "Case-insensitive search");
  choose("rmrfkoHeart");
  await wait(() => !dialog());
  check(field().value === "Hello rmrfkoHeart " && inputs === 1, "Selection replacement and live-preview input event");
  check(document.activeElement === field() && field().selectionStart === field().value.length, "Return focus and caret");
  field().maxLength = field().value.length;
  open();
  await wait(() => dialog()?.querySelectorAll(".twitch-emote-choice").length === 60);
  choose("Kappa");
  check(field().value === "Hello rmrfkoHeart " && dialog().textContent.includes("length limit"), "Length limit must preserve text");
  check(requests === 1, "Reuse the signed-in account's in-memory cache");
  await close();

  state = { twitchStatus: "Connected", twitchUsername: "second" }; mode = "permission"; activeId = "promotion-message"; fields();
  field().value = "Unsaved draft"; field().setSelectionRange(13, 13);
  document.getElementById("twitch-cycle-message").value = "Other unsaved draft";
  open();
  await wait(() => dialog()?.querySelector("[data-emote-connect]").hidden === false);
  dialog().querySelector("[data-emote-connect]").click();
  await wait(() => updates === 1 && dialog()?.querySelectorAll(".twitch-emote-choice").length === 60);
  check(field().value === "Unsaved draft" && document.getElementById("twitch-cycle-message").value === "Other unsaved draft", "Reconnect must preserve all message drafts");
  choose("rmrfkoHeart");
  await wait(() => !dialog());
  check(field().value === "Unsaved draft rmrfkoHeart ", "Insert into the restored field after reconnect");

  state = { twitchStatus: "Connected", twitchUsername: "third" }; mode = "error"; fields(); open();
  await wait(() => dialog()?.querySelector("[data-emote-retry]").hidden === false);
  dialog().querySelector("[data-emote-retry]").click();
  await wait(() => dialog()?.querySelectorAll(".twitch-emote-choice").length === 60);
  dialog().close();
  check(!dialog()?.open, "Close the retried picker");
  check(commands.every(command => ["list_twitch_emotes", "connect_twitch"].includes(command)), "Never send a chat message while picking");
  const detached = html => { const template = document.createElement("template"); template.innerHTML = html; return template.content; };
  for (const [screen, pendingKind] of [[fixtures.homeStatsPending, "stats"], [fixtures.homeCyclesPending, "cycles"]]) {
    const home = detached(screen);
    for (const kind of ["stats", "cycles"]) check(home.querySelector(`[data-tracking-toggle="${kind}"]`).disabled === (kind === pendingKind), "Tracker commands must disable only their own controls");
  }
  const lumia = detached(fixtures.lumia);
  check(lumia.textContent.includes("Lumia setup required") && lumia.querySelector("[data-lumia-token]")?.textContent.includes("Configure Lumia"), "Missing token must show setup and its action");
  check(!lumia.querySelector("[data-lumia-remove-token]"), "Missing token must not offer Remove");
  const configuredLumia = detached(fixtures.lumiaConfigured);
  check(configuredLumia.querySelector("[data-lumia-remove-token]") && !configuredLumia.textContent.includes("Lumia setup required"), "Saved token must offer update/removal");
  document.getElementById("fields").innerHTML = fixtures.settings;
  const settingsRows = document.querySelectorAll(".settings-option");
  check(getComputedStyle(settingsRows[1]).paddingTop === "6px", "Settings events must use compact spacing");
  for (const name of ["twitch", "discord", "lumia", "streamer"]) {
    document.getElementById("fields").innerHTML = fixtures[name];
    const events = document.querySelector(".twitch-settings-grid, .streamer-events");
    check(events && getComputedStyle(events).rowGap === "6px", name + " events must have the same 6px gap");
  }
  const log = detached(fixtures.logs);
  check(log.querySelector(".log-row span").textContent === "Newest entry", "Newest log entry must be on top");
  document.getElementById("fields").innerHTML = fixtures.logs;
  check(parseFloat(getComputedStyle(document.querySelector(".log-row time")).width) < 45, "Timestamp column must stay compact");
  const calls = []; let maximized = false; let resize;
  const nativeWindow = { isMaximized: async () => maximized, minimize: async () => { calls.push("minimize"); }, close: async () => { calls.push("close"); }, toggleMaximize: async () => { maximized = !maximized; calls.push("maximize"); }, onResized: async handler => { resize = handler; return () => {}; } };
  __CHROME_SOURCE__
  await wait(() => document.querySelector(".window-chrome"));
  document.querySelector('[data-window="minimize"]').click();
  document.querySelector('[data-window="maximize"]').click();
  await wait(() => document.querySelector('[data-window="maximize"]').title === "Restore");
  document.querySelector('[data-window="maximize"]').click();
  await wait(() => document.querySelector('[data-window="maximize"]').title === "Maximize");
  document.querySelector('[data-window="close"]').click();
  check(calls.join(",") === "minimize,maximize,maximize,close", "All three native controls must retain their own actions");
  check(getComputedStyle(document.querySelector(".window-chrome")).backgroundColor === "rgba(0, 0, 0, 0)", "Title bar must blend into the window");
  check(document.querySelector("[data-tauri-drag-region]"), "Title bar must retain native dragging");
  return "PASS: independent tracker controls, Lumia setup/token states, newest-first compact logs, custom minimize/maximize/restore/close chrome, Twitch-only emote/promotion scope, shared placement templates and mentions; six visible emote icon buttons on the actual Twitch screen plus promotion, actual Twitch field click/insertion, popup bounds, search/show-more, safe images, caret/live preview, limits/cache, permission reconnect/draft preservation and retry; no chat posts.";
}

const browser = [process.env.STYLE_TEST_BROWSER, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean).find(file => fs.existsSync(file));
assert(browser, "Chrome or Edge is required for the emote picker regression");
const compiled = ts.transpileModule(fs.readFileSync("src/twitch-emote-picker.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
// This wrapper needs separate exports just as a CommonJS module does.
const chromeSource = ts.transpileModule(fs.readFileSync("src/window-chrome.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const source = browserCheck.toString().replace("__CHROME_SOURCE__", `(function(require,module,exports){${chromeSource}\n})(() => ({ getCurrentWindow: () => nativeWindow }),{exports:{}},{});`).replace("__RENDERED_SCREENS__", JSON.stringify(screens).replaceAll("<", "\\u003c")).replace("__PICKER_SOURCE__", `(function(require,module,exports){${compiled}\n})(require,module,module.exports);`);
const css = ["styles", "reference-theme", "themes"].map(name => fs.readFileSync(`src/${name}.css`, "utf8")).join("\n");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "mosstats-emote-test-"));
let child, socket;
try {
  const file = path.join(root, "picker.html");
  fs.writeFileSync(file, `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' 'nonce-style-test'; style-src-attr 'unsafe-inline'; script-src 'nonce-test'; img-src 'none'"><style nonce="style-test">${css}\n#fields{width:600px;padding:20px}</style><main id="fields"></main><pre id="result"></pre><script nonce="test">(${source})().then(result=>document.getElementById('result').textContent=result).catch(error=>document.getElementById('result').textContent='FAIL: '+error.stack);</script>`);
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
  assert(result?.startsWith("PASS:"), result || "Browser returned no picker result");
  console.log(result);
  await rpc("Browser.close").catch(() => {});
} finally {
  socket?.close();
  if (child?.exitCode === null) child.kill();
  if (path.dirname(path.resolve(root)) === path.resolve(os.tmpdir()) && path.basename(root).startsWith("mosstats-emote-test-")) {
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* Do not mask a failed regression. */ }
  }
}
