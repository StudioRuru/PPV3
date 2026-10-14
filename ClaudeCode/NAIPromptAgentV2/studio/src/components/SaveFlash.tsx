"use client";
import { useEffect } from "react";
import { Floppy } from "./icons";

/** A brief floppy-disk badge over the screen after a save, then it fades (respects reduced motion via globals). */
export function SaveFlash({ text, onDone }: { text: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!text) return;
    const t = setTimeout(onDone, 1400);
    return () => clearTimeout(t);
  }, [text, onDone]);
  if (!text) return null;
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-0 z-50 grid place-items-center">
      <div className="save-flash bg-surface/80 border-border flex flex-col items-center gap-2 rounded-2xl border px-6 py-5 shadow-2xl backdrop-blur-md">
        <Floppy className="text-accent size-10" />
        <span className="font-mono text-xs">{text}</span>
      </div>
    </div>
  );
}
