import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";

test("sessions signed with the public dev secret are rejected", async () => {
  delete process.env.SESSION_SECRET;
  const { verifySession } = await import("./auth");
  const forged = await new SignJWT({ ok: true }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h")
    .sign(new TextEncoder().encode("dev-insecure-secret-change-me"));
  assert.equal(await verifySession(forged), false);
});
