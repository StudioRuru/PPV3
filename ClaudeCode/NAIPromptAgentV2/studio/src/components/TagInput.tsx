"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { dots, type TagEntry } from "@/lib/tags";

/** Grow a textarea with its content (capped by its max-height class, then it scrolls). */
export function useAutoSize(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`; // +2: the 1px borders
  }, [value]);
  return ref;
}

export function TagInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [items, setItems] = useState<TagEntry[]>([]);
  // Suggestions only while this box has focus; otherwise a stale list floats over the boxes below.
  const [focused, setFocused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fragment = value.split(",").pop()?.trim() ?? "";
  const area = useAutoSize(value);

  useEffect(() => {
    clearTimeout(timer.current);
    if (fragment.length < 2) { setItems([]); return; }
    timer.current = setTimeout(async () => {
      const r = await fetch(`/api/tags?q=${encodeURIComponent(fragment)}`).then((r) => r.json()).catch(() => ({ items: [] }));
      setItems(r.items.slice(0, 8));
    }, 150);
  }, [fragment]);

  const pick = (name: string) => {
    const head = value.includes(",") ? value.slice(0, value.lastIndexOf(",") + 1) + " " : "";
    onChange(`${head}${name}, `);
    setItems([]);
  };

  return (
    <div className="relative flex-1">
      <textarea
        ref={area}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        rows={1}
        className="bg-bg border-border focus:border-accent block max-h-[40dvh] w-full resize-none overflow-y-auto rounded-md border px-2 py-2 text-base leading-snug outline-none"
      />
      {focused && items.length > 0 && (
        <ul role="listbox" className="bg-surface-2 border-border absolute z-20 mt-1 w-full overflow-hidden rounded-md border text-sm shadow-lg">
          {items.map((t) => (
            <li key={t.name}>
              <button type="button" onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(t.name)}
                className="hover:bg-surface flex w-full items-center justify-between px-3 py-2 text-left">
                <span>{t.name}</span>
                <span className="text-muted text-xs">{t.source === "danbooru" ? "●".repeat(dots(t.count)) || "·" : t.source}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Plain auto-growing textarea (undesired content fields). */
export function AutoTextarea({ value, onChange, placeholder, className = "" }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  const ref = useAutoSize(value);
  return <textarea ref={ref} value={value} rows={1} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
    className={`bg-bg border-border focus:border-accent block max-h-[40dvh] w-full resize-none overflow-y-auto rounded-md border px-2 py-2 text-base leading-snug outline-none ${className}`} />;
}
