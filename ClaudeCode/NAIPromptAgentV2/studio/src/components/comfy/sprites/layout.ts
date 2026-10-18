/** Keys evenly on a circle inside w×h, `stand` (if present) at the top-centre, the rest clockwise in order. */
export function circleLayout(keys: string[], w: number, h: number): Record<string, { x: number; y: number }> {
  const i = keys.indexOf("stand");
  const order = i < 0 ? keys : [...keys.slice(i), ...keys.slice(0, i)];
  const r = Math.max(0, Math.min(w, h) / 2 - 36);
  return Object.fromEntries(order.map((k, n) => {
    const a = -Math.PI / 2 + (2 * Math.PI * n) / order.length;
    return [k, { x: w / 2 + r * Math.cos(a), y: h / 2 + r * Math.sin(a) }];
  }));
}
