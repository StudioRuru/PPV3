import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { THEME_SCRIPT, THEMES } from "./theme";

/** Runs the exact head script in a fake browser; returns its API plus what it touched. */
function boot(stored: string | null, throwOnStorage = false) {
  const props: Record<string, string> = {};
  const meta = { content: "" };
  const root = { dataset: {} as Record<string, string>, style: { setProperty: (k: string, v: string) => { props[k] = v; }, removeProperty: (k: string) => { delete props[k]; } } };
  const store: Record<string, string> = stored === null ? {} : { "studio-theme-v1": stored };
  const localStorage = {
    getItem: (k: string) => { if (throwOnStorage) throw new Error("blocked"); return store[k] ?? null; },
    setItem: (k: string, v: string) => { if (throwOnStorage) throw new Error("blocked"); store[k] = v; },
  };
  const window: Record<string, unknown> = {};
  vm.runInNewContext(THEME_SCRIPT, { window, localStorage, document: { documentElement: root, querySelector: () => meta } });
  return { api: window.studioTheme as { set: (p: unknown) => void; get: () => unknown; readableOn: (h: string) => string }, root, props, meta, store };
}

test("first visit / blocked storage: Night Studio, no crash", () => {
  for (const b of [boot(null), boot(null, true), boot("not json")]) {
    assert.equal(b.root.dataset.theme, "night");
    assert.equal(b.meta.content, "#0d1020");
  }
});

test("stored theme + custom accent apply before paint; junk accents are ignored", () => {
  const b = boot('{"theme":"daylight","accent":"#6b4fd8"}');
  assert.equal(b.root.dataset.theme, "daylight");
  assert.equal(b.props["--color-accent"], "#6b4fd8");
  assert.equal(b.props["--color-accent-fg"], "#ffffff");
  assert.equal(b.meta.content, "#f6f5fb");
  const bad = boot('{"theme":"nope","accent":"red;background:url(x)"}');
  assert.equal(bad.root.dataset.theme, "night");
  assert.equal(bad.props["--color-accent"], undefined);
});

test("set() switches theme, saves it, and clears a removed accent", () => {
  const b = boot('{"theme":"pink","accent":"#00ff88"}');
  b.api.set({ theme: "darkroom" });
  assert.equal(b.root.dataset.theme, "darkroom");
  assert.equal(b.props["--color-accent"], undefined);
  assert.deepEqual(JSON.parse(b.store["studio-theme-v1"]), { theme: "darkroom" });
  assert.equal(JSON.stringify(b.api.get()), JSON.stringify({ theme: "darkroom" })); // cross-realm object
});

test("readableOn: dark text on light accents, white on dark", () => {
  const { api } = boot(null);
  assert.equal(api.readableOn("#b7a4ff"), "#140f24");
  assert.equal(api.readableOn("#ff5fb4"), "#140f24");
  assert.equal(api.readableOn("#6b4fd8"), "#ffffff");
  assert.equal(THEMES.length, 5);
});
