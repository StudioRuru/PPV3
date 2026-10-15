"use client";

export type Bubble = { label: string; onSelect: () => void; small?: boolean };

/** Miyabi's tap menu: a swipeable row of speech bubbles (native scroll-snap). Arrows move, Escape closes. */
export function TabCarousel({ items, onClose }: { items: Bubble[]; onClose: () => void }) {
  function key(e: React.KeyboardEvent<HTMLUListElement>) {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const bs = [...e.currentTarget.querySelectorAll("button")], i = bs.indexOf(document.activeElement as HTMLButtonElement);
    bs[Math.min(bs.length - 1, Math.max(0, i + d))]?.focus();
  }
  return (
    <ul aria-label="Miyabi menu" onKeyDown={key}
      className="animate-rise flex max-w-full snap-x snap-mandatory items-center gap-2 overflow-x-auto overscroll-x-contain p-1 [scrollbar-width:none]">
      {items.map((it, i) => (
        <li key={i} className="shrink-0 snap-center">
          <button type="button" autoFocus={i === 0} aria-label={it.label} onClick={it.onSelect}
            className={`bg-surface border-border block rounded-2xl border shadow-lg ${it.small ? "text-muted px-3 py-2 text-xs" : "px-4 py-2.5 text-sm font-medium"}`}>{it.label}</button>
        </li>
      ))}
    </ul>
  );
}
