import { test } from "node:test";
import assert from "node:assert/strict";
import { hyperstack, HyperstackError, NoCapacity } from "./hyperstack";

type Call = { method: string; path: string; body?: any; headers?: any };
/** Fake fetch: routes are "METHOD path" -> response or queue of responses. */
function fake(routes: Record<string, any>) {
  const calls: Call[] = [];
  const f = (async (url: string, init: any = {}) => {
    const path = url.replace("https://infrahub-api.nexgencloud.com/v1", "");
    const method = init.method ?? "GET";
    calls.push({ method, path, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
    let r = routes[`${method} ${path}`];
    if (Array.isArray(r)) r = r.length > 1 ? r.shift() : r[0];
    if (r === undefined) r = { status: 404, body: {} };
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.body ?? {}, text: async () => JSON.stringify(r.body ?? {}) };
  }) as unknown as typeof fetch;
  return { f, calls };
}
const fl = (name: string, gpu: string, extra: any = {}) => ({ name, gpu, gpu_count: 1, stock_available: true, region_name: "CANADA-1", labels: [], ...extra });

test("offers filter and price", async () => {
  const { f, calls } = fake({
    "GET /core/flavors": { body: { data: [{ flavors: [
      fl("n3-L40x1", "L40"),
      fl("n3-A6000x1", "RTX-A6000"),
      fl("n3-H100x1", "H100-80G-PCIe", { stock_available: false }),
      fl("n3-A100x1-spot", "A100-80G-PCIe"),
      fl("n3-X", "A100-80G-PCIe", { labels: [{ label: "no-hibernation" }] }),
      fl("n3-L40x2", "L40", { gpu_count: 2 }),
    ] }] } },
    "GET /core/environments": { body: { environments: [{ region: "CANADA-1", name: "env-ca" }] } },
    "GET /pricebook": { body: [{ name: "L40", value: "1.00" }, { name: "RTX-A6000", value: "0.5" }, { name: "A100-80G-PCIe", value: "1.6" }] },
  });
  const o = await hyperstack("KEY", f).offers(48);
  assert.deepEqual(o.map((x) => [x.gpu, x.usdHr, x.vramGb]), [["RTX-A6000", 0.5, 48], ["L40", 1, 48]]);
  assert.equal(o[0].env, "env-ca");
  assert.equal(o[0].flavor, "n3-A6000x1");
  assert.equal(calls[0].headers.api_key, "KEY");
  assert.equal(calls[0].headers.accept, "application/json");
});

test("create sends key_name, label and user_data and returns id", async () => {
  const { f, calls } = fake({ "POST /core/virtual-machines": { body: { instances: [{ id: 42 }] } } });
  const id = await hyperstack("KEY", f).create({ env: "e", region: "r", flavor: "fl", gpu: "L40", vramGb: 48, usdHr: 1 }, "vm1", "#cloud", "mykey");
  assert.equal(id, "42");
  assert.deepEqual(calls[0].body, {
    name: "vm1", environment_name: "e", flavor_name: "fl", image_name: "Ubuntu Server 22.04 LTS R570 CUDA 12.8 with Docker",
    key_name: "mykey", count: 1, assign_floating_ip: true, user_data: "#cloud", labels: ["nai-comfy"],
  });
});

test("ensureVolume creates a missing volume and waits until it is available; attachWhenActive waits for ACTIVE", async () => {
  const { f, calls } = fake({
    "GET /core/volumes": [{ body: { volumes: [] } }, { body: { volumes: [{ id: 5, name: "v", status: "creating", environment: { name: "e" } }] } }, { body: { volumes: [{ id: 5, name: "v", status: "available", environment: { name: "e" } }] } }],
    "POST /core/volumes": { body: {} },
    "GET /core/virtual-machines/1": [{ body: { instance: { status: "BUILD" } } }, { body: { instance: { status: "ACTIVE" } } }],
    "POST /core/virtual-machines/1/attach-volumes": { body: {} },
  });
  const hs = hyperstack("KEY", f, { pollMs: 0 });
  await hs.ensureVolume("v", "e", 150);
  assert.deepEqual(calls[1].body, { name: "v", environment_name: "e", size: 150, volume_type: "Cloud-SSD", description: "nai-comfy" });
  assert.deepEqual(await hs.findVolume("v"), { id: 5, env: "e", status: "AVAILABLE" });
  await hs.attachWhenActive("1", "v");
  assert.deepEqual(calls.at(-1)!.body, { volume_ids: [5] });
  assert.equal(calls.filter((c) => c.path === "/core/virtual-machines/1").length, 2);
});

test("hibernate from SHUTOFF starts first", async () => {
  const { f, calls } = fake({
    "GET /core/virtual-machines/7": { body: { instance: { status: "shutoff" } } },
    "GET /core/virtual-machines/7/start": {},
    "GET /core/virtual-machines/7/hibernate": {},
  });
  await hyperstack("KEY", f).hibernate("7");
  assert.deepEqual(calls.map((c) => c.path), ["/core/virtual-machines/7", "/core/virtual-machines/7/start", "/core/virtual-machines/7/hibernate"]);
});

test("restore while HIBERNATING waits for HIBERNATED", async () => {
  const { f, calls } = fake({
    "GET /core/virtual-machines/7": [{ body: { instance: { status: "HIBERNATING" } } }, { body: { instance: { status: "HIBERNATED" } } }],
    "GET /core/virtual-machines/7/hibernate-restore": {},
  });
  await hyperstack("KEY", f, { pollMs: 0 }).restore("7");
  assert.deepEqual(calls.map((c) => c.path), [
    "/core/virtual-machines/7", "/core/virtual-machines/7", "/core/virtual-machines/7/hibernate-restore",
  ]);
});

test("restore capacity error throws NoCapacity", async () => {
  const { f } = fake({
    "GET /core/virtual-machines/7": { body: { instance: { status: "HIBERNATED" } } },
    "GET /core/virtual-machines/7/hibernate-restore": { status: 400, body: { message: "Insufficient capacity" } },
  });
  await assert.rejects(hyperstack("KEY", f).restore("7"), NoCapacity);
});

test("status 404 -> null; remove 404 -> ok", async () => {
  const { f } = fake({});
  const h = hyperstack("KEY", f);
  assert.equal(await h.status("9"), null);
  await h.remove("9");
});

test("listOurs keeps only label nai-comfy", async () => {
  const { f } = fake({ "GET /core/virtual-machines": { body: { instances: [
    { id: 1, status: "active", labels: ["nai-comfy"] },
    { id: 2, status: "ACTIVE", labels: ["doppelganger"] },
    { id: 3, status: "HIBERNATED", labels: [{ label: "nai-comfy" }] },
  ] } } });
  assert.deepEqual(await hyperstack("KEY", f).listOurs(), [{ id: "1", status: "ACTIVE" }, { id: "3", status: "HIBERNATED" }]);
});

test("errors never include the api key", async () => {
  const { f } = fake({ "GET /core/flavors": { status: 401, body: { message: "bad api_key SECRETKEY123" } } });
  await assert.rejects(hyperstack("SECRETKEY123", f).offers(48), (e: any) => {
    assert.ok(e instanceof HyperstackError);
    assert.equal(e.status, 401);
    assert.ok(!e.message.includes("SECRETKEY123"));
    return true;
  });
});

const st = (s: string) => ({ body: { instance: { status: s } } });
const vols = { body: { volumes: [{ id: 5, name: "vol", status: "available", environment: { name: "e" } }] } };

test("attach waits through RESTORING then attaches", async () => {
  const { f, calls } = fake({
    "GET /core/virtual-machines/7": [st("RESTORING"), st("ACTIVE")],
    "GET /core/volumes": vols,
    "POST /core/virtual-machines/7/attach-volumes": { status: 200 },
  });
  await hyperstack("K", f, { pollMs: 1 }).attachWhenActive("7", "vol");
  assert.ok(calls.some((c) => c.method === "POST" && c.path.endsWith("/attach-volumes")));
});

test("attach 400 'already attached' is success", async () => {
  const { f } = fake({
    "GET /core/virtual-machines/7": st("ACTIVE"),
    "GET /core/volumes": vols,
    "POST /core/virtual-machines/7/attach-volumes": { status: 400, body: { message: "There are already attached Volumes" } },
  });
  await hyperstack("K", f, { pollMs: 1 }).attachWhenActive("7", "vol");
});

test("attach throws on ERROR", async () => {
  const { f } = fake({ "GET /core/virtual-machines/7": st("ERROR") });
  await assert.rejects(hyperstack("K", f, { pollMs: 1 }).attachWhenActive("7", "vol"), /ERROR/);
});

test("restore waits out a transitional state before calling", async () => {
  const { f, calls } = fake({
    "GET /core/virtual-machines/7": [st("HIBERNATING"), st("HIBERNATING"), st("HIBERNATED")],
    "GET /core/virtual-machines/7/hibernate-restore": {},
  });
  await hyperstack("K", f, { pollMs: 1 }).restore("7");
  const r = calls.filter((c) => c.path.endsWith("/hibernate-restore"));
  assert.equal(r.length, 1);
  assert.equal(calls.indexOf(r[0]), 3);
});

test("hibernate skips detach when not ACTIVE/SHUTOFF", async () => {
  const { f, calls } = fake({
    "GET /core/virtual-machines/7": st("RESTORING"),
    "GET /core/volumes": vols,
    "GET /core/virtual-machines/7/hibernate": {},
  });
  assert.deepEqual(await hyperstack("K", f, { pollMs: 1 }).hibernate("7", "vol"), { detached: false });
  assert.ok(!calls.some((c) => c.path.endsWith("/detach-volumes")));
  assert.ok(calls.some((c) => c.path.endsWith("/hibernate")));
});

test("hibernate detaches when ACTIVE", async () => {
  const { f, calls } = fake({
    "GET /core/virtual-machines/7": st("ACTIVE"),
    "GET /core/volumes": vols,
    "POST /core/virtual-machines/7/detach-volumes": {},
    "GET /core/virtual-machines/7/hibernate": {},
  });
  assert.deepEqual(await hyperstack("K", f, { pollMs: 1 }).hibernate("7", "vol"), { detached: true });
  const p = calls.map((c) => c.path);
  assert.ok(p.indexOf("/core/virtual-machines/7/detach-volumes") < p.indexOf("/core/virtual-machines/7/hibernate"));
});
