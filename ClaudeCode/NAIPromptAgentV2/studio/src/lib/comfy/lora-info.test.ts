import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { migrate } from "./store";
import { familyOf, fromHeader, fromCivitai, fits, resolveInfo } from "./lora-info";

test("familyOf maps base-model strings", () => {
  for (const s of ["SDXL 1.0", "Pony", "Illustrious", "NoobAI", "sdxl_base_v1-0", "stable-diffusion-xl-v1-base/lora"]) assert.equal(familyOf(s), "sdxl");
  assert.equal(familyOf("Qwen"), "qwen"); assert.equal(familyOf("qwen-image/lora"), "qwen");
  assert.equal(familyOf("Krea 2"), "krea2"); assert.equal(familyOf("MOSS"), "moss");
  assert.equal(familyOf("Wan Video 2.2 I2V-A14B"), null); assert.equal(familyOf(""), null);
});
test("fromHeader reads base model and top tags", () => {
  const i = fromHeader({ ss_base_model_version: "sdxl_base_v1-0", ss_tag_frequency: JSON.stringify({ "10_lenovo": { "lenovo woman": 40, "smile": 3 } }) });
  assert.deepEqual(i, { family: "sdxl", words: ["lenovo woman"], weight: null });
});
test("fromCivitai reads baseModel and trainedWords", () => {
  assert.deepEqual(fromCivitai({ baseModel: "Qwen", trainedWords: ["lenovo woman, ", " detailed skin"] }), { family: "qwen", words: ["lenovo woman", "detailed skin"], weight: null });
});
test("fits treats unknown as fitting everything", () => {
  assert.equal(fits(undefined, "moss"), true); assert.equal(fits({ family: null, words: [], weight: null }, "moss"), true);
  assert.equal(fits({ family: "sdxl", words: [], weight: null }, "moss"), false);
});

const mk = () => { const db = new Database(":memory:"); migrate(db); return db; };
const rows = (db: Database.Database) => (db.prepare("SELECT count(*) c FROM comfy_lora_info").get() as { c: number }).c;
const ok = (body: unknown) => (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;

test("resolveInfo caches civitai answers by name", async () => {
  const db = mk(); let calls = 0;
  const f = (async (u: string | URL | Request, init?: RequestInit) => {
    calls++; assert.match(String(u), /by-hash\/abc$/); assert.equal((init?.headers as Record<string, string>).Authorization.startsWith("Bearer "), true);
    return new Response(JSON.stringify({ baseModel: "Qwen", trainedWords: ["lenovo woman"] }));
  }) as typeof fetch;
  const deps = { db, manifestSha: new Map([["a.safetensors", "abc"]]), dir: "/nonexistent", fetch: f };
  const want = { family: "qwen", words: ["lenovo woman"], weight: null };
  assert.deepEqual(await resolveInfo(["a.safetensors"], deps), { "a.safetensors": want });
  assert.deepEqual(await resolveInfo(["a.safetensors"], deps), { "a.safetensors": want });
  assert.equal(calls, 1);
});
test("lookup failure caches nothing and reports unknown", async () => {
  const db = mk(); const unknown = { family: null, words: [], weight: null };
  const deps = { db, manifestSha: new Map([["a.safetensors", "abc"]]), dir: "/nonexistent" };
  assert.deepEqual(await resolveInfo(["a.safetensors"], { ...deps, fetch: (async () => { throw new Error("down"); }) as typeof fetch }), { "a.safetensors": unknown });
  assert.deepEqual(await resolveInfo(["a.safetensors"], { ...deps, fetch: (async () => new Response("no", { status: 404 })) as typeof fetch }), { "a.safetensors": unknown });
  assert.equal(rows(db), 0);
});
test("header info on a Mac file wins; civitai fills gaps", async () => {
  const db = mk(); const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lora-"));
  const hdr = Buffer.from(JSON.stringify({ __metadata__: { ss_base_model_version: "sdxl_base_v1-0" } }));
  const len = Buffer.alloc(8); len.writeBigUInt64LE(BigInt(hdr.length));
  fs.writeFileSync(path.join(dir, "m.safetensors"), Buffer.concat([len, hdr]));
  const i = await resolveInfo(["m.safetensors"], { db, manifestSha: new Map(), dir, fetch: ok({ baseModel: "Qwen", trainedWords: ["zz"] }) });
  assert.deepEqual(i["m.safetensors"], { family: "sdxl", words: ["zz"], weight: null });
});
