"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [{ href: "/", label: "Studio" }, { href: "/tagger", label: "Tagger" }];

export function NavTabs() {
  const path = usePathname();
  if (path === "/login") return null;
  return (
    <nav aria-label="Sections" className="border-border mx-auto flex max-w-6xl gap-1 border-b px-4 pt-3">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={path === t.href ? "page" : undefined}
          className={`rounded-t-md px-4 py-2 text-sm ${path === t.href ? "bg-surface text-fg font-semibold" : "text-muted"}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
