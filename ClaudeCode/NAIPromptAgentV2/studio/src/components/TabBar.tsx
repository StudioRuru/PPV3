"use client";

export type Tab = "studio" | "roll" | "closet" | "chat" | "rp";
type Item = { id: Tab; label: string; d: string };

// Monochrome line icons (currentColor).
const ITEMS: Item[] = [
  { id: "studio", label: "Studio", d: "M4 20h4L19 9l-4-4L4 16v4Z M13 7l4 4" },
  { id: "roll", label: "Camera roll", d: "M4 7h3l2-2h6l2 2h3v12H4Z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" },
  { id: "closet", label: "Closet", d: "M5 4h14v16H5Z M12 4v16 M9.5 11v2 M14.5 11v2" },
  { id: "chat", label: "Chat", d: "M4 5h16v11H9l-5 4Z" },
  { id: "rp", label: "RP", d: "M7 4h10a3 3 0 0 1 3 3v4a8 8 0 0 1-16 0V7a3 3 0 0 1 3-3Z M9 10h.01 M15 10h.01 M9.5 14.5a3.5 3.5 0 0 0 5 0" },
];

/** Bottom tabs. */
export function TabBar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  return (
    <nav aria-label="Sections" className="bg-bg/95 border-border fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="mx-auto grid h-14 max-w-6xl grid-cols-5">
        {ITEMS.map((it) => {
          const on = it.id === tab;
          return (
            <button key={it.id} type="button" aria-current={on ? "page" : undefined}
              onClick={() => onTab(it.id)}
              className={`flex flex-col items-center justify-center gap-0.5 text-[11px] ${on ? "text-accent font-semibold" : "text-muted"}`}>
              <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={on ? 2 : 1.7} strokeLinecap="round" strokeLinejoin="round"><path d={it.d} /></svg>
              {it.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
