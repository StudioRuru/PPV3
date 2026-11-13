// Rents the RP model pod (default: Behemoth-128B-v3 IQ4_XS on a spot H100), or lists/deletes it.
//   npx tsx scripts/rp-pod.mts up | status | down
import fs from "node:fs";
import { hyperstack } from "../src/lib/comfy/hyperstack"; // remove() only

const HOST = "nai-rp", FLAVOR = "n3-H100x1-bigroot-spot", REGION = "CANADA-1";
const REPO = "https://huggingface.co/bartowski/TheDrummer_Behemoth-128B-v3-GGUF/resolve/main/TheDrummer_Behemoth-128B-v3-IQ4_XS";
const PARTS = ["TheDrummer_Behemoth-128B-v3-IQ4_XS-00001-of-00002.gguf", "TheDrummer_Behemoth-128B-v3-IQ4_XS-00002-of-00002.gguf"];
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("="))
  .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^['"]|['"]$/g, "")]));
const h = hyperstack(env.HYPERSTACK_API_KEY);
const BASE = "https://infrahub-api.nexgencloud.com/v1";
const api = async (m: string, p: string) => (await fetch(BASE + p, { method: m, headers: { api_key: env.HYPERSTACK_API_KEY, accept: "application/json" } })).json() as Promise<any>;
const ours = async () => ((await api("GET", "/core/virtual-machines")).instances ?? []).filter((i: any) => i.name === HOST);

const cmd = process.argv[2];
if (cmd === "up") {
  if ((await ours()).length) throw new Error(`${HOST} already exists`);
  const envName = ((await api("GET", "/core/environments")).environments ?? []).find((e: any) => e.region === REGION)?.name;
  if (/['\r\n]/.test(env.COMFY_TS_AUTHKEY)) throw new Error("bad tailscale key");
  const vars: Record<string, string> = {
    TS_AUTHKEY: env.COMFY_TS_AUTHKEY, HOST, FILE: PARTS[0], CTX: "16384", ALIAS: "behemoth-128b",
    IMAGE: "ghcr.io/ggml-org/llama.cpp:server-cuda", URLS: PARTS.map((p) => `${REPO}/${p}`).join(" "),
  };
  const userData = Object.entries(vars).reduce((t, [k, v]) => t.split(`{{${k}}}`).join(v), fs.readFileSync("pod/rp/cloud-init.yaml", "utf8"));
  // Not h.create: its "nai-comfy" label makes the comfy watchdog delete this VM as an orphan.
  const r = await fetch(BASE + "/core/virtual-machines", { method: "POST", headers: { api_key: env.HYPERSTACK_API_KEY, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ name: HOST, environment_name: envName, flavor_name: FLAVOR, image_name: "Ubuntu Server 22.04 LTS R570 CUDA 12.8 with Docker", key_name: env.HYPERSTACK_KEY_NAME, count: 1, assign_floating_ip: true, user_data: userData, labels: ["nai-rp"] }) });
  const j = await r.json() as any;
  if (!r.ok) throw new Error(`create ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  console.log("created", j.instances?.[0]?.id);
} else if (cmd === "down") {
  for (const i of await ours()) { await h.remove(String(i.id)); console.log("deleted", i.id); }
} else {
  for (const i of await ours()) console.log(i.id, i.status, i.flavor?.name, i.floating_ip);
}
