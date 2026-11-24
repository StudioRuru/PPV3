import test from "node:test";
import assert from "node:assert/strict";

// env.ts reads tokens at load, so set fake ones before importing preflight.
process.env.HF_TOKEN = "fake-hf";
process.env.CIVITAI_TOKEN = "fake-civ";

test("headUrl sends the right Authorization per host and maps errors to 599", async () => {
  const { headUrl } = await import("./preflight");
  const real = globalThis.fetch;
  const auth: (string | undefined)[] = [];
  globalThis.fetch = (async (_u: unknown, init?: RequestInit) => { auth.push((init?.headers as Record<string, string>).Authorization); return { status: 200 } as Response; }) as typeof fetch;
  try {
    await headUrl("https://huggingface.co/x");
    await headUrl("https://civitai.com/x");
    await headUrl("https://evilhuggingface.co/x");
    await headUrl("https://example.com/x");
    assert.deepEqual(auth, ["Bearer fake-hf", "Bearer fake-civ", undefined, undefined]);
    globalThis.fetch = (async () => { throw new Error("net"); }) as typeof fetch;
    assert.equal(await headUrl("https://example.com/x"), 599);
    assert.equal(await headUrl("not a url"), 599);
  } finally { globalThis.fetch = real; }
});
