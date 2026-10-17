import { randomUUID } from "node:crypto";

export type OutFile = { filename: string; subfolder: string; type: string };
export const CLIENT_ID = randomUUID();
const POLL_MAX_MS = 30 * 60_000;
const SHORT = () => AbortSignal.timeout(30_000);
const LONG = () => AbortSignal.timeout(120_000);

async function json(f: typeof fetch, url: string, init?: RequestInit): Promise<any> {
  const res = await f(url, init);
  if (!res.ok) throw new Error(`ComfyUI ${init?.method ?? "GET"} ${url.replace(/^https?:\/\/[^/]+/, "").split("?")[0]} failed: ${res.status}`);
  return res.json();
}

export async function ping(base: string, f: typeof fetch = fetch): Promise<boolean> {
  try { return (await f(`${base}/system_stats`, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; }
}

export async function listModels(base: string, f: typeof fetch = fetch) {
  const node = async (n: string) => ((await json(f, `${base}/object_info/${n}`, { signal: SHORT() }))[n]?.input?.required ?? {}) as Record<string, any>;
  const [ck, lo, ks] = await Promise.all([node("CheckpointLoaderSimple"), node("LoraLoader"), node("KSampler")]);
  const list = (o: Record<string, any>, k: string): string[] => {
    const v = o[k];
    if (Array.isArray(v?.[0])) return v[0];
    if (v?.[0] === "COMBO" && Array.isArray(v[1]?.options)) return v[1].options;
    return [];
  };
  return { checkpoints: list(ck, "ckpt_name"), loras: list(lo, "lora_name"), samplers: list(ks, "sampler_name"), schedulers: list(ks, "scheduler") };
}

export async function upload(base: string, name: string, png: Buffer, f: typeof fetch = fetch): Promise<string> {
  const fd = new FormData();
  fd.set("image", new Blob([new Uint8Array(png)], { type: "image/png" }), name);
  fd.set("overwrite", "true");
  const r = await json(f, `${base}/upload/image`, { method: "POST", body: fd, signal: LONG() });
  return r.subfolder ? `${r.subfolder}/${r.name}` : r.name;
}

export async function submit(base: string, graph: object, f: typeof fetch = fetch): Promise<string> {
  const res = await f(`${base}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: graph, client_id: CLIENT_ID }), signal: SHORT() });
  if (res.ok) return ((await res.json()) as any).prompt_id;
  const body: any = await res.json().catch(() => ({}));
  const parts = Object.values<any>(body.node_errors ?? {}).map((n) =>
    `${n.class_type}: ${(n.errors ?? []).map((e: any) => (e.details ? `${e.message} (${e.details})` : e.message)).join(", ")}`);
  throw new Error(parts.length ? parts.join("; ") : body.error?.message ?? `ComfyUI rejected the prompt (${res.status})`);
}

function collect(outputs: any): OutFile[] {
  const files: OutFile[] = [];
  for (const o of Object.values<any>(outputs ?? {}))
    for (const k of ["images", "gifs", "videos"]) for (const x of o?.[k] ?? []) files.push({ filename: x.filename, subfolder: x.subfolder ?? "", type: x.type ?? "output" });
  return files;
}

function historyError(h: any): string {
  const m = (h.status?.messages ?? []).find((x: any) => x[0] === "execution_error");
  return m?.[1]?.exception_message ?? "ComfyUI reported an error while running the job.";
}

export function watch(
  base: string, promptId: string, onProgress: (p: number) => void,
  opts: { ws?: typeof WebSocket; f?: typeof fetch; pollMs?: number; signal?: AbortSignal } = {},
): Promise<{ files: OutFile[] }> {
  const f = opts.f ?? fetch, WS = opts.ws ?? globalThis.WebSocket, pollMs = opts.pollMs ?? 2000;
  return new Promise((resolve, reject) => {
    let done = false, polling = false, sock: WebSocket | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (fn: () => void) => {
      if (done) return;
      done = true; clearTimeout(timer);
      try { sock?.close(); } catch { /* already closed */ }
      fn();
    };
    /** One /history check; true once the prompt is in history (and we settled). */
    const check = async (): Promise<boolean> => {
      const res = await f(`${base}/history/${promptId}`, { signal: SHORT() });
      if (!res.ok) return false;
      const h = ((await res.json()) as any)[promptId];
      if (!h) return false;
      if (h.status?.status_str === "error") settle(() => reject(new Error(historyError(h))));
      else settle(() => resolve({ files: collect(h.outputs) }));
      return true;
    };
    const poll = async () => {
      if (polling || done) return;
      polling = true;
      const deadline = Date.now() + POLL_MAX_MS;
      while (!done) {
        try { if (await check()) return; } catch { /* retry next tick */ }
        if (Date.now() > deadline) return settle(() => reject(new Error("Timed out after 30 minutes waiting for ComfyUI to finish the job.")));
        if (done) return;
        await new Promise((r) => (timer = setTimeout(r, pollMs)));
      }
    };
    const finish = () => check().then((ok) => { if (!ok) void poll(); }, poll);
    const abort = () => settle(() => reject(new Error("The app stopped watching this job.")));
    if (opts.signal?.aborted) return abort();
    opts.signal?.addEventListener("abort", abort, { once: true });

    try {
      sock = new WS(`${base.replace(/^http/, "ws")}/ws?clientId=${CLIENT_ID}`);
    } catch { return void poll(); }
    sock.addEventListener("open", () => { check().catch(() => {}); }); // catches prompts that finished before we connected
    sock.addEventListener("close", () => { void poll(); });
    sock.addEventListener("error", () => { void poll(); });
    sock.addEventListener("message", (ev: MessageEvent) => {
      if (typeof ev.data !== "string") return; // binary preview frames
      let m: any;
      try { m = JSON.parse(ev.data); } catch { return; }
      const d = m.data ?? {};
      if (d.prompt_id !== promptId) return;
      if (m.type === "progress" && d.max) onProgress(d.value / d.max);
      else if (m.type === "execution_error") settle(() => reject(new Error(d.exception_message || "ComfyUI reported an error while running the job.")));
      else if (m.type === "execution_interrupted") settle(() => reject(new Error("The job was cancelled.")));
      else if (m.type === "execution_success" || (m.type === "executing" && d.node === null)) void finish();
    });
  });
}

/** Best-effort: stops whatever the pod is running. Never throws. */
export async function interrupt(base: string, f: typeof fetch = fetch): Promise<void> {
  await f(`${base}/interrupt`, { method: "POST", signal: SHORT() }).catch(() => {});
}

export async function fetchOutput(base: string, file: OutFile, f: typeof fetch = fetch): Promise<Buffer> {
  const q = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder, type: file.type });
  const res = await f(`${base}/view?${q}`, { signal: LONG() });
  if (!res.ok) throw new Error(`ComfyUI /view failed for ${file.filename}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
