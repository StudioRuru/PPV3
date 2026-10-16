import { test } from "node:test";
import assert from "node:assert/strict";
import { activityState, changed, makeGate, makeThrottle, parseIntent, postActivity } from "./native";

const base = { tab: "chat" as const, expression: "smug" as const, hidden: false, bust: "/api/mascot/sprites/day/smug?v=1", on: true };

test("activityState: label from tab, clamp, bust whitelist", () => {
  const s = activityState(base);
  assert.equal(s.tabLabel, "Chat");
  assert.equal(s.bust, base.bust);
  assert.equal(activityState({ ...base, tab: "roll" }).tabLabel, "Camera roll");
  assert.equal(activityState({ ...base, tabLabel: "x".repeat(50) }).tabLabel.length, 24);
  for (const b of ["https://evil.com/api/mascot/sprites/a", "//evil.com/api/mascot/sprites/a", "/api/other", "/api/mascot/sprites/../x", "/api/mascot/sprites/" + "a".repeat(300), "", null])
    assert.equal(activityState({ ...base, bust: b }).bust, null, String(b));
});

test("changed", () => {
  assert.equal(changed(activityState(base), activityState(base)), false);
  assert.equal(changed(activityState(base), activityState({ ...base, hidden: true })), true);
  assert.equal(changed(null, activityState(base)), true);
});

test("throttle: burst -> one send + trailing latest; unchanged -> none", () => {
  let t = 0; const sent: string[] = []; const timers: (() => void)[] = [];
  const th = makeThrottle((s) => sent.push(s.tab), 2000, () => t, (f) => { timers.push(f); });
  th(activityState({ ...base, tab: "studio" }));
  th(activityState({ ...base, tab: "roll" }));
  th(activityState({ ...base, tab: "closet" }));
  assert.deepEqual(sent, ["studio"]);
  t = 2000; timers.splice(0).forEach((f) => f());
  assert.deepEqual(sent, ["studio", "closet"]);
  th(activityState({ ...base, tab: "closet" })); t = 9000; timers.splice(0).forEach((f) => f());
  assert.deepEqual(sent, ["studio", "closet"]);
});

test("parseIntent", () => {
  assert.deepEqual(parseIntent({ tab: "rp" }), { tab: "rp" });
  assert.deepEqual(parseIntent({ mascot: "hide" }), { mascot: "hide" });
  assert.deepEqual(parseIntent({ mascot: "summon" }), { mascot: "summon" });
  for (const bad of [{ tab: "nope" }, { tab: "rp", x: 1 }, { tab: "rp", mascot: "hide" }, { mascot: "kill" }, { tab: 1 }, "rp", null, 5, [], {}])
    assert.equal(parseIntent(bad), null, JSON.stringify(bad));
});

test("postActivity no-op without webkit", () => {
  assert.doesNotThrow(() => postActivity(activityState(base)));
});

test("gate: nothing before known; first send after known has the real state", () => {
  const sent: boolean[] = [];
  const g = makeGate((s) => sent.push(s.on));
  g.push(activityState({ ...base, on: false }));
  g.push(activityState({ ...base, tab: "roll", on: false }));
  assert.deepEqual(sent, []);
  g.push(activityState({ ...base, on: true }));
  g.ready();
  assert.deepEqual(sent, [true]);
  g.push(activityState({ ...base, on: false }));
  assert.deepEqual(sent, [true, false]);
});

test("throttle cancel drops the trailing send", () => {
  let t = 0; const sent: string[] = []; const timers: (() => void)[] = [];
  const th = makeThrottle((s) => sent.push(s.tab), 2000, () => t, (f) => { timers.push(f); });
  th(activityState({ ...base, tab: "studio" })); th(activityState({ ...base, tab: "roll" }));
  th.cancel(); t = 2000; timers.splice(0).forEach((f) => f());
  assert.deepEqual(sent, ["studio"]);
});

test("throttle flush sends the pending change now, once", () => {
  let t = 0; const sent: string[] = []; const timers: (() => void)[] = [];
  const th = makeThrottle((s) => sent.push(s.tab), 2000, () => t, (f) => { timers.push(f); });
  th(activityState({ ...base, tab: "studio" })); th(activityState({ ...base, tab: "roll" }));
  th.flush(); th.flush(); timers.splice(0).forEach((f) => f());
  assert.deepEqual(sent, ["studio", "roll"]);
  th.cancel(); th(activityState({ ...base, tab: "chat" })); th.flush();
  assert.deepEqual(sent, ["studio", "roll"]);
});
