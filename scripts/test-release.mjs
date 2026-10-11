// Test release ordering with mocked Git; never builds, tags or pushes a real repo.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runRelease, versionFiles } from "./release.mjs";

for (const failPush of [false, true]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mosStats-release-test-"));
  try {
    for (const file of versionFiles) {
      const destination = path.join(root, file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(new URL(`../${file}`, import.meta.url), destination);
    }
    let branch = "dev";
    const calls = [];
    const git = (...args) => {
      calls.push(args);
      if (args[0] === "branch") return branch;
      if (args[0] === "status" || args[0] === "tag" && args[1] === "--list") return "";
      if (args[0] === "remote") return "https://github.com/smolpuff/northKoreaStatsAndCycles.git";
      if (args[0] === "rev-parse" || args[0] === "merge-base") return "base";
      if (args[0] === "show") return fs.readFileSync(path.join(root, "version.json"), "utf8");
      if (args[0] === "checkout") branch = args[1];
      if (["commit", "tag", "push"].includes(args[0])) assert.equal(branch, "main");
      if (args[0] === "push" && failPush) throw Error("Simulated push failure");
      return "";
    };
    if (failPush) assert.throws(() => runRelease(["--notes", "Test release"], root, git), /created on main/);
    else runRelease(["--notes", "Test release"], root, git);
    assert.equal(branch, "dev");
    const checkoutMain = calls.findIndex(args => args[0] === "checkout" && args[1] === "main");
    const promote = calls.findIndex(args => args.join(" ") === "merge --ff-only dev");
    const commit = calls.findIndex(args => args[0] === "commit");
    assert(checkoutMain < promote && promote < commit);
    assert(calls.some(args => args.join(" ") === "merge --ff-only main"));
    assert(calls.some(args => args[0] === "push" && args[1] === "--atomic"));
  } finally {
    fs.rmSync(root, { recursive: true });
  }
}
console.log("Passed main-only release ordering, atomic push and return-to-dev checks, including push failure.");
