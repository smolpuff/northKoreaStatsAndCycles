// Use the installed plugin's exact artwork renderer for the in-app previews.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { Resvg } from "@resvg/resvg-js";
import { streamDeckArtwork } from "./streamdeck-svg.mjs";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const modules = new Map();
function loadIconModule(file) {
  file = path.resolve(file);
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const localRequire = name => loadIconModule(path.resolve(path.dirname(file), `${name}.ts`));
  vm.runInNewContext(source, { module, exports: module.exports, require: localRequire });
  return module.exports;
}
const { sidebarArtwork } = loadIconModule("src/sidebar-icons.ts");
const iconNames = { stats: "overview", cycles: "racecycles", twitch: "twitch" };
const originalSidebar = Object.fromEntries(Object.entries(iconNames).map(([key, name]) => [key, sidebarArtwork(name, `streamdeck-${key}`)]));
const sidebar = Object.fromEntries(Object.entries(originalSidebar).map(([key, svg]) => [key, streamDeckArtwork(svg)]));
// Compare against the real sidebar in a full SVG renderer before packaging.
// This catches color/geometry changes introduced by resolving clipped layers.
for (const [key, svg] of Object.entries(sidebar)) {
  for (const size of [32, 640]) {
    const pixels = source => new Resvg(source.replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" `)).render().pixels;
    const expected = pixels(originalSidebar[key]);
    const actual = pixels(svg);
    let difference = 0;
    for (let index = 0; index < actual.length; index++) difference += Math.abs(actual[index] - expected[index]);
    // Small differences at clip edges come from antialiasing the resolved paths.
    assert(difference / actual.length < (size === 32 ? 1.5 : 0.5), `${key}: resolved SVG must preserve sidebar colors and geometry at ${size}px (difference ${difference / actual.length})`);
  }
}
const plugin = "streamdeck/com.marblesstats.controls.sdPlugin";
fs.writeFileSync(`${plugin}/sidebar-artwork.json`, JSON.stringify(sidebar, null, 2));
const { ACTIONS } = require("../streamdeck/com.marblesstats.controls.sdPlugin/plugin.js");
const { palettes, keySvg, staticSvg } = require("../streamdeck/com.marblesstats.controls.sdPlugin/artwork.js");
const directory = "public/streamdeck/previews";
fs.mkdirSync(directory, { recursive: true });
const png = (svg, file) => fs.writeFileSync(file, new Resvg(svg).render().asPng());
const menuIcon = svg => svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" ').replace(/style="fill:([^"]+)"/g, 'fill="$1"');
for (const action of Object.values(ACTIONS)) {
  fs.writeFileSync(`${plugin}/images/${action.kind}-key.svg`, staticSvg(action.glyph));
  fs.writeFileSync(`${plugin}/images/${action.kind}-action.svg`, menuIcon(action.glyph));
  fs.writeFileSync(`${directory}/${action.kind}-default.svg`, staticSvg(action.glyph));
  for (const [state, title] of [["running", "Watching"], ["stopped", "Stopped"], ["disconnected", "Disconnected"], ["attention", "Error"], ["busy", "Working..."]]) {
    const image = keySvg(action.glyph, { ...palettes[state], label: title });
    fs.writeFileSync(`${directory}/${action.kind}-${state}.svg`, image);
  }
}
const { glyphs } = require("../streamdeck/com.marblesstats.controls.sdPlugin/artwork.js");
const sampleKey = (glyph, palette, x) => keySvg(glyph, palette).replace('<svg ', `<svg x="${x}" `);
fs.writeFileSync(`${directory}/controls-sample.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="312" height="144" viewBox="0 0 312 144">${sampleKey(glyphs.stats, palettes.running, 0)}${sampleKey(glyphs.cycles, palettes.stopped, 168)}</svg>`);
fs.writeFileSync(`${plugin}/images/category.svg`, menuIcon(sidebar.stats));
png(menuIcon(sidebar.stats).replace('width="40" height="40"', 'width="256" height="256"'), `${plugin}/images/plugin.png`);
png(menuIcon(sidebar.stats).replace('width="40" height="40"', 'width="512" height="512"'), `${plugin}/images/plugin@2x.png`);
// The requested real Twitch rmrfkoHeart asset is bundled for offline previews.
const heart = fs.readFileSync(`${directory}/rmrfkoHeart.png`).toString("base64");
const dropGate = keySvg(glyphs.twitch, { ...palettes.running, label: 'LIVE' });
const artworkStart = dropGate.indexOf('<g transform="translate(0 2)"');
const artworkEnd = dropGate.indexOf('<circle cx="120"', artworkStart);
assert(artworkStart > 0 && artworkEnd > artworkStart, "DropGate preview must retain its key background and status light");
const heartImage = `<image x="40" y="40" width="64" height="64" href="data:image/png;base64,${heart}"/>`;
fs.writeFileSync(`${directory}/mosdropgate-default.svg`, dropGate.slice(0, artworkStart) + heartImage + dropGate.slice(artworkEnd));
// These exact SVGs are also embedded by the sibling Drop Gate plugin source.
for (const state of ["running", "stopped", "disconnected"]) {
  const label = { running: 'LIVE', stopped: 'OFFLINE', disconnected: 'UNKNOWN' }[state];
  fs.writeFileSync(`${directory}/mosdropgate-${state}.svg`, keySvg(glyphs.twitch, { ...palettes[state], label }));
}
fs.writeFileSync(`${plugin}/licenses/FontAwesome-attribution.txt`, "Icons use the application's existing Font Awesome navigation artwork and gradients without changing glyph geometry. Twitch brand artwork: Font Awesome Free by Fonticons, Inc., CC BY 4.0 (https://fontawesome.com/license/free). Stats/Cycles navigation glyphs reuse the project's existing supplied Font Awesome Pro geometry. Layered gradients are generated by src/sidebar-icons.ts.\n");
