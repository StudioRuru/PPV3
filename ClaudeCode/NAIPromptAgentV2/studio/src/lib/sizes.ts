/** Canvas sizes. NovelAI needs multiples of 64; ≤1 Mpx (Medium) is free on Opus. */
export type Size = { w: number; h: number };
export type Orientation = "portrait" | "landscape" | "square" | "wallpaper";
export type Preset = Size & { name: "Small" | "Medium" | "Large" };

const flip = (list: Preset[]): Preset[] => list.map((s) => ({ ...s, w: s.h, h: s.w }));
const PORTRAIT: Preset[] = [{ name: "Small", w: 512, h: 768 }, { name: "Medium", w: 832, h: 1216 }, { name: "Large", w: 1024, h: 1536 }];

export const PRESETS: Record<Orientation, Preset[]> = {
  portrait: PORTRAIT,
  landscape: flip(PORTRAIT),
  square: [{ name: "Small", w: 640, h: 640 }, { name: "Medium", w: 1024, h: 1024 }, { name: "Large", w: 1472, h: 1472 }],
  // Phone-screen aspect (~9:19.5); Medium stays under 1 Mpx so it's free.
  wallpaper: [{ name: "Small", w: 448, h: 960 }, { name: "Medium", w: 640, h: 1408 }, { name: "Large", w: 832, h: 1792 }],
};

const r64 = (v: number) => Math.max(64, Math.round(v / 64) * 64);

/** Largest canvas NovelAI will take here (matches canResend). */
export const MAX_PIXELS = 4_194_304;

/**
 * The device's native screen in pixels, upright, rounded to 64 (iPhone 17 Pro 1206×2622 → 1216×2624).
 * Larger screens (Macs, iPads) are scaled down to fit MAX_PIXELS, keeping the aspect.
 */
export function deviceSize(cssW: number, cssH: number, dpr: number): Size {
  const w = Math.min(cssW, cssH) * dpr, h = Math.max(cssW, cssH) * dpr;
  const rounded = { w: r64(w), h: r64(h) };
  if (rounded.w * rounded.h <= MAX_PIXELS) return rounded;
  const k = Math.sqrt(MAX_PIXELS / (w * h));
  const down = (v: number) => Math.max(64, Math.floor((v * k) / 64) * 64);
  return { w: down(w), h: down(h) };
}

export const rotate = (s: Size): Size => ({ w: s.h, h: s.w });

const RATIOS: [string, number][] = [["1:1", 1], ["2:3", 2 / 3], ["3:2", 3 / 2], ["3:4", 3 / 4], ["4:3", 4 / 3], ["9:16", 9 / 16], ["16:9", 16 / 9], ["9:19.5", 9 / 19.5], ["19.5:9", 19.5 / 9]];

/** Nearest familiar ratio (within 3%), else the reduced fraction. */
export function ratioLabel(w: number, h: number): string {
  const r = w / h;
  const near = RATIOS.find(([, v]) => Math.abs(r - v) / v < 0.03);
  if (near) return near[0];
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}

export function matchPreset(w: number, h: number): { orientation: Orientation; size: Preset["name"] } | null {
  for (const [orientation, list] of Object.entries(PRESETS) as [Orientation, Preset[]][]) {
    const hit = list.find((s) => s.w === w && s.h === h);
    if (hit) return { orientation, size: hit.name };
  }
  return null;
}
