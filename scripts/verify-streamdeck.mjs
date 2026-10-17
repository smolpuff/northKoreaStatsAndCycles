// No app, Stream Deck, watcher, or plugin process is launched by these checks.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pluginPath = path.resolve("streamdeck/com.marblesstats.controls.sdPlugin/plugin.js");
const { Controls, ACTIONS, appearance } = require(pluginPath);
const { glyphs, palettes, keySvg } = require("../streamdeck/com.marblesstats.controls.sdPlugin/artwork.js");
for (const glyph of Object.values(glyphs)) {
  const svg = keySvg(glyph, palettes.running);
  assert.equal((svg.match(/<svg\b/g) || []).length, 1, "Stream Deck keys must flatten nested sidebar SVGs");
  assert(!svg.includes("clipPath") && !svg.includes("clip-path"), "Stream Deck must receive resolved color layers, not unsupported clipping");
  assert(svg.includes('gradientUnits="userSpaceOnUse" x1="72" y1="3" x2="72" y2="141"'), "State backgrounds use an explicit top-to-bottom gradient");
  assert(svg.includes('<g transform="translate(') && svg.includes('<path fill="url(#navigation-'), "Sidebar paths carry explicit gradient fills");
}
assert(keySvg(glyphs.twitch, palettes.running).includes('<circle cx="120" cy="24" r="7" fill="#00ff4c"'), "Drop Gate includes its live status light");
assert(keySvg(glyphs.twitch, palettes.stopped).includes('<circle cx="120" cy="24" r="7" fill="#ff182e"'), "Drop Gate includes its offline status light");
assert(!keySvg(glyphs.stats, palettes.running).includes("<circle"), "Controls retain their plain sidebar icons");
const stats = ACTIONS["com.marblesstats.controls.stats"], cycles = ACTIONS["com.marblesstats.controls.cycles"];
const stopped = { statsEnabled: false, cyclesEnabled: false, watcherStatus: "Stopped" };
const watching = { ...stopped, statsEnabled: true, watcherStatus: "Watching" };
assert.equal(appearance(stats, null).label, "Disconnected");
assert.equal(appearance(stats, stopped).label, "Stopped");
assert.equal(appearance(stats, watching).label, "Watching");
assert.equal(appearance(cycles, watching).label, "Stopped");
for (const [status, label] of [["File Missing", "File missing"], ["Error", "Error"], ["Processing", "Processing"]]) {
  assert.equal(appearance(stats, { ...watching, watcherStatus: status }).label, label);
}
const sent = [], display = [];
let now = 1000;
const controls = new Controls(message => display.push(message), message => { sent.push(message); return true; }, () => now);
const key = (event, action = "com.marblesstats.controls.stats", context = "key1") => controls.deckEvent({ event, action, context });
key("willAppear"); key("keyDown");
assert.equal(sent.length, 0, "Disconnected keys cannot send commands");
assert.equal(controls.receive({ type: "state", state: { statsEnabled: "true" } }), false);
controls.receive({ type: "state", state: stopped }); key("keyDown");
assert.deepEqual(sent[0], { type: "setTracking", id: 1, kind: "stats", enabled: true });
assert.equal(controls.state.statsEnabled, false, "No optimistic running state");
key("keyDown"); key("keyDown", "com.marblesstats.controls.cycles", "key2");
assert.equal(sent.length, 1, "Repeated presses wait for acknowledgement");
controls.receive({ type: "result", id: 999, ok: true, state: stopped });
assert(controls.pending, "Wrong response ID cannot unlock controls");
controls.receive({ type: "result", id: 1, ok: false, state: stopped });
assert.equal(controls.pending, null);
assert.equal(controls.state.statsEnabled, false);
assert(decodeURIComponent(display.filter(m => m.event === "setImage").at(-1).payload.image.split(",")[1]).includes("Stats failed</text>"));
assert(!display.some(message => message.event === "showAlert"));
now += 4000;
controls.receive({ type: "state", state: watching }); key("keyDown");
assert.equal(sent.at(-1).enabled, false);
controls.disconnect();
assert.equal(controls.pending, null); assert.equal(controls.state, null);
assert(decodeURIComponent(display.filter(m => m.event === "setImage").at(-1).payload.image.split(",")[1]).includes(" offline</text>"));
key("willDisappear"); assert.equal(controls.keys.size, 0);
controls.receive({ type: "state", state: watching });
key("willAppear", "com.marblesstats.controls.cycles", "key2");
key("keyDown", "com.marblesstats.controls.cycles", "key2");
assert.deepEqual(sent.at(-1), { type: "setTracking", id: 3, kind: "cycles", enabled: true });
assert.equal(controls.state.statsEnabled, true, "Cycle command preserves the stats state");

// Exercise the real plugin startup path with mocked Stream Deck and app sockets.
const sockets = [], timers = [];
let discovery = { version: 1, port: 34567, token: "a".repeat(64) };
class Socket {
  static OPEN = 1;
  constructor(url) { this.url = url; this.readyState = 0; this.handlers = {}; this.sent = []; sockets.push(this); }
  addEventListener(event, fn) { (this.handlers[event] ??= []).push(fn); }
  emit(event, data) {
    if (event === "open") this.readyState = 1;
    for (const handler of this.handlers[event] ?? []) handler({ data: typeof data === "object" ? JSON.stringify(data) : data });
  }
  send(message) { this.sent.push(JSON.parse(message)); }
  close() { this.readyState = 3; this.emit("close"); }
}
const module = { exports: {} };
const pluginRequire = createRequire(pluginPath);
const mockedRequire = name => name === "ws" ? Socket : name === "node:fs" ? { readFileSync: () => JSON.stringify(discovery) } : pluginRequire(name);
mockedRequire.main = module;
vm.runInNewContext(fs.readFileSync(pluginPath, "utf8"), {
  require: mockedRequire, module, Buffer, WebSocket: Socket, Date: { now: () => now },
  setInterval: fn => timers.push(fn),
  process: { argv: ["node", "plugin.js", "-port", "12345", "-pluginUUID", "host-uuid", "-registerEvent", "registerPlugin"], env: { APPDATA: "C:/test-appdata" }, exit: code => { throw new Error(`Unexpected exit ${code}`); } },
});
const deck = sockets[0]; deck.emit("open");
assert.deepEqual(deck.sent[0], { event: "registerPlugin", uuid: "host-uuid" });
let app = sockets[1];
assert.equal(app.url, "ws://127.0.0.1:34567/streamdeck"); app.emit("open");
assert.deepEqual(app.sent[0], { type: "authenticate", token: discovery.token });
deck.emit("message", { event: "willAppear", action: "com.marblesstats.controls.stats", context: "actual-key" });
app.emit("message", { type: "state", state: stopped });
deck.emit("message", { event: "keyDown", action: "com.marblesstats.controls.stats", context: "actual-key" });
assert.equal(app.sent.at(-1).type, "setTracking"); assert.equal(app.sent.at(-1).enabled, true);
app.close(); assert(decodeURIComponent(deck.sent.filter(m => m.event === "setImage").at(-1).payload.image.split(",")[1]).includes(" offline</text>"));
discovery = { version: 1, port: 34568, token: "b".repeat(64) }; now += 2500; timers[0]();
app = sockets[2]; assert.equal(app.url, "ws://127.0.0.1:34568/streamdeck"); app.emit("open");
assert.deepEqual(app.sent, [{ type: "authenticate", token: discovery.token }], "Reconnect discovers the app and never replays an interrupted command");
app.emit("message", { type: "state", state: watching }); now += 6500; timers[0]();
assert.equal(app.readyState, 3, "A silent connection expires");
assert(decodeURIComponent(deck.sent.filter(m => m.event === "setImage").at(-1).payload.image.split(",")[1]).includes(" offline</text>"));
console.log("Stream Deck checks passed: live key states, independent trackers, acknowledged controls, failures, registration, authentication, reconnect and stale-connection expiry.");
