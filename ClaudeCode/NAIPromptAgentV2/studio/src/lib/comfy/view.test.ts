import test from "node:test";
import assert from "node:assert/strict";
import type { EngineView } from "./engine";
import { alarmText, gpuLabel, gpuName, stepError } from "./view";

const v = (o: Partial<EngineView> = {}): EngineView => ({
  card: "main", phase: "off", gpu: null, since: null, usdHr: 1, runCost: 0, today: 0, boost: "off", keepWarmUntil: 0, alarm: null, deadline: null, kept: false, steps: null, ...o,
});

test("warming shows seconds since start", () => {
  assert.equal(gpuLabel(v({ phase: "warming", gpu: "n3-L40x1", since: 1000 }), 41_000), "● L40 warming… 40s");
});

test("ready shows run cost to the cent", () => {
  assert.equal(gpuLabel(v({ phase: "ready", gpu: "n3-L40x1", runCost: 0.4166 }), 0), "● L40 ready · $0.42");
});

test("off and unavailable", () => {
  assert.equal(gpuLabel(v(), 0), "○ GPU off");
  assert.equal(gpuLabel(v({ kept: true }), 0), "○ GPU off · models kept");
  assert.equal(gpuLabel(v({ phase: "unavailable" }), 0), "● GPU unavailable");
  assert.equal(gpuLabel(v({ phase: "unavailable", gpu: "n3-RTX-A6000x1" }), 0), "● A6000 unavailable");
});

test("alarm text present only when alarm set", () => {
  assert.equal(alarmText(v()), null);
  assert.equal(alarmText(v({ alarm: "GPU still billing — retrying stop" })), "GPU still billing — retrying stop");
});

test("short GPU name derives from the flavor", () => {
  assert.equal(gpuName("n3-L40x1"), "L40");
  assert.equal(gpuName("n3-H100x1"), "H100");
  assert.equal(gpuName("n3-RTX-A6000x1"), "A6000");
  assert.equal(gpuName("n3-H100-80G-PCIex2"), "H100-80G-PCIe");
  assert.equal(gpuName(null), "GPU");
});

test("stopping label and warming without a start time", () => {
  assert.equal(gpuLabel(v({ phase: "stopping", gpu: "n3-L40x1" }), 0), "○ L40 stopping…");
  assert.equal(gpuLabel(v({ phase: "warming", gpu: "n3-L40x1", since: null }), 5000), "● L40 warming…");
});

test("stepError maps known failures", () => {
  assert.match(stepError("network", "ssh: Could not resolve hostname nai-comfy-main"), /network|tailnet/i);
  assert.match(stepError("disk", "RESERVED"), /RESERVED/);
  assert.ok(!stepError("links", "Bearer abc123").includes("abc123"));
  assert.ok(stepError("models", "x".repeat(500)).length <= 120);
});
