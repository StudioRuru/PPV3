import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

const SCRIPT = path.resolve(__dirname, "../../scripts/power.sh");
// Port 9 (discard) is never listening: every service reads as down, and `down` has nothing to kill.
const DEAD = { OLLAMA_URL: "http://127.0.0.1:9", TAGGER_URL: "http://127.0.0.1:9", CAPTION_URL: "http://127.0.0.1:9", TIPO_URL: "http://127.0.0.1:9" };
const run = (...args: string[]) => spawnSync("bash", [SCRIPT, ...args], { env: { ...process.env, ...DEAD }, encoding: "utf8" });

test("status reports each service and exits 1 when any is down", () => {
  const r = run("status");
  assert.equal(r.status, 1);
  for (const s of ["brain", "tagger", "caption", "tipo"]) assert.match(r.stdout, new RegExp(`^${s}\\s+down$`, "m"));
});

test("down with nothing running succeeds", () => {
  const r = run("down");
  assert.equal(r.status, 0, r.stderr);
});

test("unknown action prints usage and exits 2", () => {
  const r = run("sideways");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: power\.sh up\|down\|status/);
});

test("power() runs the script from the app and reports failure", async () => {
  const { power } = await import("./llm");
  Object.assign(process.env, DEAD);
  assert.deepEqual(await power("status"), { ok: false, err: "" });
});
