import { build } from "esbuild";
import fs from "node:fs";
const plugin = "streamdeck/com.marblesstats.controls.sdPlugin";
await build({
  entryPoints: [`${plugin}/plugin.js`],
  outfile: `${plugin}/bin/plugin.cjs`,
  bundle: true,
  platform: "node",
  target: "node20.19",
  format: "cjs",
  external: ["bufferutil", "utf-8-validate"],
});
fs.copyFileSync("node_modules/ws/LICENSE", `${plugin}/licenses/ws-MIT.txt`);
