"use client";
import { useEffect, useState } from "react";
import { requestJson } from "@/lib/net";
import type { Library } from "./core";

/** The cut clip library; null until loaded. Refetches on `mascot:sprites` and when the tab regains focus. */
export function useLibrary(): Library | null {
  const [lib, setLib] = useState<Library | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => { requestJson<Library>("/api/sprites/library").then((r) => { if (live && r.ok) setLib(r.data); }); };
    load();
    window.addEventListener("mascot:sprites", load);
    window.addEventListener("focus", load);
    return () => { live = false; window.removeEventListener("mascot:sprites", load); window.removeEventListener("focus", load); };
  }, []);
  return lib;
}
