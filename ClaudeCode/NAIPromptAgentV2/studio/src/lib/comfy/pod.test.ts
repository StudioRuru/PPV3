import { test } from "node:test";
import assert from "node:assert/strict";
import YAML from "yaml";
import { readManifest, renderCloudInit, podHost, syncModels, tailnetIp, COMFY_PORT } from "./pod";

const secrets = { tsAuthKey: "tskey-test", hfToken: "hf_test", civitaiToken: "civ_test" };

test("manifest validates", () => {
  const m = readManifest();
  assert.ok(m.length > 5);
  for (const e of m) {
    assert.match(e.sha256, /^[0-9a-f]{64}$/, e.filename);
    assert.ok(e.size > 0 && e.urls.every((u) => u.startsWith("https://")) && e.licence, e.filename);
  }
});

test("cloud-init embeds host, tag and flags", () => {
  const out = renderCloudInit("main", secrets);
  for (const s of ["nai-comfy-main", "tag:comfy-pod", "--disable-cuda-malloc", "tskey-test"]) assert.ok(out.includes(s), s);
  assert.ok(!out.includes("0.0.0.0"));
  assert.ok(!out.includes("{{"));
  assert.equal(podHost("boost"), "nai-comfy-boost");
  assert.equal(COMFY_PORT, 8188);
});

test("main mounts a 150 GB models volume and only goes ready after a clean fetch", () => {
  assert.ok(renderCloudInit("main", secrets).includes("MODELS_GB='150'"));
  assert.ok(renderCloudInit("boost", secrets).includes("MODELS_GB=''"));
  assert.ok(renderCloudInit("main", secrets).includes("fetch-models.sh /opt/comfy-manifest.yaml && systemctl enable --now comfy.service"));
});

test("boost cloud-init only carries boost models", () => {
  const out = renderCloudInit("boost", secrets);
  const b64 = /manifest\.yaml[\s\S]*?content: (\S+)/.exec(out)![1];
  const entries = YAML.parse(Buffer.from(b64, "base64").toString()) as { cards: string[] }[];
  assert.ok(entries.length > 0);
  assert.ok(entries.every((e) => e.cards.includes("boost")));
  assert.ok(entries.length < readManifest().length);
});

test("syncModels sends the manifest on stdin to the right host", async () => {
  const calls: { cmd: string; args: string[]; stdin: string }[] = [];
  const out = await syncModels("boost", async (cmd, args, stdin) => { calls.push({ cmd, args, stdin }); return "ok"; });
  assert.equal(out, "ok");
  assert.equal(calls[0].cmd, "ssh");
  assert.ok(calls[0].args.includes("root@nai-comfy-boost"));
  const a = calls[0].args.join(" ");
  for (const o of ["BatchMode=yes", "StrictHostKeyChecking=no", "UserKnownHostsFile=/dev/null"]) assert.ok(a.includes(o), o);
  assert.ok(calls[0].args.join(" ").endsWith("bash /opt/comfy/fetch-models.sh"));
  assert.ok(YAML.parse(calls[0].stdin).every((e: { cards: string[] }) => e.cards.includes("boost")));
});

test("wrapper waits for a tailnet IP and never listens bare", () => {
  const out = renderCloudInit("main", secrets);
  assert.ok(out.includes("ip=$(tailscale ip -4 2>/dev/null | head -n1)"));
  assert.ok(out.includes('[ -n "$ip" ] || {'));
  assert.ok(out.includes('--listen "$ip"'));
  assert.ok(!/--listen(?! "\$ip")/.test(out));
  assert.ok(!out.includes("0.0.0.0"));
  assert.ok(out.includes("After=network-online.target tailscaled.service"));
});

test("tailnetIp picks the online node by requested HostName, not the stale bare name", async () => {
  const json = JSON.stringify({ Peer: {
    a: { HostName: "nai-comfy-main", DNSName: "nai-comfy-main.x.ts.net.", Online: false, TailscaleIPs: ["100.0.0.1"] },
    b: { HostName: "nai-comfy-main", DNSName: "nai-comfy-main-1.x.ts.net.", Online: true, TailscaleIPs: ["100.0.0.2"] },
    c: { HostName: "nai-comfy-boost", DNSName: "nai-comfy-boost.x.ts.net.", Online: true, TailscaleIPs: ["100.0.0.3"] } } });
  assert.equal(await tailnetIp("nai-comfy-main", async () => json), "100.0.0.2");
  assert.equal(await tailnetIp("nai-comfy-x", async () => json), null);
});
test("ssh options keep known-host warnings out of command output", async () => {
  const { SSH_OPTS } = await import("./pod");
  assert.ok(SSH_OPTS.join(" ").includes("LogLevel=ERROR"));
});
