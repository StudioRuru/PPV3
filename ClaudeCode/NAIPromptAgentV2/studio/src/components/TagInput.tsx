"use client";
import { useEffect, useRef, useState } from "react";
import { dots, type TagEntry } from "@/lib/tags";

export function TagInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [items, setItems] = useState<TagEntry[]>([]);
  // Suggestions only while this box has focus; otherwise a stale list floats over the boxes below.
  const [focused, setFocused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fragment = value.split(",").pop()?.trim() ?? "";

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
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        rows={1}
        className="bg-bg border-border focus:border-accent w-full resize-y rounded-md border px-2 py-2 text-base outline-none"
      />
      {focused && items.length > 0 && (
        <ul role="listbox" className="bg-surface-2 border-border absolute z-20 mt-1 w-full overflow-hidden rounded-md border text-sm shadow-lg">
          {items.map((t) => (
            <li key={t.name}>
              <button type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => pick(t.name)}
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
