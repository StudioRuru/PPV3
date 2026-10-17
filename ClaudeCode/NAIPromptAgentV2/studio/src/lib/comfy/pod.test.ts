import { test } from "node:test";
import assert from "node:assert/strict";
import YAML from "yaml";
import { readManifest, renderCloudInit, podHost, syncModels, COMFY_PORT } from "./pod";

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
  for (const s of ["nai-comfy-main", "tag:comfy-pod", "--disable-cuda-malloc", "--listen $(tailscale ip -4)", "tskey-test"]) assert.ok(out.includes(s), s);
  assert.ok(!out.includes("0.0.0.0"));
  assert.ok(!out.includes("{{"));
  assert.equal(podHost("boost"), "nai-comfy-boost");
  assert.equal(COMFY_PORT, 8188);
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
  assert.ok(calls[0].args.join(" ").endsWith("bash /opt/comfy/fetch-models.sh"));
  assert.ok(YAML.parse(calls[0].stdin).every((e: { cards: string[] }) => e.cards.includes("boost")));
});
