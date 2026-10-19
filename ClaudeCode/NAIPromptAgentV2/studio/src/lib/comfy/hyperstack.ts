const BASE = "https://infrahub-api.nexgencloud.com/v1";
const IMAGE = "Ubuntu Server 22.04 LTS R570 CUDA 12.8 with Docker";
const LABEL = "nai-comfy";
const CAPACITY = /capacity|stock|available|insufficient/i;
const RESTORE_WAIT_MS = 5 * 60_000;

export type Offer = { env: string; region: string; flavor: string; gpu: string; vramGb: number; usdHr: number };
export class HyperstackError extends Error {
  constructor(msg: string, public status: number) { super(msg); this.name = new.target.name; }
}
export class NoCapacity extends HyperstackError {}
export type Hyperstack = ReturnType<typeof hyperstack>;

// GPUs whose name has no "<n>G" size (e.g. "RTX-A6000"); keys are lower-case alphanumerics.
const VRAM: Record<string, number> = { rtxa4000: 16, rtxa5000: 24, rtxa6000: 48, l40: 48, l40s: 48, rtx6000ada: 48, rtx4000ada: 20, a40: 48, a100: 80, h100: 80, h200: 141 };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const vramOf = (gpu: string) => {
  const m = /(\d+)\s*G(?:B)?\b/i.exec(gpu);
  return m ? Number(m[1]) : (VRAM[norm(gpu)] ?? 0);
};

export function hyperstack(apiKey: string, f: typeof fetch = fetch, opts: { pollMs?: number } = {}) {
  const pollMs = opts.pollMs ?? 10_000;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function req(method: string, path: string, body?: unknown): Promise<Response> {
    // Bounded so a hung request can't freeze the watchdog; the timeout text carries no URL or key.
    const res = await f(BASE + path, {
      signal: AbortSignal.timeout(30_000),
      method,
      headers: { api_key: apiKey, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }).catch((e) => {
      throw new HyperstackError(`hyperstack ${method} ${path.split("?")[0]}: ${e instanceof Error && e.name === "TimeoutError" ? "timed out" : "request failed"}`, 0);
    });
    return res;
  }
  /** Throws on >=400 (unless listed in `ok`); the key is scrubbed from the message. */
  async function call(method: string, path: string, body?: unknown, ok: number[] = []): Promise<Response> {
    const res = await req(method, path, body);
    if (res.status < 400 || ok.includes(res.status)) return res;
    const text = (await res.text().catch(() => "")).slice(0, 300).split(apiKey).join("***");
    throw new (CAPACITY.test(text) ? NoCapacity : HyperstackError)(`hyperstack ${method} ${path.split("?")[0]}: ${res.status} ${text}`, res.status);
  }

  async function status(id: string): Promise<string | null> {
    const res = await call("GET", `/core/virtual-machines/${id}`, undefined, [404]);
    if (res.status === 404) return null;
    return String(((await res.json()) as any).instance?.status ?? "").toUpperCase();
  }
  async function findVolume(name: string): Promise<{ id: number; env: string; status: string } | null> {
    const j = (await (await call("GET", "/core/volumes")).json()) as any;
    const v = (j.volumes ?? []).find((x: any) => x.name === name);
    return v ? { id: Number(v.id), env: String(v.environment?.name ?? ""), status: String(v.status ?? "").toUpperCase() } : null;
  }
  const start = async (id: string) => { await call("GET", `/core/virtual-machines/${id}/start`); };

  return {
    async offers(minVramGb: number, region?: string): Promise<Offer[]> {
      const flavors = (await (await call("GET", "/core/flavors")).json()) as any;
      const envs = (await (await call("GET", "/core/environments")).json()) as any;
      const prices = (await (await call("GET", "/pricebook")).json()) as { name: string; value: string | number }[];
      const envByRegion = new Map<string, string>();
      for (const e of envs.environments ?? []) if (!envByRegion.has(e.region)) envByRegion.set(e.region, e.name);
      const price = new Map(prices.map((p) => [p.name, Number(p.value)])); // exact GPU name only
      const out: Offer[] = [];
      for (const g of flavors.data ?? []) for (const fl of g.flavors ?? []) {
        if (fl.gpu_count !== 1 || !fl.stock_available || String(fl.name).endsWith("-spot")) continue;
        if ((fl.labels ?? []).some((l: any) => l.label === "no-hibernation")) continue;
        const env = envByRegion.get(fl.region_name);
        const usdHr = price.get(fl.gpu);
        if (!env || usdHr === undefined || !Number.isFinite(usdHr)) continue;
        if (region && fl.region_name !== region) continue;
        const vramGb = vramOf(fl.gpu);
        if (vramGb < minVramGb) continue;
        out.push({ env, region: fl.region_name, flavor: fl.name, gpu: fl.gpu, vramGb, usdHr });
      }
      return out.sort((a, b) => a.usdHr - b.usdHr);
    },

    async create(o: Offer, name: string, userData: string, keyName: string): Promise<string> {
      const res = await call("POST", "/core/virtual-machines", {
        name, environment_name: o.env, flavor_name: o.flavor, image_name: IMAGE, key_name: keyName,
        count: 1, assign_floating_ip: true, user_data: userData, labels: [LABEL],
      });
      return String(((await res.json()) as any).instances[0].id);
    },

    status,
    findVolume,

    /** Creates the named Cloud-SSD volume in `env` if missing, then waits until it is free to attach (a flushed VM detaches it on delete). */
    async ensureVolume(name: string, env: string, sizeGb: number): Promise<void> {
      if (!(await findVolume(name))) await call("POST", "/core/volumes", { name, environment_name: env, size: sizeGb, volume_type: "Cloud-SSD", description: LABEL });
      const t0 = Date.now();
      for (let v = await findVolume(name); v?.status !== "AVAILABLE"; v = await findVolume(name)) {
        if (Date.now() - t0 > RESTORE_WAIT_MS) throw new HyperstackError(`hyperstack volume ${name}: ${v?.status ?? "missing"} after 5 min`, 408);
        await sleep(pollMs);
      }
    },

    /** create's volume_name can't see data volumes, so attach once the VM is ACTIVE; the pod waits for the disk. */
    async attachWhenActive(vmId: string, volumeName: string): Promise<void> {
      const t0 = Date.now();
      for (let s = await status(vmId); s !== "ACTIVE"; s = await status(vmId)) {
        if (s === null || s === "ERROR" || Date.now() - t0 > RESTORE_WAIT_MS) throw new HyperstackError(`hyperstack ${vmId}: ${s ?? "gone"} before the models volume attached`, 408);
        await sleep(pollMs);
      }
      const v = await findVolume(volumeName);
      if (!v) throw new HyperstackError(`hyperstack volume ${volumeName}: missing`, 404);
      await call("POST", `/core/virtual-machines/${vmId}/attach-volumes`, { volume_ids: [v.id] });
    },

    async hibernate(id: string, volumeName?: string): Promise<void> {
      // SHUTOFF still bills and can't hibernate: start it first.
      if ((await status(id)) === "SHUTOFF") await start(id);
      // A hibernated VM keeps its volumes, which strands the models if its card goes out of stock: detach first (restore re-attaches; the pod mounts on boot).
      const v = volumeName ? await findVolume(volumeName) : null;
      if (v) await call("POST", `/core/virtual-machines/${id}/detach-volumes`, { volume_ids: [v.id] }).catch((e) => console.warn("comfy models volume detach failed:", e instanceof Error ? e.message : "unknown"));
      await call("GET", `/core/virtual-machines/${id}/hibernate`, undefined, [404]);
    },

    async restore(id: string): Promise<void> {
      if ((await status(id)) === "HIBERNATING") {
        const t0 = Date.now();
        while ((await status(id)) !== "HIBERNATED") {
          if (Date.now() - t0 > RESTORE_WAIT_MS) throw new HyperstackError(`hyperstack ${id}: still HIBERNATING after 5 min`, 408);
          await sleep(pollMs);
        }
      }
      await call("GET", `/core/virtual-machines/${id}/hibernate-restore`);
    },

    start,

    async remove(id: string): Promise<void> {
      await call("DELETE", `/core/virtual-machines/${id}`, undefined, [404]);
    },

    async listOurs(): Promise<{ id: string; status: string }[]> {
      const j = (await (await call("GET", "/core/virtual-machines")).json()) as any;
      return (j.instances ?? [])
        .filter((i: any) => (i.labels ?? []).some((l: any) => (typeof l === "string" ? l : l?.label) === LABEL))
        .map((i: any) => ({ id: String(i.id), status: String(i.status ?? "").toUpperCase() }));
    },
  };
}
