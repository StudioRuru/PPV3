import { test } from "node:test";
import assert from "node:assert/strict";
import { ping, listModels, upload, submit, watch, fetchOutput, interrupt, CLIENT_ID } from "./client";

const B = "http://nai-comfy-main:8188";
type Call = { method: string; path: string; init: any };
function fake(routes: Record<string, any>) {
  const calls: Call[] = [];
  const f = (async (url: string, init: any = {}) => {
    const path = url.replace(B, "");
    const method = init.method ?? "GET";
    calls.push({ method, path, init });
    let r = routes[`${method} ${path}`];
    if (Array.isArray(r)) r = r.length > 1 ? r.shift() : r[0];
    if (r === undefined) r = { status: 404, body: {} };
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.body ?? {}, text: async () => JSON.stringify(r.body ?? {}), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  }) as unknown as typeof fetch;
  return { f, calls };
}

class FakeWS {
  static last: FakeWS;
  closed = false;
  ls: Record<string, ((e: any) => void)[]> = {};
  constructor(public url: string) { FakeWS.last = this; }
  addEventListener(t: string, fn: (e: any) => void) { (this.ls[t] ??= []).push(fn); }
  close() { this.closed = true; }
  emit(t: string, data?: unknown) { for (const fn of this.ls[t] ?? []) fn({ data: typeof data === "string" || data === undefined ? data : JSON.stringify(data) }); }
}
const WS = FakeWS as unknown as typeof WebSocket;
const tick = () => new Promise((r) => setTimeout(r, 5));
const hist = { "p1": { outputs: { "9": { images: [{ filename: "a.png", subfolder: "", type: "output" }] }, "12": { gifs: [{ filename: "b.mp4", subfolder: "v", type: "output" }] } }, status: { status_str: "success" } } };

test("ping is false on failure", async () => {
  assert.equal(await ping(B, fake({ "GET /system_stats": { body: {} } }).f), true);
  assert.equal(await ping(B, (async () => { throw new Error("x"); }) as any), false);
  assert.equal(await ping(B, fake({}).f), false);
});

test("listModels reads object_info", async () => {
  const { f } = fake({
    "GET /object_info/CheckpointLoaderSimple": { body: { CheckpointLoaderSimple: { input: { required: { ckpt_name: [["a.safetensors"]] } } } } },
    "GET /object_info/LoraLoader": { body: { LoraLoader: { input: { required: { lora_name: [["l1", "l2"]] } } } } },
    "GET /object_info/KSampler": { body: { KSampler: { input: { required: { sampler_name: [["euler"]], scheduler: [["karras"]] } } } } },
    "GET /object_info/UNETLoader": { body: { UNETLoader: { input: { required: { unet_name: [["wan2.2_ti2v_5B_fp16.safetensors", "noctQAnime_v10_fp8.safetensors"]] } } } } },
  });
  assert.deepEqual(await listModels(B, f), { checkpoints: ["a.safetensors", "noctQAnime_v10_fp8.safetensors"], loras: ["l1", "l2"], samplers: ["euler"], schedulers: ["karras"] });
});

test("upload sends multipart and returns stored name", async () => {
  const { f, calls } = fake({ "POST /upload/image": { body: { name: "x.png", subfolder: "sub" } } });
  assert.equal(await upload(B, "x.png", Buffer.from("png"), f), "sub/x.png");
  const fd = calls[0].init.body as FormData;
  assert.equal(fd.get("overwrite"), "true");
  assert.equal((fd.get("image") as File).name, "x.png");
});

test("submit sends client_id and returns prompt_id", async () => {
  const { f, calls } = fake({ "POST /prompt": { body: { prompt_id: "p1" } } });
  assert.equal(await submit(B, { "1": {} }, f), "p1");
  assert.deepEqual(JSON.parse(calls[0].init.body), { prompt: { "1": {} }, client_id: CLIENT_ID });
});

test("submit surfaces node_errors as one sentence", async () => {
  const { f } = fake({ "POST /prompt": { status: 400, body: { error: { message: "Prompt outputs failed validation" }, node_errors: {
    "3": { class_type: "KSampler", errors: [{ message: "Value not in list", details: "sampler_name: 'bad'" }] },
    "4": { class_type: "LoraLoader", errors: [{ message: "Missing" }] } } } } });
  await assert.rejects(submit(B, {}, f), (e: Error) => e.message === "KSampler: Value not in list (sampler_name: 'bad'); LoraLoader: Missing");
});

test("submit rejects a 200 that dropped outputs and dequeues the partial run", async () => {
  const { f, calls } = fake({ "POST /prompt": { body: { prompt_id: "p9", node_errors: {
    rife: { class_type: "RIFE VFI", errors: [{ message: "Required input is missing", details: "dtype" }] } } } }, "POST /queue": { body: {} } });
  await assert.rejects(submit(B, {}, f), (e: Error) => e.message === "RIFE VFI: Required input is missing (dtype)");
  assert.deepEqual(JSON.parse(calls[1].init.body), { delete: ["p9"] });
});

test("submit 400 without node_errors uses error.message", async () => {
  const { f } = fake({ "POST /prompt": { status: 400, body: { error: { message: "bad graph" } } } });
  await assert.rejects(submit(B, {}, f), /bad graph/);
});

test("watch reports progress and resolves with history outputs", async () => {
  const { f, calls } = fake({ "GET /history/p1": [{ body: {} }, { body: hist }] });
  const seen: number[] = [];
  const p = watch(B, "p1", (x) => seen.push(x), { ws: WS, f });
  const ws = FakeWS.last;
  assert.equal(ws.url, `ws://nai-comfy-main:8188/ws?clientId=${CLIENT_ID}`);
  ws.emit("open");
  await tick();
  ws.emit("message", { type: "progress", data: { prompt_id: "other", value: 9, max: 10 } });
  ws.emit("message", { type: "progress", data: { prompt_id: "p1", value: 5, max: 20 } });
  ws.emit("message", { type: "executing", data: { prompt_id: "p1", node: null } });
  const r = await p;
  assert.deepEqual(seen, [0.25]);
  assert.deepEqual(r.files, [{ filename: "a.png", subfolder: "", type: "output" }, { filename: "b.mp4", subfolder: "v", type: "output" }]);
  assert.equal(ws.closed, true);
  assert.equal(calls.length, 2);
});

test("watch resolves from history when the prompt finished before the socket opened", async () => {
  const { f } = fake({ "GET /history/p1": { body: hist } });
  const p = watch(B, "p1", () => {}, { ws: WS, f });
  FakeWS.last.emit("open");
  assert.equal((await p).files.length, 2);
});

test("watch rejects on execution_error with its message", async () => {
  const { f } = fake({ "GET /history/p1": { body: {} } });
  const p = watch(B, "p1", () => {}, { ws: WS, f });
  FakeWS.last.emit("open");
  await tick();
  FakeWS.last.emit("message", { type: "execution_error", data: { prompt_id: "p1", exception_message: "CUDA out of memory" } });
  await assert.rejects(p, /CUDA out of memory/);
  assert.equal(FakeWS.last.closed, true);
});

test("watch falls back to /history when the socket drops", async () => {
  const { f } = fake({ "GET /history/p1": [{ body: {} }, { body: {} }, { body: hist }] });
  const p = watch(B, "p1", () => {}, { ws: WS, f, pollMs: 5 });
  FakeWS.last.emit("close");
  assert.equal((await p).files.length, 2);
});

test("watch poll rejects when history reports an error", async () => {
  const bad = { p1: { outputs: {}, status: { status_str: "error", messages: [["execution_error", { exception_message: "node blew up" }]] } } };
  const { f } = fake({ "GET /history/p1": { body: bad } });
  const p = watch(B, "p1", () => {}, { ws: WS, f, pollMs: 5 });
  FakeWS.last.emit("error");
  await assert.rejects(p, /node blew up/);
});

test("fetchOutput returns bytes", async () => {
  const { f, calls } = fake({ "GET /view?filename=a.png&subfolder=&type=output": {} });
  assert.deepEqual([...await fetchOutput(B, { filename: "a.png", subfolder: "", type: "output" }, f)], [1, 2, 3]);
  assert.equal(calls.length, 1);
});

test("watch rejects on execution_interrupted and closes the socket", async () => {
  const { f } = fake({ "GET /history/p1": { body: {} } });
  const p = watch(B, "p1", () => {}, { ws: WS, f });
  FakeWS.last.emit("open");
  await tick();
  FakeWS.last.emit("message", { type: "execution_interrupted", data: { prompt_id: "p1" } });
  await assert.rejects(p, /The job was cancelled\./);
  assert.equal(FakeWS.last.closed, true);
});

test("listModels accepts legacy and COMBO input shapes", async () => {
  const { f } = fake({
    "GET /object_info/CheckpointLoaderSimple": { body: { CheckpointLoaderSimple: { input: { required: { ckpt_name: ["COMBO", { options: ["c1"] }] } } } } },
    "GET /object_info/LoraLoader": { body: { LoraLoader: { input: { required: { lora_name: "weird" } } } } },
    "GET /object_info/KSampler": { body: { KSampler: { input: { required: { sampler_name: [["euler"]], scheduler: ["COMBO", { options: ["karras"] }] } } } } },
    "GET /object_info/UNETLoader": { body: { UNETLoader: { input: { required: { unet_name: ["COMBO", { options: ["noctQRealism_v40Base_fp8.safetensors", "umt5.safetensors"] }] } } } } },
  });
  assert.deepEqual(await listModels(B, f), { checkpoints: ["c1", "noctQRealism_v40Base_fp8.safetensors"], loras: [], samplers: ["euler"], schedulers: ["karras"] });
});

test("watch settles and closes the socket when its signal aborts", async () => {
  const { f } = fake({ "GET /history/p1": { body: {} } });
  const ac = new AbortController();
  const p = watch(B, "p1", () => {}, { ws: WS, f, signal: ac.signal });
  ac.abort();
  await assert.rejects(p, /stopped watching/);
  assert.equal(FakeWS.last.closed, true);
});

test("interrupt posts /interrupt and swallows failures", async () => {
  const { f, calls } = fake({ "POST /interrupt": {} });
  await interrupt(B, f);
  assert.equal(calls[0].path, "/interrupt");
  await interrupt(B, (async () => { throw new Error("down"); }) as unknown as typeof fetch);
});
