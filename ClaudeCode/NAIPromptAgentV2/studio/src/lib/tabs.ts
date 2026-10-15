export type Tab = "studio" | "roll" | "closet" | "chat" | "rp";

/** App sections in order (swipe/island order), with monochrome line icons (24×24 path, currentColor). */
export const TABS: { id: Tab; label: string; short: string; d: string }[] = [
  { id: "studio", label: "Studio", short: "Studio", d: "M4 20h4L19 9l-4-4L4 16v4Z M13 7l4 4" },
  { id: "roll", label: "Camera roll", short: "Roll", d: "M4 7h3l2-2h6l2 2h3v12H4Z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" },
  { id: "closet", label: "Closet", short: "Closet", d: "M5 4h14v16H5Z M12 4v16 M9.5 11v2 M14.5 11v2" },
  { id: "chat", label: "Chat", short: "Chat", d: "M4 5h16v11H9l-5 4Z" },
  { id: "rp", label: "RP", short: "RP", d: "M7 4h10a3 3 0 0 1 3 3v4a8 8 0 0 1-16 0V7a3 3 0 0 1 3-3Z M9 10h.01 M15 10h.01 M9.5 14.5a3.5 3.5 0 0 0 5 0" },
];
export const TAB_IDS: Tab[] = TABS.map((t) => t.id);
/** Settings icon (sliders). */
export const SETTINGS_ICON = "M4 6h9 M17 6h3 M4 12h3 M11 12h9 M4 18h11 M19 18h1 M15 4v4 M9 10v4 M17 16v4";
