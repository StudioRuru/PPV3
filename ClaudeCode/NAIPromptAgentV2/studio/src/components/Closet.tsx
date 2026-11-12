"use client";
import { useCallback, useEffect, useState } from "react";
import { diffFields, fieldKey, type Change, type EnhanceAction, type Field, type Kind } from "@/lib/closet";
import { requestJson } from "@/lib/net";
import { splitTags } from "@/lib/prompt";
import { Sheet } from "./Sheet";
import { AutoTextarea } from "./TagInput";
import { Trash } from "./icons";

type Item = { kind: Kind; dir: string; slug: string; name: string; description: string; count: number; mtime: number };
type Open = { kind: Kind; dir: string; slug: string; fields: Field[]; mtime: number; scenes?: number[] };
const KINDS: [Kind | "all", string][] = [["all", "All"], ["arc", "Scenes & arcs"], ["outfit", "Outfits"], ["theme", "Themes"], ["cluster", "Clusters"]];
const UNIT: Record<Kind, string> = { arc: "scenes", outfit: "tags", theme: "tags", cluster: "tags" };
const ACTIONS: [EnhanceAction, string][] = [["modify", "Modify"], ["add", "Add on"], ["remove", "Remove parts"], ["combine", "Combine with…"], ["mutate", "Mutate / escalate"]];
const json = (body: unknown) => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** One field: plain line, long text, or a tag list edited as comma-separated text. */
function FieldInput({ f, onChange }: { f: Field; onChange: (v: string | string[]) => void }) {
  const [text, setText] = useState(Array.isArray(f.value) ? f.value.join(", ") : f.value);
  // Only resync when the value really changed from outside (Apply, reload) — not on our own keystrokes,
  // which would eat the trailing space/comma of a tag being typed.
  useEffect(() => {
    const mine = f.type === "tags" ? JSON.stringify(splitTags(text)) === JSON.stringify(f.value) : text === f.value;
    if (!mine) setText(Array.isArray(f.value) ? f.value.join(", ") : f.value);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- text is read, not a trigger
  }, [f.value]);
  if (f.readonly) return (
    <div><span className="text-muted mb-1 block text-xs">{f.label}</span>
      <p className="text-faint text-xs">This field has a custom shape in the file — edit it by hand.</p></div>
  );
  return (
    // Optional extras: features seen in photos that aren't known tags. Kept out of the prompt; copy one in by hand.
    <label className={`block ${f.path[0] === "optional" ? "text-cyan [&_textarea]:text-cyan" : ""}`}>
      <span className={`${f.path[0] === "optional" ? "text-cyan" : "text-muted"} mb-1 block text-xs`}>{f.path[0] === "optional" ? "Optional extras (not tags · V5 reads plain English)" : f.label}{f.type === "tags" && <span className="text-faint font-mono"> · {(f.value as string[]).length}</span>}</span>
      {f.type === "text"
        ? <input value={text} onChange={(e) => { setText(e.target.value); onChange(e.target.value); }} className="bg-bg border-border w-full rounded-md border px-2 py-2 text-base" />
        : <AutoTextarea value={text} onChange={(v) => { setText(v); onChange(f.type === "tags" ? splitTags(v) : v); }} placeholder={f.type === "tags" ? "comma, separated, tags" : ""} />}
    </label>
  );
}

export function Closet({ active, onUse, prompt }: {
  active: boolean;
  /** Send to the Studio: a block id from /api/blocks (outfit:, theme:, cluster:, scene:slug#n). */
  onUse: (blockId: string) => void;
  /** Current prompt tags, for "From current prompt". */
  prompt: string[];
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [kind, setKind] = useState<Kind | "all">("all");
  const [open, setOpen] = useState<Open | null>(null);
  const [saved, setSaved] = useState<Field[]>([]); // fields as last loaded/saved — for "unsaved" and diffs
  const [error, setError] = useState<string | null>(null);
  const [newKind, setNewKind] = useState<Kind | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmScene, setConfirmScene] = useState<number | null>(null);
  const [askClose, setAskClose] = useState(false);
  // Co-pilot
  const [action, setAction] = useState<EnhanceAction>("modify");
  const [ask, setAsk] = useState("");
  const [other, setOther] = useState("");
  const [thinking, setThinking] = useState(false);
  const [suggestion, setSuggestion] = useState<{ prose: string; fields: Field[]; changes: Change[] } | null>(null);

  const load = useCallback(async () => {
    const r = await requestJson<{ items: Item[] }>("/api/closet");
    if (r.ok) setItems(r.data.items);
  }, []);
  useEffect(() => { if (active) load(); }, [active, load]);

  const show = (it: Open) => { setOpen(it); setSaved(it.fields); setSuggestion(null); setError(null); setAsk(""); setOther(""); setConfirmScene(null); setAskClose(false); };
  async function openItem(it: Item) {
    const r = await requestJson<{ item: Open }>(`/api/closet/${it.dir}/${it.slug}`);
    if (r.ok) show(r.data.item); else setError(r.error);
  }
  const setField = (key: string, value: string | string[]) => setOpen((o) => o && { ...o, fields: o.fields.map((f) => (fieldKey(f.path) === key ? { ...f, value } : f)) });
  const dirty = !!open && diffFields(saved, open.fields).length > 0;
  const close = () => (dirty ? setAskClose(true) : setOpen(null));

  async function save(op?: { scene: "add" } | { scene: "remove"; index: number }) {
    if (!open) return;
    const r = await requestJson<{ item: Open }>(`/api/closet/${open.dir}/${open.slug}`, { method: "PUT", ...json({ fields: open.fields, mtime: open.mtime, op }) });
    if (!r.ok) { setError(r.error); return; }
    show(r.data.item); load();
  }
  async function create(k: Kind, name: string, extra: object = {}) {
    const r = await requestJson<{ item: Open }>("/api/closet", { method: "POST", ...json({ kind: k, name, ...extra }) });
    if (!r.ok) { setError(r.error); return; }
    setNewKind(null); setNewName(""); show(r.data.item); load();
  }
  async function fromPhotos(files: File[]) {
    setPhotoBusy(true); setError(null);
    const fd = new FormData();
    fd.append("name", newName.trim());
    files.forEach((f) => fd.append("files", f));
    const r = await requestJson<{ item: Open }>("/api/closet/from-photos", { method: "POST", body: fd });
    setPhotoBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setNewKind(null); setNewName(""); show(r.data.item); load();
  }
  async function remove() {
    if (!open) return;
    const r = await requestJson(`/api/closet/${open.dir}/${open.slug}`, { method: "DELETE" });
    setConfirmDelete(false);
    if (!r.ok) { setError(r.error); return; }
    setOpen(null); load();
  }
  async function enhance() {
    if (!open) return;
    setThinking(true); setSuggestion(null); setError(null);
    let o: { label: string; fields: Field[] } | undefined;
    if (action === "combine") {
      const [d, s] = other.split("/");
      const r = await requestJson<{ item: Open }>(`/api/closet/${d}/${s}`);
      if (!r.ok) { setThinking(false); setError(`Couldn't load the item to combine: ${r.error}`); return; }
      o = { label: items.find((i) => `${i.dir}/${i.slug}` === other)?.name ?? s, fields: r.data.item.fields };
    }
    const r = await requestJson<{ prose: string; fields: Field[] }>("/api/closet/enhance", { method: "POST", ...json({ kind: open.kind, fields: open.fields, action, ask, other: o }) });
    setThinking(false);
    if (!r.ok) { setError(r.error); return; }
    const changes = diffFields(open.fields, r.data.fields);
    if (!changes.length) { setError("The co-pilot didn't suggest any changes — try rephrasing."); return; }
    setSuggestion({ prose: r.data.prose, fields: r.data.fields, changes });
  }

  const shown = items.filter((i) => kind === "all" || i.kind === kind);
  const scenes = open?.kind === "arc" ? [...new Set(open.fields.map((f) => f.path[1]).filter((v): v is number => typeof v === "number"))] : [];
  const h3 = "text-muted mb-2 text-xs font-medium tracking-wide uppercase";

  return (
    <section aria-label="Closet" className="space-y-3">
      <header className="flex items-end gap-2">
        <div className="flex-1">
          <h1 className="text-[15px] font-semibold tracking-wide">Closet</h1>
          <p className="text-muted text-xs">Scenes, outfits, themes and clusters — shared with your /prompt and /story skills.</p>
        </div>
        <button type="button" onClick={() => setNewKind(newKind ? null : "outfit")} className="bg-accent text-accent-fg h-10 rounded-lg px-3 text-sm font-semibold">+ New</button>
      </header>

      {newKind && (
        <form className="bg-surface border-border space-y-2 rounded-lg border p-3" onSubmit={(e) => { e.preventDefault(); if (newName.trim()) create(newKind, newName.trim()); }}>
          <div className="flex gap-1.5">
            {(["arc", "outfit", "theme", "cluster"] as Kind[]).map((k) => (
              <button key={k} type="button" aria-pressed={newKind === k} onClick={() => setNewKind(k)}
                className={`h-9 flex-1 rounded-md text-xs capitalize ${newKind === k ? "bg-accent text-accent-fg font-semibold" : "border-border text-muted border"}`}>{k === "arc" ? "Arc" : k}</button>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" aria-label="New item name" className="bg-bg border-border min-w-0 flex-1 rounded-md border px-2 py-2 text-base" />
            <button type="submit" disabled={!newName.trim()} className="bg-accent text-accent-fg rounded-md px-4 font-semibold disabled:opacity-40">Create</button>
          </div>
          {newKind === "outfit" && (
            <label className={`border-accent/50 text-accent flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-dashed px-3 text-sm ${photoBusy ? "opacity-60" : ""}`}>
              {photoBusy ? "Reading the clothes…" : "…or build it from photos (tagger)"}
              <input type="file" accept="image/*" multiple disabled={photoBusy} className="sr-only"
                onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; if (f.length) fromPhotos(f); }} />
            </label>
          )}
          {newKind === "outfit" && error && <p role="alert" className="text-danger text-xs">{error}</p>}
          {prompt.length > 0 && (
            <button type="button" disabled={!newName.trim()} onClick={() => create("cluster", newName.trim(), { fields: [{ path: ["tags"], label: "Tags", type: "tags", value: prompt }] })}
              className="text-accent text-sm disabled:opacity-40">…or save the current prompt ({prompt.length} tags) as a cluster</button>
          )}
        </form>
      )}

      <div data-noswipe className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
        {KINDS.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
            className={`h-9 shrink-0 rounded-full px-3.5 text-sm ${kind === k ? "bg-fg text-bg font-semibold" : "border-border text-muted border"}`}>
            {label} <span className="font-mono text-[11px] opacity-70">{k === "all" ? items.length : items.filter((i) => i.kind === k).length}</span>
          </button>
        ))}
      </div>

      {error && !open && <p role="alert" className="text-danger text-sm">{error}</p>}
      {!shown.length && <p className="text-muted py-10 text-center text-sm">Nothing here yet — tap + New.</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {shown.map((it) => (
          <button key={`${it.dir}/${it.slug}`} type="button" onClick={() => openItem(it)} className="bg-surface border-border animate-rise rounded-lg border p-3 text-left">
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-semibold">{it.name}</span>
              <span className="text-faint shrink-0 font-mono text-[10px] uppercase">{it.kind === "arc" ? "arc" : it.kind} · {it.count} {UNIT[it.kind]}</span>
            </span>
            {it.description && <span className="text-muted mt-1 line-clamp-2 block text-xs">{it.description}</span>}
          </button>
        ))}
      </div>

      <Sheet open={!!open} onClose={close} label="Edit closet item" closeLabel="Close editor"
        className="h-[92dvh] rounded-t-2xl border-t lg:h-full lg:max-w-lg lg:rounded-none lg:border-l">
        {open && <>
          <header className="flex items-center gap-2 p-3">
            <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{(open.fields.find((f) => fieldKey(f.path) === "name")?.value as string) || open.slug}</h2>
            <button type="button" aria-label="Delete (moves to trash)" onClick={() => setConfirmDelete(true)} className="text-faint hover:text-danger grid size-11 place-items-center"><Trash className="size-5" /></button>
            <button type="button" onClick={close} aria-label="Close" className="border-border h-11 w-11 shrink-0 rounded-full border">×</button>
          </header>
          <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-3 pb-3">
            {error && (
              <p role="alert" className="text-danger text-sm">{error}
                {/changed on disk/.test(error) && <button type="button" onClick={() => openItem({ ...open, name: "", description: "", count: 0 })} className="text-accent ml-2 font-semibold">Reload</button>}
              </p>
            )}
            {askClose && (
              <div role="alertdialog" className="border-warn/40 bg-warn/10 space-y-2 rounded-lg border p-3 text-sm">
                <p>Discard your unsaved changes?</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setAskClose(false)} className="border-border flex-1 rounded-md border px-3 py-2">Keep editing</button>
                  <button type="button" onClick={() => { setAskClose(false); setOpen(null); }} className="flex-1 rounded-md bg-black/20 px-3 py-2 font-semibold">Discard</button>
                </div>
              </div>
            )}
            {confirmDelete && (
              <div role="alertdialog" className="border-danger/40 bg-danger/10 space-y-2 rounded-lg border p-3 text-sm">
                <p>Move this to the trash? (data/.trash — it can be restored by hand.)</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setConfirmDelete(false)} className="border-border flex-1 rounded-md border px-3 py-2">Cancel</button>
                  <button type="button" onClick={remove} className="bg-danger flex-1 rounded-md px-3 py-2 font-semibold text-white">Move to trash</button>
                </div>
              </div>
            )}

            <section className="space-y-3">
              {open.fields.filter((f) => typeof f.path[1] !== "number").map((f) => <FieldInput key={fieldKey(f.path)} f={f} onChange={(v) => setField(fieldKey(f.path), v)} />)}
            </section>

            {open.kind === "arc" && scenes.map((i) => (
              <section key={i} className="bg-bg border-border space-y-3 rounded-lg border p-3">
                <header className="flex items-center gap-2">
                  <h3 className="flex-1 text-sm font-semibold">Scene {i + 1}</h3>
                  <button type="button" disabled={dirty} onClick={() => onUse(`scene:${open.slug}#${open.scenes?.[i] ?? i + 1}`)} className="text-accent text-xs disabled:opacity-40">{dirty ? "Save to load" : "Load in Studio"}</button>
                  <button type="button" aria-label={`Remove scene ${i + 1}`} disabled={dirty} title={dirty ? "Save first" : ""} onClick={() => setConfirmScene(i)}
                    className="text-faint hover:text-danger grid size-9 place-items-center disabled:opacity-30"><Trash /></button>
                </header>
                {confirmScene === i && (
                  <div role="alertdialog" className="border-danger/40 bg-danger/10 flex items-center gap-2 rounded-md border p-2 text-xs">
                    <span className="flex-1">Remove scene {i + 1}? The file is re-saved (a .bak is kept).</span>
                    <button type="button" onClick={() => setConfirmScene(null)} className="px-2 py-1.5">Cancel</button>
                    <button type="button" onClick={() => { setConfirmScene(null); save({ scene: "remove", index: i }); }} className="bg-danger rounded px-2 py-1.5 font-semibold text-white">Remove</button>
                  </div>
                )}
                {open.fields.filter((f) => f.path[1] === i).map((f) => <FieldInput key={fieldKey(f.path)} f={{ ...f, label: f.label.replace(/^Scene \d+ · /, "") }} onChange={(v) => setField(fieldKey(f.path), v)} />)}
              </section>
            ))}
            {open.kind === "arc" && <button type="button" disabled={dirty} onClick={() => save({ scene: "add" })} className="text-accent text-sm disabled:opacity-40">+ Scene {dirty ? "(save first)" : ""}</button>}

            <section className="bg-surface-2 space-y-2 rounded-lg p-3">
              <h3 className={h3}>Enhance with co-pilot</h3>
              <div data-noswipe className="flex flex-wrap gap-1.5">
                {ACTIONS.map(([a, label]) => (
                  <button key={a} type="button" aria-pressed={action === a} onClick={() => setAction(a)}
                    className={`h-8 rounded-full px-3 text-xs ${action === a ? "bg-accent text-accent-fg font-semibold" : "border-border text-muted border"}`}>{label}</button>
                ))}
              </div>
              {action === "combine" && (
                <select value={other} onChange={(e) => setOther(e.target.value)} aria-label="Combine with" className="bg-bg border-border w-full rounded-md border px-2 py-2 text-base">
                  <option value="">Choose an item to combine…</option>
                  {items.filter((i) => i.kind === open.kind && i.slug !== open.slug).map((i) => <option key={i.slug} value={`${i.dir}/${i.slug}`}>{i.name}</option>)}
                </select>
              )}
              <AutoTextarea value={ask} onChange={setAsk} placeholder={action === "mutate" ? "e.g. make the next step more extreme" : "what should change?"} />
              <button type="button" onClick={enhance} disabled={thinking || (action === "combine" && !other)}
                className={`bg-accent text-accent-fg w-full rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-50 ${thinking ? "sweep" : ""}`}>{thinking ? "Thinking… (about a minute)" : "Ask the co-pilot"}</button>
              {suggestion && (
                <div className="animate-rise border-accent/40 space-y-2 rounded-lg border p-2.5 text-sm">
                  {suggestion.prose && <p className="text-muted">{suggestion.prose}</p>}
                  <ul className="space-y-1.5">
                    {suggestion.changes.map((c) => (
                      <li key={c.key}>
                        <span className="text-faint font-mono text-[11px]">{c.label}</span>
                        {c.added?.length ? <span className="block text-ok">+ {c.added.join(", ")}</span> : null}
                        {c.removed?.length ? <span className="text-danger block line-through decoration-1">− {c.removed.join(", ")}</span> : null}
                        {c.to !== undefined && <span className="block">{c.to}</span>}
                      </li>
                    ))}
                  </ul>
                  <div className="flex gap-2">
                    {/* Merge only what the co-pilot changed, so edits typed while it was thinking survive. */}
                    <button type="button" onClick={() => {
                      const keys = new Set(suggestion.changes.map((c) => c.key));
                      const next = new Map(suggestion.fields.map((f) => [fieldKey(f.path), f.value]));
                      setOpen({ ...open, fields: open.fields.map((f) => (keys.has(fieldKey(f.path)) ? { ...f, value: next.get(fieldKey(f.path))! } : f)) });
                      setSuggestion(null);
                    }} className="bg-accent text-accent-fg h-10 flex-1 rounded-md font-semibold">Apply</button>
                    <button type="button" onClick={() => setSuggestion(null)} className="border-border h-10 flex-1 rounded-md border">Discard</button>
                  </div>
                  <p className="text-faint text-xs">Apply edits the form — Save writes the file.</p>
                </div>
              )}
            </section>
          </div>
          <div className="border-border flex gap-2 border-t p-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
            {open.kind !== "arc" && <button type="button" disabled={dirty} title={dirty ? "Save first — the Studio uses the saved version" : ""} onClick={() => onUse(`${open.kind}:${open.slug}`)} className="border-border rounded-lg border px-3 py-3 text-sm disabled:opacity-40">Use in Studio</button>}
            <button type="button" onClick={() => create(open.kind, `${(open.fields.find((f) => fieldKey(f.path) === "name")?.value as string) || open.slug} copy`, { from: { dir: open.dir, slug: open.slug } })}
              className="border-border rounded-lg border px-3 py-3 text-sm">Duplicate</button>
            <button type="button" onClick={() => save()} disabled={!dirty} className="bg-accent text-accent-fg flex-1 rounded-lg px-4 py-3 font-semibold disabled:opacity-40">{dirty ? "Save" : "Saved"}</button>
          </div>
        </>}
      </Sheet>
    </section>
  );
}
