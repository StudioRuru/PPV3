"use client";

// Bottom sheet (right-hand panel on desktop). Always mounted so it can animate out;
// closed = visibility:hidden + inert, so it is untouchable and out of the a11y tree.
export function Sheet({ open, onClose, label, closeLabel, className, children }: {
  open: boolean; onClose: () => void; label: string; closeLabel: string; className: string; children: React.ReactNode;
}) {
  return (
    <div className="sheet fixed inset-0 z-40 flex items-end lg:items-stretch lg:justify-end" data-open={open || undefined} inert={!open}
      role="dialog" aria-modal="true" aria-label={label}>
      <button type="button" aria-label={closeLabel} onClick={onClose} className="sheet-backdrop absolute inset-0 bg-black/50" />
      <section className={`sheet-panel bg-surface border-border relative flex w-full flex-col ${className}`}>{children}</section>
    </div>
  );
}
