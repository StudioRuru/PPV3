import { test } from "node:test";
import assert from "node:assert/strict";
import { isPreSendError, requestJson } from "./net";

const err = (code: string, message = "fetch failed") => Object.assign(new Error(message), { cause: { code } });

test("only connect-phase errors are safe to retry", () => {
  assert.equal(isPreSendError(err("ECONNREFUSED")), true);
  assert.equal(isPreSendError(err("ENOTFOUND")), true);
  assert.equal(isPreSendError(err("UND_ERR_CONNECT_TIMEOUT")), true);
  assert.equal(isPreSendError(err("UND_ERR_SOCKET", "other side closed")), false);
  assert.equal(isPreSendError(err("ECONNRESET")), false);
});

test("requestJson never throws on network failure or non-JSON", async () => {
  const down = await requestJson("http://127.0.0.1:9/nope", { method: "POST" });
  assert.equal(down.ok, false);
  assert.match(down.ok ? "" : down.error, /network/i);
});
