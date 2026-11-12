import type { RawTag } from "./tagger";

export const SLOTS = ["tops", "bottoms", "legwear", "footwear", "accessories", "materials", "states"] as const;
export type Slot = (typeof SLOTS)[number];

const KEYWORDS: [Slot, RegExp][] = [
  ["states", /\b(pull|aside|lift|undressing|removed|unbuttoned|open|bare|torn|wet|see-through)\b/],
  ["legwear", /thighhighs|pantyhose|socks|stockings|leggings|tights|garter|thigh strap/],
  ["footwear", /shoes|boots|heels|sandals|sneakers|loafers|footwear|slippers/],
  ["bottoms", /skirt|shorts|pants|panties|jeans|trousers|bloomers/],
  ["accessories", /\bhat\b|ribbon|\bbow\b|choker|necklace|earrings|gloves|glasses|\bbag\b|hairband|hair ornament|bracelet|belt|\bcap\b|headband|scarf|\bcollar\b|jewelry|hairclip|wristband/],
  ["tops", /shirt|dress|jacket|coat|sweater|hoodie|\bbra\b|swimsuit|leotard|uniform|vest|kimono|bikini|bodysuit|blouse|cardigan|top\b|sleeves|apron|serafuku/],
];

/** Which outfit slot a tagger tag belongs in, given its YAML file stem (clothing, footwear, …). null = not clothing (hair, eyes, pose…). */
export function slotOf(name: string, stem: string | undefined): Slot | null {
  const n = name.toLowerCase().replace(/_/g, " ");
  if (/\b(collarbone|navel|stomach|sweat|saliva|cleavage|mouth|tongue|blush)\b/.test(n)) return null; // body, not clothing
  if (stem === "states" || stem === "nudity") return "states";
  if (stem === "materials") return "materials";
  if (stem === "accessories") return "accessories";
  const hit = KEYWORDS.find(([, re]) => re.test(n))?.[0];
  if (hit) return hit;
  if (stem === "footwear") return "footwear";
  if (stem === "clothing") return "tops";
  return null;
}

/** Union of every photo's confident general tags (best score wins), bucketed into outfit slots, best first. */
export function outfitFromTags(photos: { tags: RawTag[]; threshold: number }[], stems: Map<string, string>): Record<Slot, string[]> {
  const best = new Map<string, number>();
  for (const p of photos)
    for (const t of p.tags)
      if (t.category === "general" && t.score >= p.threshold) best.set(t.name, Math.max(best.get(t.name) ?? 0, t.score));
  const out = Object.fromEntries(SLOTS.map((s) => [s, []])) as unknown as Record<Slot, string[]>;
  for (const [name] of [...best].sort((a, b) => b[1] - a[1])) {
    const slot = slotOf(name, stems.get(name.toLowerCase().replace(/_/g, " ")));
    if (slot) out[slot].push(name.replace(/_/g, " "));
  }
  return out;
}
