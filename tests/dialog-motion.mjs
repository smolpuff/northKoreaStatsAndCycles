import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const timers = new Map();
let nextTimer = 0;
let reducedMotion = false;
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/dialog-motion.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, window: {
  matchMedia: () => ({ matches: reducedMotion }),
  setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; },
  clearTimeout(id) { timers.delete(id); },
} });
function createDialog() {
  const listeners = new Map();
  const classes = new Set();
  return {
    open: false, closes: [], classes,
    classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
    showModal() { this.open = true; },
    close(value) { this.open = false; this.closes.push(value); },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    fire(type, event = {}) { for (const listener of [...(listeners.get(type) ?? [])]) listener(event); },
  };
}
const dialog = createDialog();
exports.showAnimatedDialog(dialog);
dialog.close("confirmed");
dialog.close("cancel");
assert(dialog.open, "Keep modal and backdrop visible throughout exit");
assert(dialog.classes.has("dialog-closing"));
dialog.fire("animationend", { target: {}, animationName: "app-dialog-out" });
assert(dialog.open, "Ignore child/backdrop animations");
dialog.fire("animationend", { target: dialog, animationName: "app-dialog-in" });
assert(dialog.open, "Ignore entrance completion");
dialog.fire("animationend", { target: dialog, animationName: "app-dialog-out" });
assert.deepEqual(dialog.closes, ["confirmed"], "Preserve the first explicit close result");
assert.equal(timers.size, 0);
assert(!dialog.classes.has("dialog-closing"));

exports.showAnimatedDialog(dialog);
let prevented = false;
dialog.fire("cancel", { defaultPrevented: false, preventDefault() { prevented = true; } });
assert(prevented);
assert(dialog.open, "Escape must also animate out");
for (const timeout of [...timers.values()]) timeout();
assert.equal(dialog.closes.length, 2, "Timeout closes if no animation event arrives");

const guarded = createDialog();
exports.showAnimatedDialog(guarded);
guarded.fire("cancel", { defaultPrevented: true, preventDefault() { throw new Error("Guard overridden"); } });
assert(guarded.open);
assert.equal(timers.size, 0, "Respect the updater's prevented Escape");

reducedMotion = true;
guarded.close("cancel");
assert(!guarded.open);
assert.equal(guarded.closes[0], "cancel");
assert.equal(timers.size, 0, "Reduced motion closes immediately");

for (const module of ["confirm-dialog", "integration-help", "overlay-help", "overlay-view", "streamer-events", "updates"]) {
  const source = fs.readFileSync(`src/${module}.ts`, "utf8");
  assert(source.includes('from "./dialog-motion"'), `${module} shares dialog motion`);
  assert(!source.includes(".showModal()"), `${module} cannot bypass shared animation`);
}
console.log("Dialog motion passed: every app dialog uses shared entry/exit; delayed removal, Escape, return values, repeated closes, fallback and reduced motion checked.");
