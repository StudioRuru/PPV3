/** Themes are per device (localStorage). The colours themselves live in globals.css under [data-theme]. */
export const THEMES = [
  { id: "night", name: "Night Studio", bg: "#0d1020", accent: "#b7a4ff" },
  { id: "darkroom", name: "Darkroom", bg: "#0b0a09", accent: "#ffb86b" },
  { id: "console", name: "Console", bg: "#0f1211", accent: "#7ee0c3" },
  { id: "daylight", name: "Daylight", bg: "#f6f5fb", accent: "#6b4fd8" },
  { id: "pink", name: "Pink", bg: "#170c16", accent: "#ff5fb4" },
] as const;

export type ThemePref = { theme: string; accent?: string };

/**
 * Inline <head> script: applies the saved theme before first paint (no flash) and exposes
 * window.studioTheme { set, get, readableOn } for the Settings sheet. Plain JS on purpose — it runs
 * before React and must survive minification untouched. Storage may throw (private mode): defaults win.
 */
export const THEME_SCRIPT = `(function () {
  var BG = ${JSON.stringify(Object.fromEntries(THEMES.map((t) => [t.id, t.bg])))};
  var KEY = "studio-theme-v1";
  function readableOn(hex) {
    var n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(function (v) {
      v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.18 ? "#140f24" : "#ffffff";
  }
  function clean(p) {
    var out = { theme: p && BG.hasOwnProperty(p.theme) ? p.theme : "night" };
    if (p && /^#[0-9a-fA-F]{6}$/.test(p.accent || "")) out.accent = p.accent;
    return out;
  }
  function apply(p) {
    var root = document.documentElement, s = root.style;
    root.dataset.theme = p.theme;
    if (p.accent) {
      s.setProperty("--color-accent", p.accent);
      s.setProperty("--color-accent-fg", readableOn(p.accent));
      s.setProperty("--color-accent-soft", "color-mix(in srgb, " + p.accent + " 24%, var(--color-bg))");
      s.setProperty("--color-accent-ink", "color-mix(in srgb, " + p.accent + " 70%, var(--color-fg))");
    } else {
      ["--color-accent", "--color-accent-fg", "--color-accent-soft", "--color-accent-ink"].forEach(function (k) { s.removeProperty(k); });
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = BG[p.theme];
  }
  var pref = { theme: "night" };
  try { pref = clean(JSON.parse(localStorage.getItem(KEY) || "null")); } catch (e) {}
  apply(pref);
  window.studioTheme = {
    readableOn: readableOn,
    get: function () { return pref; },
    set: function (p) { pref = clean(p); apply(pref); try { localStorage.setItem(KEY, JSON.stringify(pref)); } catch (e) {} },
  };
})();`;

type ThemeApi = { set: (p: ThemePref) => void; get: () => ThemePref };
const api = () => (typeof window === "undefined" ? undefined : (window as unknown as { studioTheme?: ThemeApi }).studioTheme);
export const getTheme = (): ThemePref => api()?.get() ?? { theme: "night" };
export const setTheme = (p: ThemePref) => api()?.set(p);
