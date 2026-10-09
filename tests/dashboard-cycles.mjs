import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Render the actual Home table with successive cycle snapshots.
const modules = new Map();
function load(name) {
  if (name === "./overlay-view") return {overlaysPage: () => {throw new Error("Home must not render overlays");}};
  const file = `src/${name.replace(/^\.\//, "")}.ts`;
  if (modules.has(file)) return modules.get(file);
  const exports = {};
  modules.set(file, exports);
  const source = fs.readFileSync(file, "utf8").replaceAll("import.meta.url", '"file:///app/src/views.ts"');
  const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code, {exports, require: load, URL});
  return exports;
}
const {renderApplication} = load("./views");
const state = {
  config: {seasons: {raceName: "Test", cycleName: "Test"}},
  watcherStatus: "Watching", statsTrackingEnabled: false, cyclesTrackingEnabled: true,
  twitchStatus: "Disconnected", streamerBotStatus: "Disabled",
  recentResults: [], sessionResults: [], raceCycles: [], totalRaceCount: 0,
  totalBattleRoyaleCount: 0, seasonPointsEarned: 0, totalCycleRaceCount: 0,
};
function progress(counts, cycles, expected, currentCyclePositions) {
  state.raceCycles = [{playerName: "Cycle tester", playerKey: "tester", placementCounts: counts, cycles, currentCyclePositions}];
  const html = renderApplication(state, "home", false, "all", {key: "racer", direction: "asc"});
  assert(html.includes(`<td class="cycle-total">${cycles}</td><td>${expected}/10</td>`));
}
progress(Array(10).fill(0), 0, 0);
progress([1, ...Array(9).fill(0)], 0, 1);
progress([2, ...Array(9).fill(0)], 0, 1); // A repeated position is still one position.
progress([1,0,1,0,1,1,0,0,0,0], 0, 4); // Positions 1, 3, 5 and 6 are four occupied slots.
progress([8,0,3,0,9,2,0,0,0,0], 0, 4); // Occurrence totals do not change occupied slots.
progress([...Array(9).fill(1), 0], 0, 9);
progress(Array(10).fill(1), 1, 10, [1,2,3,4,5,6,7,8,9,10]);
progress([2, ...Array(9).fill(1)], 1, 1, [1]);
progress([16,16,15,12,11,8,8,8,8,7], 7, 4, [1,3,5,6]); // Lifetime totals cannot inflate current progress.
progress([16,16,15,12,11,8,8,8,8,7], 7, 0, []); // Place 11+ after completion starts an empty set.
progress([16,16,15,12,11,8,8,8,8,7], 7, 0); // Legacy totals cannot reconstruct the new set.
const collected = Array(10).fill(0);
for (let cycle = 0; cycle < 3; cycle++) {
  const positions = [];
  for (let slot = 0; slot < 10; slot++) {
    collected[slot]++;
    positions.push(slot + 1);
    progress(collected, cycle + (slot === 9 ? 1 : 0), slot + 1, positions);
    collected[slot]++;
    progress(collected, cycle + (slot === 9 ? 1 : 0), slot + 1, positions); // Repeats do not add slots.
  }
}
progress(Array(10).fill(0), 0, 0, []); // Clear/reset removes the occupied positions.
console.log("Dashboard checks passed: three repeated 1/10–10/10 sets, restart at 1, place 11 at 0, unique slots and reset.");
