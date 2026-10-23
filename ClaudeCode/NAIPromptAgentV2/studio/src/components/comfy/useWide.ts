"use client";
import { useEffect, useState } from "react";

/** True at >=1280px (desktop 4-column Photo layout). False before mount, so the first paint is the phone layout. */
export function useWide(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(min-width: 1280px)");
    const f = () => setWide(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return wide;
}
