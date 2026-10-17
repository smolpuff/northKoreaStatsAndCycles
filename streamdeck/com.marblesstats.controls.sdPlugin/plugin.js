/* Runs inside Stream Deck's Node.js 20 runtime; ws is bundled for compatibility. */
const fs = require("node:fs");
const path = require("node:path");
const WebSocket = require("ws");
const { palettes, keySvg, glyphs } = require("./artwork.js");

const ACTIONS = {
  "com.marblesstats.controls.stats": { kind: "stats", title: "RaceStats", field: "statsEnabled", glyph: glyphs.stats },
  "com.marblesstats.controls.cycles": { kind: "cycles", title: "RaceCycles", field: "cyclesEnabled", glyph: glyphs.cycles },
};

function validState(state) {
  return state && typeof state.statsEnabled === "boolean" && typeof state.cyclesEnabled === "boolean" && typeof state.watcherStatus === "string";
}

function appearance(action, state, busy = false, failed = false) {
  if (failed) return { ...palettes.attention, label: "Failed" };
  if (!state) return { ...palettes.disconnected, label: "Disconnected" };
  if (busy) return { ...palettes.busy, label: "Working..." };
  if (!state[action.field]) return { ...palettes.stopped, label: "Stopped" };
  if (state.watcherStatus === "Watching" || state.watcherStatus === "Processing") {
    return { ...palettes.running, label: state.watcherStatus };
  }
  return { ...palettes.attention, label: state.watcherStatus === "File Missing" ? "File missing" : state.watcherStatus === "Error" ? "Error" : "Waiting" };
}

function keyImage(action, visual) {
  const svg = keySvg(action.glyph, visual);
  const encoded = [...Buffer.from(svg)].map(byte => `%${byte.toString(16).padStart(2, "0")}`).join("");
  return `data:image/svg+xml,${encoded}`;
}

class Controls {
  constructor(sendToDeck, sendToApp, now = Date.now) {
    this.sendToDeck = sendToDeck;
    this.sendToApp = sendToApp;
    this.now = now;
    this.keys = new Map();
    this.state = null;
    this.pending = null;
    this.nextId = 0;
    this.failedUntil = 0;
  }
  render() {
    for (const [context, action] of this.keys) {
      const visual = appearance(action, this.state, !!this.pending, this.failedContext === context && this.failedUntil > this.now());
      const title = "";
      const signature = title + visual.state + visual.label;
      if (this.images?.get(context) === signature) continue;
      this.images ??= new Map();
      this.images.set(context, signature);
      this.sendToDeck({ event: "setImage", context, payload: { image: keyImage(action, visual), target: 0 } });
      this.sendToDeck({ event: "setTitle", context, payload: { title, target: 0 } });
    }
  }
  disconnect() {
    this.state = null;
    this.pending = null;
    this.failedUntil = 0;
    this.render();
  }
  receive(message) {
    if ((message.type !== "state" && message.type !== "result") || !validState(message.state)) return false;
    this.state = message.state;
    if (message.type === "result" && this.pending?.id === message.id) {
      if (!message.ok) {
        this.failedUntil = this.now() + 3000;
        this.failedContext = this.pending.context;
      }
      this.pending = null;
    }
    this.render();
    return true;
  }
  deckEvent(message) {
    const action = ACTIONS[message.action];
    if (message.event === "willDisappear") {
      this.keys.delete(message.context);
      this.images?.delete(message.context);
    } else if (action && message.event === "willAppear") {
      this.keys.set(message.context, action);
      this.render();
    } else if (action && message.event === "keyDown") {
      if (!this.state || this.pending) {
        return;
      }
      const request = { type: "setTracking", id: ++this.nextId, kind: action.kind, enabled: !this.state[action.field] };
      this.pending = { id: request.id, context: message.context, started: this.now() };
      this.failedUntil = 0;
      if (!this.sendToApp(request)) this.disconnect();
      this.render();
    }
  }
}

function start() {
  const args = process.argv.slice(2);
  const option = name => args[args.indexOf(name) + 1];
  const port = Number(option("-port"));
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !args.includes("-pluginUUID") || !args.includes("-registerEvent")) {
    throw new Error("This plugin must be launched by Elgato Stream Deck.");
  }
  const deck = new WebSocket(`ws://127.0.0.1:${port}`);
  let app = null;
  let lastSeen = 0;
  let openedAt = 0;
  let retryAt = 0;
  const controls = new Controls(message => {
    if (deck.readyState === WebSocket.OPEN) deck.send(JSON.stringify(message));
  }, message => {
    if (!app || app.readyState !== WebSocket.OPEN) return false;
    try { app.send(JSON.stringify(message)); return true; }
    catch { return false; }
  });

  function loseConnection(socket) {
    if (app !== socket) return;
    app = null;
    controls.disconnect();
    retryAt = Date.now() + 2000;
    socket.close();
  }
  function connectApp() {
    retryAt = Date.now() + 2000;
    try {
      if (!process.env.APPDATA) return;
      const discovery = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, "com.marblesstats.app", "streamdeck-connection.json"), "utf8"));
      if (discovery.version !== 1 || !Number.isInteger(discovery.port) || discovery.port < 1 || discovery.port > 65535 || !/^[a-f0-9]{64}$/.test(discovery.token)) return;
      const socket = new WebSocket(`ws://127.0.0.1:${discovery.port}/streamdeck`);
      app = socket;
      openedAt = Date.now();
      lastSeen = 0;
      socket.addEventListener("open", () => {
        if (app === socket) socket.send(JSON.stringify({ type: "authenticate", token: discovery.token }));
      });
      socket.addEventListener("message", event => {
        if (app !== socket) return;
        try {
          if (controls.receive(JSON.parse(event.data))) lastSeen = Date.now();
        } catch { loseConnection(socket); }
      });
      socket.addEventListener("error", () => loseConnection(socket));
      socket.addEventListener("close", () => loseConnection(socket));
    } catch { /* App not running yet; retry without logging local credentials. */ }
  }
  deck.addEventListener("open", () => {
    deck.send(JSON.stringify({ event: option("-registerEvent"), uuid: option("-pluginUUID") }));
    connectApp();
  });
  deck.addEventListener("message", event => {
    try { controls.deckEvent(JSON.parse(event.data)); } catch { /* Ignore malformed host events. */ }
  });
  deck.addEventListener("close", () => process.exit(0));
  deck.addEventListener("error", () => process.exit(1));
  setInterval(() => {
    const now = Date.now();
    if (!app && deck.readyState === WebSocket.OPEN && now >= retryAt) connectApp();
    if (app && (controls.pending ? now - controls.pending.started > 20000 : now - (lastSeen || openedAt) > 6000)) loseConnection(app);
    controls.render();
  }, 500);
}

module.exports = { Controls, ACTIONS, appearance, validState, keyImage };
if (require.main === module) start();
