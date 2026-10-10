import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
import { createManifest, repository } from "../scripts/create-update-manifest.mjs";

const exe = Buffer.alloc(256);
exe.write("MZ"); exe.writeUInt32LE(64, 60); exe.writeUInt32LE(0x4550, 64); exe.writeUInt16LE(0x8664, 68);
const manifest = createManifest(exe, "0.2.0");
const artifact = manifest.artifacts["win32-x64"];
assert.equal(artifact.size, exe.length);
assert.equal(artifact.sha256, crypto.createHash("sha256").update(exe).digest("hex"));
assert.equal(artifact.url, `https://github.com/${repository}/releases/download/v0.2.0/marbles-stats.exe`);
exe.writeUInt16LE(0xaa64, 68);
assert(createManifest(exe, "0.2.0").artifacts["win32-arm64"]);
for (const version of ["", "1.0", "1.0.0/../", "1.0.0-beta"]) assert.throws(() => createManifest(exe, version));
assert.throws(() => createManifest(Buffer.alloc(256), "1.0.0"));
assert.throws(() => createManifest(exe, "1.0.0", "../other.exe"));
exe.writeUInt32LE(1000, 60);
assert.throws(() => createManifest(exe, "1.0.0"));

const controls = new Map();
function control() {
  return { textContent: "", disabled: false, hidden: false, value: 0, children: [], style: {}, classList: { toggle() {} },
    handlers: {}, addEventListener(type, callback) { this.handlers[type] = callback; },
    removeAttribute(name) { delete this[name]; }, focus() {},
    append(item) { this.children.push(item); } };
}
let active;
const document = {
  querySelector(selector) { if (!controls.has(selector)) controls.set(selector, control()); return controls.get(selector); },
  body: { append(element) { active = element; } },
  createElement(tag) {
    const element = control();
    if (tag !== "dialog") return element;
    const items = new Map();
    element.classList = { toggle() {} };
    element.querySelector = selector => { if (!items.has(selector)) items.set(selector, control()); return items.get(selector); };
    element.querySelectorAll = selector => (selector === "button" ? ["[data-close]", "[data-later]", "[data-install]", "[data-cancel-download]"] : selector.split(", ")).map(element.querySelector);
    element.setAttribute = () => {};
    element.showModal = () => {};
    element.close = () => element.handlers.close();
    element.remove = () => { active = undefined; };
    return element;
  },
};
const calls = [];
const timers = [];
let updateStatus;
let offered = { currentVersion: "0.1.0", latestVersion: "0.2.0", updateAvailable: true, notes: ["<script>unsafe()</script>", "Improved updates"], skipped: false };
let rejectInstall;
const exports = {};
const source = ts.transpileModule(fs.readFileSync("src/updates.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(source, { exports, document, Date, console,
  window: { setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; }, clearTimeout() {} },
  require(name) {
    if (name.includes("dialog-motion")) return { showAnimatedDialog: dialog => dialog.showModal() };
    if (name.includes("icons")) return { icons: { download: '<svg aria-hidden="true"></svg>' } };
    if (name.endsWith("/event")) return { listen: async (_name, callback) => { updateStatus = callback; } };
    return { invoke: async (command, args) => {
      calls.push({ command, args });
      if (command === "app_update_ready") return { currentVersion: "0.1.0" };
      if (command === "check_app_updates") return offered;
      if (command === "install_app_update") return new Promise((_, reject) => { rejectInstall = reject; });
      if (command === "cancel_app_update") return;
      throw new Error(command);
    } };
  },
});
let enabled = true;
await exports.initializeUpdates(() => enabled);
assert.equal(document.querySelector("[data-app-version]").textContent, "v0.1.0");
assert(timers[0].delay >= 24 * 60 * 60 * 1000 - 1000);
exports.bindUpdateSettings();
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
document.querySelector("[data-check-updates]").handlers.click();
await flush();
assert.equal(calls.at(-1).args.manual, true);
assert(active);
assert.equal(active.querySelector("[data-release-notes]").children[0].textContent, offered.notes[0]);
assert(!active.innerHTML.includes(offered.notes[0]));
active.querySelector("[data-later]").handlers.click();
assert.equal(active, undefined);
assert(!calls.some(call => call.command === "install_app_update"));
document.querySelector("[data-check-updates]").handlers.click();
await flush();
const pending = active.querySelector("[data-install]").handlers.click();
assert.equal(calls.at(-1).command, "install_app_update");
assert.equal(calls.at(-1).args.version, "0.2.0");
assert(active.querySelector("[data-install]").disabled);
assert(active.querySelector("[data-update-offer]").hidden);
assert(!active.querySelector("[data-update-progress]").hidden);
assert(!active.querySelector("[data-cancel-download]").disabled);
await active.querySelector("[data-install]").handlers.click();
assert.equal(calls.filter(call => call.command === "install_app_update").length, 1);
let prevented = false;
updateStatus({ payload: { phase: "downloading", percent: 42 } });
assert.equal(active.querySelector("progress").value, 42);
updateStatus({ payload: { phase: "preparing" } });
assert(active.querySelector("[data-cancel-download]").disabled);
active.handlers.cancel({ preventDefault() { prevented = true; } });
assert(prevented);
active.querySelector("[data-close]").handlers.click();
assert(active);
rejectInstall(new Error("Checksum mismatch"));
await pending;
assert(!active.querySelector("[data-install]").disabled);
assert.match(active.querySelector("[data-install-status]").textContent, /Checksum mismatch/);
active.querySelector("[data-close]").handlers.click();
offered = { ...offered, updateAvailable: false };
document.querySelector("[data-check-updates]").handlers.click();
await flush();
assert.equal(document.querySelector("[data-update-message]").textContent, "You are up to date.");
assert.equal(active, undefined);
offered = { ...offered, skipped: true };
await timers[0].callback();
await flush();
assert.equal(calls.at(-1).args.manual, false);
assert(timers.at(-1).delay >= 24 * 60 * 60 * 1000 - 1000);
const scheduled = timers.length;
enabled = false;
exports.bindUpdateSettings();
assert.equal(timers.length, scheduled);
enabled = true;
exports.bindUpdateSettings();
assert.equal(timers.length, scheduled + 1);
assert.equal(document.querySelector("[data-test-update-popup]").handlers.click, undefined);
offered = { ...offered, skipped: false, updateAvailable: true };
document.querySelector("[data-check-updates]").handlers.click();
await flush();
const cancelledInstall = active.querySelector("[data-install]").handlers.click();
active.querySelector("[data-cancel-download]").handlers.click();
await flush();
assert.equal(calls.at(-1).command, "cancel_app_update");
rejectInstall("Update cancelled");
await cancelledInstall;
assert.equal(active.querySelector("[data-install-status]").textContent, "Download cancelled.");
assert(active.querySelector("[data-update-offer]").hidden);
assert(!active.querySelector("[data-cancel-download]").disabled);
active.querySelector("[data-cancel-download]").handlers.click();
console.log("Updater checks passed: release metadata, safe notes, compact progress, pink/icon action, real cancellation commands, installation guard and retry.");
