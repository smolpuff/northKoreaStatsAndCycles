// Launches only the isolated JS plugin against mock sockets, never either app.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { WebSocketServer } from "ws";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "marbles-streamdeck-test-"));
const appDir = path.join(root, "com.marblesstats.app");
fs.mkdirSync(appDir);
const bundle = path.join(root, "plugin.cjs");
fs.copyFileSync("streamdeck/com.marblesstats.controls.sdPlugin/bin/plugin.cjs", bundle);
const bridge = new WebSocketServer({ host: "127.0.0.1", port: 0 });
const deck = new WebSocketServer({ host: "127.0.0.1", port: 0 });
await Promise.all([once(bridge, "listening"), once(deck, "listening")]);
const token = "a".repeat(64);
const discovery = path.join(appDir, "streamdeck-connection.json");
fs.writeFileSync(discovery, JSON.stringify({ version: 1, port: bridge.address().port, token }));
const commands = [], messages = [];
let state = { statsEnabled: false, cyclesEnabled: false, watcherStatus: "Stopped" };
let host, appSocket, registrations = 0, connections = 0, errors = "";
bridge.on("connection", (socket, request) => {
  assert.equal(request.url, "/streamdeck");
  assert.equal(request.headers.origin, undefined, "Native plugin must not send browser Origin");
  appSocket = socket;
  connections++;
  let authenticated = false;
  const heartbeat = setInterval(() => { if (authenticated && socket.readyState === 1) socket.send(JSON.stringify({ type: "state", state })); }, 500);
  socket.on("close", () => clearInterval(heartbeat));
  socket.on("message", bytes => {
    const message = JSON.parse(bytes);
    if (!authenticated) {
      assert.deepEqual(message, { type: "authenticate", token });
      authenticated = true;
      socket.send(JSON.stringify({ type: "state", state }));
      return;
    }
    commands.push(message);
    assert.equal(message.type, "setTracking");
    state = { ...state, [message.kind === "stats" ? "statsEnabled" : "cyclesEnabled"]: message.enabled, watcherStatus: "Watching" };
    socket.send(JSON.stringify({ type: "result", id: message.id, ok: true, state }));
  });
});
deck.on("connection", socket => {
  host = socket;
  socket.on("message", bytes => {
    const message = JSON.parse(bytes);
    messages.push(message);
    if (message.event === "registerPlugin") {
      registrations++;
      for (const kind of ["stats", "cycles"]) socket.send(JSON.stringify({ event: "willAppear", action: `com.marblesstats.controls.${kind}`, context: kind }));
    }
  });
});
const child = spawn(process.env.STREAMDECK_TEST_NODE || process.execPath, ["--no-global-search-paths", bundle, "-port", String(deck.address().port), "-pluginUUID", "mock-host", "-registerEvent", "registerPlugin"], { cwd: root, env: { ...process.env, APPDATA: root }, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
child.stderr.on("data", data => { errors += data.toString(); });
const tags = kind => {
  const image = messages.filter(m => m.event === "setImage" && m.context === kind).at(-1)?.payload.image;
  return image ? decodeURIComponent(image.split(",")[1]).match(/<text[^>]*>([^<]+)<\/text>/)?.[1] : "";
};
async function until(test, label) {
  const deadline = Date.now() + 8000;
  while (!test()) {
    if (child.exitCode !== null) throw new Error(`Plugin exited: ${child.exitCode}. ${errors}`);
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}. ${errors}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
try {
  await until(() => tags("stats") === "Stats stopped" && tags("cycles") === "Cycles stopped", "initial app state");
  assert.equal(registrations, 1);
  host.send(JSON.stringify({ event: "keyDown", action: "com.marblesstats.controls.stats", context: "stats" }));
  await until(() => tags("stats") === "Stats running", "start stats acknowledgement");
  assert.equal(tags("cycles"), "Cycles stopped");
  host.send(JSON.stringify({ event: "keyDown", action: "com.marblesstats.controls.cycles", context: "cycles" }));
  await until(() => tags("cycles") === "Cycles running", "start cycles acknowledgement");
  assert.deepEqual(commands.map(c => [c.kind, c.enabled]), [["stats", true], ["cycles", true]]);
  state = { ...state, watcherStatus: "File Missing" };
  appSocket.send(JSON.stringify({ type: "state", state }));
  await until(() => tags("stats") === "Stats no file", "file-missing state");
  appSocket.close();
  await until(() => tags("stats") === "Stats offline", "disconnect state");
  state = { ...state, watcherStatus: "Watching" };
  await until(() => connections > 1 && tags("stats") === "Stats running", "automatic reconnect");
  assert(messages.filter(m => m.event === "setTitle").every(m => m.payload.title === ""), "No oversized native text overlay");
  assert.equal(commands.length, 2, "Reconnect must not replay commands");
  console.log("Isolated bundled-plugin WebSocket checks passed: registration, Origin-free auth, both tracker commands, state updates, disconnect and reconnect without replay.");
} finally {
  const exited = once(child, "exit");
  if (child.exitCode === null) child.kill();
  if (child.exitCode === null) await exited;
  for (const server of [bridge, deck]) {
    for (const client of server.clients) client.terminate();
    await new Promise(resolve => server.close(resolve));
  }
  fs.unlinkSync(bundle); fs.unlinkSync(discovery); fs.rmdirSync(appDir); fs.rmdirSync(root);
}
