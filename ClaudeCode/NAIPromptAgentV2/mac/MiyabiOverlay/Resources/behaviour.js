"use strict";
var Behaviour = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/lib/sprites/behaviour.ts
  var behaviour_exports = {};
  __export(behaviour_exports, {
    init: () => init,
    path: () => path,
    step: () => step,
    toJSONStep: () => toJSONStep
  });

  // src/lib/sprites/core.ts
  var RANK = { tame: 0, teasing: 1, lewd: 2 };
  function allowedKeys(keys, boldness, outfit) {
    return keys.filter((k) => RANK[k.tier] <= RANK[boldness] && (!k.tags.includes("lewd") || outfit === "lewd" && boldness === "lewd"));
  }

  // src/lib/sprites/behaviour.ts
  var S = 1e3;
  var MIN = 60 * S;
  var drift = (now, rand) => now + 20 * S + Math.floor(rand() * 40 * S);
  var pick = (a, rand) => a[Math.floor(rand() * a.length)];
  var init = (pose, now, rand) => ({ pose, since: now, lastUser: now, pokes: [], nextDrift: drift(now, rand), asleep: false, dragging: false });
  function path(edges, from, to) {
    const adj = /* @__PURE__ */ new Map();
    for (const [a, b] of edges) {
      adj.set(a, [...adj.get(a) ?? [], b]);
      adj.set(b, [...adj.get(b) ?? [], a]);
    }
    const prev = /* @__PURE__ */ new Map([[from, null]]);
    for (const q = [from]; q.length; ) {
      const c = q.shift();
      if (c === to) {
        const p = [];
        for (let n = c; n != null; n = prev.get(n)) p.unshift(n);
        return p;
      }
      for (const n of adj.get(c) ?? []) if (!prev.has(n)) {
        prev.set(n, c);
        q.push(n);
      }
    }
    return [];
  }
  function step(s, ev, c) {
    const { now, rand } = c;
    const stage = c.lib.keys.filter((k) => k.surface === "stage");
    const has = (key) => stage.some((k) => k.key === key);
    const ok = allowedKeys(stage, c.boldness, c.outfit);
    const tagged = (...t) => ok.filter((k) => t.some((x) => k.tags.includes(x)));
    const names = new Set(ok.map((k) => k.key)).add(s.pose);
    const hop = (to) => path(c.lib.edges.filter(([a, b]) => names.has(a) && names.has(b)), s.pose, to)[1] ?? s.pose;
    const move = (n, pose, act = {}) => ({ s: { ...n, pose, since: pose === n.pose ? n.since : now }, act: { pose, ...act } });
    const none = (n = s) => ({ s: n, act: null });
    switch (ev.type) {
      case "tick": {
        if (s.asleep || s.dragging || now < s.nextDrift) return none();
        const n = { ...s, nextDrift: drift(now, rand) };
        const ignored = now - s.lastUser;
        const hi = ignored >= 15 * MIN ? tagged("tease", "lewd") : ignored >= 5 * MIN ? tagged("tease") : [];
        const t = pick(hi.filter((k) => k.key !== s.pose), rand);
        if (t) return move(n, hop(t.key), { quip: "ignored" });
        const nb = c.lib.edges.flatMap(([a, b]) => a === s.pose ? [b] : b === s.pose ? [a] : []);
        const calm = ok.filter((k) => nb.includes(k.key) && (k.tags.includes("rest") || !k.tags.length));
        const d = pick(calm, rand);
        return d ? move(n, d.key) : none(n);
      }
      case "poke": {
        const pokes = [...s.pokes.filter((t) => now - t < 10 * S), now];
        const n = { ...s, pokes: pokes.length >= 3 ? [] : pokes, lastUser: now, asleep: false, nextDrift: drift(now, rand) };
        if (pokes.length >= 3) {
          const t = pick(tagged("tease"), rand);
          return move(n, t ? hop(t.key) : s.pose, { quip: "make_me" });
        }
        const r = pick(tagged("reaction"), rand);
        return move(n, r ? hop(r.key) : s.pose, { quip: "poke" });
      }
      case "dragStart":
        return move({ ...s, dragging: true, lastUser: now }, has("dangle") ? "dangle" : s.pose);
      case "drop":
        return move({ ...s, dragging: false, lastUser: now, nextDrift: drift(now, rand) }, has("sit") ? "sit" : s.pose);
      case "typing": {
        const n = { ...s, lastUser: now };
        if (now - (s.lastLook ?? -Infinity) < 30 * S) return none(n);
        return move({ ...n, lastLook: now }, s.pose, { look: "cursor" });
      }
      case "sysIdle":
        return move({ ...s, asleep: true }, has("lie_down") ? "lie_down" : s.pose);
      case "sysActive": {
        const n = { ...s, lastUser: now, asleep: false, nextDrift: drift(now, rand) };
        return s.asleep ? move(n, has("stand") ? "stand" : s.pose, { quip: "finally" }) : none(n);
      }
    }
  }
  function toJSONStep(json) {
    const { s, ev, ctx } = JSON.parse(json);
    return JSON.stringify(step(s, ev, { rand: Math.random, ...ctx }));
  }
  return __toCommonJS(behaviour_exports);
})();
