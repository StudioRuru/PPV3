// Monochrome line icons: stroke = currentColor, so they follow the active theme.
const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
type P = { className?: string };

export const Broom = ({ className = "size-4" }: P) => (
  <svg {...base} className={className}><path d="M19 3 11.5 10.5" /><path d="M9.5 9.5 14.5 14.5 12 21c-2.5-.5-6.5-3-8.5-6.5Z" /><path d="M7.5 17.5 9 14" /><path d="M10.5 19.5 12 16" /></svg>
);
export const Trash = ({ className = "size-4" }: P) => (
  <svg {...base} className={className}><path d="M4 7h16" /><path d="M9 7V4.5h6V7" /><path d="M6 7l1 13h10l1-13" /><path d="M10 11v6M14 11v6" /></svg>
);
export const Rotate = ({ className = "size-4" }: P) => (
  <svg {...base} className={className}><path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.6" /><path d="M20 4v4.6h-4.6" /><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.4" /><path d="M4 20v-4.6h4.6" /></svg>
);
export const ClearCircle = ({ className = "size-4" }: P) => (
  <svg {...base} className={className}><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>
);
export const Chevron = ({ className = "size-4" }: P) => (
  <svg {...base} className={className}><path d="M9 6l6 6-6 6" /></svg>
);
export const Floppy = ({ className = "size-6" }: P) => (
  <svg {...base} className={className}><path d="M5 3h11l3 3v15H5Z" /><path d="M8 3v5h7V3" /><rect x="8" y="13" width="8" height="5" rx="1" /></svg>
);
