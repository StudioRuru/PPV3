"use client";
import { useEffect, useRef, useState } from "react";
import { EXPRESSIONS, OUTFITS, type Expression, type Outfit } from "@/lib/mascot/core";
import { DEFAULT_MASCOT_SETTINGS } from "@/lib/mascot/settings";
import { POSES, POSE_SPEC, poseKey, type Pose } from "@/lib/mascot/poses";
import { ARU_DEFAULT_TAGS, type AruSettings, type Profile } from "@/lib/mascot/profiles";
import { TALK_FRAMES, talkKey, type TalkFrame } from "@/lib/mascot/talk";
import { CLIP_SPEC, clipKindsFor, clipPath, defaultMasks, type ClipKind, type Mask, type MaskName } from "@/lib/mascot/clips";
import { clipBatch, dragMask, missingClipKinds, resizeMask, spriteKeys, missingCells, missingPoseCells, missingTalkCells, poseCells as allPoseCells } from "@/lib/mascot/ui";
import { requestJson } from "@/lib/net";
import { Sheet } from "../Sheet";
import { AutoTextarea } from "../TagInput";
import type { WireSettings } from "./MascotSettings";

type Kind = "bust" | "full" | "pose" | "talk";
type Cell = { kind: Kind; expr: Expression; pose?: Pose; outfit?: Outfit; frame?: TalkFrame }; // pose cells carry their own outfit (batches span outfits)
type Estimate = { anlas: number | null; perImage: number | null; n: number };
type Spent = { before: number | null; after: number | null; cost: number | null };
type Confirm = { outfit: Outfit; cells: Cell[]; n: number; total: number | null; anlas: number | null };

const name = (c: Cell) => (c.kind === "full" ? "full" : c.expr);
const isBack = (c: Cell) => c.pose === "back";
const label = (c: Cell) => (c.kind === "full" ? "Full sprite" : c.kind === "talk" ? c.frame!.replace("_", " ") : c.kind === "pose" ? (isBack(c) ? "Back" : c.expr) : c.expr);
/** Listing/serve key of a cell's sprite. */
const keyOf = (o: Outfit, c: Cell) => (c.kind === "talk" ? talkKey(c.outfit ?? o, c.frame!) : c.kind === "pose" ? poseKey(c.pose!, c.outfit ?? o, isBack(c) ? null : c.expr) : `${o}/${name(c)}`);
/** Extra API fields addressing a cell's sprite. */
const target = (o: Outfit, c: Cell) => (c.kind === "talk" ? { outfit: o, talk: c.frame } : c.kind === "pose" ? { outfit: c.outfit ?? o, pose: c.pose, expr: c.expr } : { outfit: o, kind: c.kind, expr: c.expr });
const poseCells = (pose: Pose, outfit: Outfit): Cell[] => allPoseCells({ pose, outfit }).map((p) => ({ kind: "pose", ...p }));
const cellName = (c: Cell) => (c.kind === "pose" ? `${c.pose} · ${c.outfit} · ${label(c)}` : label(c));
const studio = <T,>(body: object) => requestJson<T>("/api/mascot/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const talkCell = (frame: TalkFrame): Cell => ({ kind: "talk", expr: "smug", frame });
const h3 = "text-muted mb-2 text-xs font-medium tracking-wide uppercase";
const btn = "border-border rounded-md border px-3 py-2.5 text-sm disabled:opacity-50";

/** Mascot studio: pick a character (Miyabi: busts, poses, portraits; Aru: day portraits), tag editors + generate candidates → pick → saved sprite. Every spend needs a confirm tap. */
export function SpriteStudio({ open, onClose, settings, onSave }: {
  open: boolean; onClose: () => void; settings: WireSettings; onSave: (patch: Partial<WireSettings>) => Promise<string | null>;
}) {
  const [profile, setProfile] = useState<Profile>("miyabi");
  const [aru, setAru] = useState<AruSettings>(ARU_DEFAULT_TAGS);
  const [outfit, setOutfit] = useState<Outfit>("day");
  const [sprites, setSprites] = useState<Record<string, number>>({});
  const [listing, setListing] = useState<Listing>({ clips: {}, clipMeta: {} });
  const [sheets, setSheets] = useState<Record<Outfit, boolean>>({ day: false, night: false, lewd: false });
  const [mode, setMode] = useState<"bust" | "pose" | "talk" | "clips">("bust");
  const [pose, setPose] = useState<Pose>("stand");
  const [sel, setSel] = useState<Cell | null>(null);
  const [n, setN] = useState(3);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [spent, setSpent] = useState<Spent | null>(null);
  const [batch, setBatch] = useState(0); // bumps after each generate so candidate <img>s reload
  const [gone, setGone] = useState<Set<string>>(new Set()); // candidate urls that 404'd
  const stop = useRef(false);

  const isAru = profile === "aru", q = isAru ? "&profile=aru" : "";
  const refresh = () => requestJson<{ sprites: Record<string, number>; sheets: Record<Outfit, boolean> } & Partial<Listing>>(`/api/mascot/sprites${isAru ? "?profile=aru" : ""}`).then((r) => {
    if (!r.ok) return;
    setSprites(r.data.sprites); setSheets(r.data.sheets); setListing({ clips: r.data.clips ?? {}, clipMeta: r.data.clipMeta ?? {} });
    window.dispatchEvent(new CustomEvent("mascot:sprites", { detail: r.data.sprites })); // listeners reload their own profile's listing (Miyabi's mascot, either portrait)
  });
  useEffect(() => { if (open) refresh(); }, [open, profile]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (open && isAru) requestJson<{ aru: AruSettings }>("/api/mascot/studio").then((r) => { if (r.ok) setAru(r.data.aru); });
  }, [open, isAru]);
  const pickProfile = (p: Profile) => { setProfile(p); setSprites({}); setListing({ clips: {}, clipMeta: {} }); setOutfit("day"); setMode(p === "aru" ? "talk" : "bust"); choose(null); };
  const close = () => { stop.current = true; setConfirm(null); onClose(); }; // closing ends a run: no spending out of sight
  const choose = (c: Cell | null) => { setSel(c); setConfirm(null); setError(null); setNote(null); };
  const pickOutfit = (o: Outfit) => { setOutfit(o); choose(null); };

  /** Estimate first (one call per art kind in the list), then wait for the confirm tap. */
  async function ask(cells: Cell[]) {
    if (!cells.length || busy) return;
    setError(null); setNote(null); setBusy("Checking cost…");
    let total: number | null = 0, anlas: number | null = null;
    const group = (c: Cell) => `${c.kind}/${c.pose ?? ""}`; // canvas size differs per art kind / pose
    for (const g of new Set(cells.map(group))) {
      const first = cells.find((c) => group(c) === g)!;
      const r = await studio<Estimate>({ action: "estimate", profile, ...target(outfit, first), n });
      if (!r.ok) { setBusy(null); setError(r.error); return; }
      anlas = r.data.anlas;
      const count = cells.filter((c) => group(c) === g).length;
      total = total === null || r.data.perImage === null ? null : total + r.data.perImage * r.data.n * count;
    }
    setBusy(null);
    setConfirm({ outfit, cells, n, total, anlas });
  }

  /** Runs only from the confirm button. Sequential; stops on the first error. */
  async function run(c: Confirm) {
    setConfirm(null); stop.current = false;
    let before: number | null = null, after: number | null = null, cost: number | null = 0;
    for (const [i, cell] of c.cells.entries()) {
      if (stop.current) break;
      setBusy(c.cells.length > 1 ? `Generating ${cellName(cell)} (${i + 1}/${c.cells.length})…` : "Generating…");
      const r = await studio<Spent>({ action: "generate", profile, ...target(c.outfit, cell), n: c.n, confirm: true });
      if (!r.ok) { setError(`${cellName(cell)}: ${r.error}`); break; }
      before ??= r.data.before; after = r.data.after;
      cost = cost === null || r.data.cost === null ? null : cost + r.data.cost;
    }
    setSpent({ before, after, cost });
    setBusy(null); setGone(new Set()); setBatch((b) => b + 1);
    if (c.cells.length === 1) setSel(c.cells[0]);
    else setNote("Tap each cell to pick its candidate.");
  }

  async function pick(cell: Cell, i: number) {
    setBusy("Saving (removing background)…"); setError(null); setNote(null);
    const r = await studio<{ ok: true; note?: string }>({ action: "pick", profile, ...target(outfit, cell), i });
    setBusy(null);
    if (!r.ok) { setError(r.error); return; }
    setNote(r.data.note ?? "Saved.");
    refresh();
  }

  async function upload(file: File) {
    const fd = new FormData();
    fd.append("action", "sheet"); fd.append("outfit", outfit); fd.append("file", file);
    const r = await requestJson("/api/mascot/studio", { method: "POST", body: fd });
    if (r.ok) refresh(); else setError(r.error);
  }

  const src = (c: Cell) => { const k = keyOf(outfit, c); return k in sprites ? `/api/mascot/sprites/${k}?v=${sprites[k]}${q}` : null; };
  const missing = missingCells(sprites, outfit);
  const toCells = (m: ReturnType<typeof missingPoseCells>): Cell[] => m.map((c) => ({ kind: "pose", ...c }));
  const missPose = toCells(missingPoseCells(sprites, { pose })), missOutfit = toCells(missingPoseCells(sprites, { outfit }));
  const missTalk = missingTalkCells(sprites, outfit).map(talkCell);
  const candidates = sel ? [0, 1, 2, 3].map((i) => `/api/mascot/sprites/${keyOf(outfit, sel)}?c=${i}&b=${batch}${q}`) : [];

  const cellBtn = (c: Cell, cls: string) => {
    const s = src(c), on = !!sel && keyOf(outfit, sel) === keyOf(outfit, c);
    return (
      <button key={keyOf(outfit, c)} type="button" onClick={() => choose(on ? null : c)} aria-pressed={on} aria-label={`${cellName(c)}${s ? "" : " (missing)"}`}
        className={`relative flex flex-col items-center justify-end overflow-hidden rounded-lg border ${s ? "border-border bg-bg" : "border-border border-dashed"} ${on ? "ring-accent ring-2" : ""} ${cls}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {s && <img src={s} alt="" className="absolute inset-0 size-full object-contain" />}
        <span className="bg-surface/80 relative w-full py-0.5 text-center text-[11px] capitalize">{label(c)}</span>
      </button>
    );
  };

  return (
    <Sheet open={open} onClose={close} label="Sprite studio" closeLabel="Close sprite studio"
      className="h-[94dvh] rounded-t-2xl border-t lg:h-auto lg:max-w-xl lg:rounded-none lg:border-l">
      <header className="flex items-center gap-2 p-3">
        <h2 className="flex-1 text-base font-semibold">Sprite studio</h2>
        <button type="button" onClick={close} aria-label="Close" className="border-border h-11 w-11 shrink-0 rounded-full border">×</button>
      </header>
      <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}>
        <div role="tablist" aria-label="Character" className="border-border grid grid-cols-2 overflow-hidden rounded-md border">
          {(["miyabi", "aru"] as const).map((p) => (
            <button key={p} type="button" role="tab" aria-selected={profile === p} disabled={!!busy} onClick={() => pickProfile(p)}
              className={`h-11 text-sm font-medium capitalize ${profile === p ? "bg-accent text-accent-fg" : "text-muted"}`}>{p}</button>
          ))}
        </div>

        {!isAru && <div role="tablist" aria-label="Outfit" className="border-border grid grid-cols-3 overflow-hidden rounded-md border">
          {OUTFITS.map((o) => (
            <button key={o} type="button" role="tab" aria-selected={outfit === o} disabled={!!busy} onClick={() => pickOutfit(o)}
              className={`h-11 text-sm font-medium capitalize ${outfit === o ? "bg-accent text-accent-fg" : "text-muted"}`}>{o}</button>
          ))}
        </div>}

        <div role="tablist" aria-label="Sprite kind" className={`border-border grid overflow-hidden rounded-md border ${isAru ? "grid-cols-2" : "grid-cols-4"}`}>
          {(isAru ? ["talk", "clips"] as const : ["bust", "pose", "talk", "clips"] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} disabled={!!busy} onClick={() => { setMode(m); choose(null); }}
              className={`h-11 text-sm font-medium ${mode === m ? "bg-accent text-accent-fg" : "text-muted"}`}>{m === "bust" ? "Busts" : m === "pose" ? "Poses" : m === "talk" ? "Portraits" : "Clips"}</button>
          ))}
        </div>

        {mode === "clips" ? (
          <ClipsPanel key={profile + outfit} profile={profile} outfit={outfit} sprites={sprites} listing={listing} refresh={refresh} busy={busy} setBusy={setBusy} stop={stop} />
        ) : <>
        {mode === "talk" ? (
          <section className="grid grid-cols-3 gap-2">{TALK_FRAMES.map((f) => cellBtn(talkCell(f), "aspect-square"))}</section>
        ) : mode === "bust" ? (
          <section className="grid grid-cols-[1fr_2fr] gap-2">
            {cellBtn({ kind: "full", expr: "smug" }, "min-h-48")}
            <div className="grid grid-cols-3 gap-2">{EXPRESSIONS.map((expr) => cellBtn({ kind: "bust", expr }, "aspect-square"))}</div>
          </section>
        ) : (
          <section className="space-y-2">
            <div role="tablist" aria-label="Pose" className="flex flex-wrap gap-2">
              {POSES.map((p) => (
                <button key={p} type="button" role="tab" aria-selected={pose === p} disabled={!!busy} onClick={() => { setPose(p); choose(null); }}
                  className={`border-border flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm capitalize ${pose === p ? "bg-accent text-accent-fg" : "text-muted"}`}>
                  <span aria-hidden className="inline-block h-4 border border-current" style={{ aspectRatio: `${POSE_SPEC[p].width} / ${POSE_SPEC[p].height}` }} />{p}
                </button>
              ))}
            </div>
            <div className={pose === "back" ? "mx-auto grid w-1/2 grid-cols-1 gap-2" : "grid grid-cols-3 gap-2"}>
              {poseCells(pose, outfit).map((c) => cellBtn(c, POSE_SPEC[pose].width > POSE_SPEC[pose].height ? "aspect-[3/2]" : POSE_SPEC[pose].width === POSE_SPEC[pose].height ? "aspect-square" : "aspect-[2/3]"))}
            </div>
          </section>
        )}

        <section className="space-y-2">
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
            Candidates per sprite
            <select value={n} onChange={(e) => setN(Number(e.target.value))} disabled={!!busy} className="bg-bg border-border h-11 rounded-md border px-2 text-sm">
              {[1, 2, 3, 4].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          {sel ? (
            <button type="button" disabled={!!busy || !!confirm} onClick={() => ask([sel])} className={`${btn} bg-accent text-accent-fg w-full border-transparent font-semibold`}>
              Generate {n} — <span className="capitalize">{cellName(sel)}</span>
            </button>
          ) : <p className="text-faint text-xs">Tap a cell to generate or pick its sprite.</p>}
          {mode === "talk" ? (
            <button type="button" disabled={!!busy || !!confirm || !missTalk.length} onClick={() => ask(missTalk)} className={`${btn} w-full`}>
              Generate missing portraits{isAru ? "" : " for this outfit"} ({missTalk.length})
            </button>
          ) : mode === "bust" ? (
            <button type="button" disabled={!!busy || !!confirm || !missing.length} onClick={() => ask(missing)} className={`${btn} w-full`}>
              Generate missing for this outfit ({missing.length})
            </button>
          ) : (<>
            <button type="button" disabled={!!busy || !!confirm || !missPose.length} onClick={() => ask(missPose)} className={`${btn} w-full`}>
              Generate missing for this pose ({missPose.length})
            </button>
            <button type="button" disabled={!!busy || !!confirm || !missOutfit.length} onClick={() => ask(missOutfit)} className={`${btn} w-full`}>
              Generate missing for this outfit ({missOutfit.length})
            </button>
          </>)}

          {confirm && (
            <div role="alertdialog" aria-label="Confirm generation" className="border-accent/40 bg-accent-soft space-y-2 rounded-lg border p-3 text-sm">
              <p>{confirm.cells.length > 1 ? `${confirm.cells.length} sprites × ${confirm.n}` : `${confirm.n} candidate${confirm.n > 1 ? "s" : ""}`} ·{" "}
                <b>{confirm.total === 0 ? "Free on Opus" : confirm.total === null ? "Cost unknown — shown after" : `${confirm.total.toLocaleString()} Anlas`}</b></p>
              <p className="text-muted text-xs">Balance: {confirm.anlas === null ? "unknown" : `${confirm.anlas.toLocaleString()} Anlas`}</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirm(null)} className="border-border flex-1 rounded-md border px-3 py-2">Cancel</button>
                <button type="button" onClick={() => run(confirm)} className="bg-accent text-accent-fg flex-1 rounded-md px-3 py-2 font-semibold">Generate</button>
              </div>
            </div>
          )}
          {busy && <p aria-live="polite" className="text-muted text-sm">{busy}{busy.startsWith("Generating") && <button type="button" onClick={() => { stop.current = true; }} className="text-accent ml-2 min-h-11 px-2">Stop after this</button>}</p>}
          {error && <p role="alert" className="text-danger text-sm">{error}</p>}
          {note && <p aria-live="polite" className="text-sm">{note}</p>}
          {spent && !busy && <p className="text-muted text-xs">Anlas {spent.before ?? "?"} → {spent.after ?? "?"}{spent.cost !== null ? ` (spent ${spent.cost})` : ""}</p>}

          {sel && candidates.some((u) => !gone.has(u)) && (
            <div>
              <p className="mb-1 text-sm">Pick one for <span className="capitalize">{cellName(sel)}</span></p>
              <div className="grid grid-cols-2 gap-2">
                {candidates.map((u, i) => !gone.has(u) && (
                  <button key={u} type="button" disabled={!!busy} onClick={() => pick(sel, i)} aria-label={`Use candidate ${i + 1}`}
                    className="border-border bg-bg overflow-hidden rounded-lg border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u} alt="" className="w-full object-contain" onError={() => setGone((g) => new Set(g).add(u))} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        </>}

        {isAru
          ? <AruTagEditors aru={aru} onSave={async (patch) => { const r = await studio<{ aru: AruSettings }>({ action: "aru-tags", patch }); if (r.ok) setAru(r.data.aru); return r.ok ? null : r.error; }} />
          : <TagEditors outfit={outfit} settings={settings} onSave={onSave} />}

        {!isAru && <section>
          <h3 className={h3}>Character sheet</h3>
          <label className={`${btn} block cursor-pointer text-center`}>
            {sheets[outfit] ? "Replace" : "Upload"} the {outfit} sheet
            <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
          </label>
          <p className="text-faint mt-1 text-xs">Kept for later: V5 sprites are tag-only until Precise Reference works again.</p>
        </section>}
      </div>
    </Sheet>
  );
}

type Field = { key: string; label: string; value: string; def: string; patch: (v: string) => object };
type Save = (patch: object) => Promise<string | null>;

/** Collapsible tag editors: character, constant, this outfit's layer, per expression. Each saves its own patch. */
function TagEditors({ outfit, settings: s, onSave }: { outfit: Outfit; settings: WireSettings; onSave: Save }) {
  const D = DEFAULT_MASCOT_SETTINGS;
  const fields: Field[] = [
    { key: "char", label: "Character", value: s.charTags, def: D.charTags, patch: (v) => ({ charTags: v }) },
    { key: "constant", label: "Constant pieces (all outfits)", value: s.constantTags, def: D.constantTags, patch: (v) => ({ constantTags: v }) },
    { key: `layer-${outfit}`, label: `${outfit} outfit`, value: s.layerTags[outfit], def: D.layerTags[outfit], patch: (v) => ({ layerTags: { ...s.layerTags, [outfit]: v } }) },
    ...EXPRESSIONS.map((e) => ({ key: `expr-${e}`, label: `Expression: ${e}`, value: s.exprTags[e], def: D.exprTags[e], patch: (v: string) => ({ exprTags: { ...s.exprTags, [e]: v } }) })),
  ];
  return (
    <section>
      <h3 className={h3}>Tags</h3>
      <div className="space-y-1">{fields.map((f) => <TagField key={f.key} field={f} onSave={onSave} />)}</div>
    </section>
  );
}

function TagField({ field: f, onSave }: { field: Field; onSave: Save }) {
  const [draft, setDraft] = useState(f.value);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => { if (!failed) setDraft(f.value); }, [f.value]); // eslint-disable-line react-hooks/exhaustive-deps -- a failed save keeps the draft
  const dirty = draft !== f.value;
  return (
    <details className="border-border rounded-md border px-2">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 text-sm capitalize">{f.label}{dirty && <span className="text-accent text-xs normal-case">unsaved</span>}</summary>
      <div className="space-y-2 pb-2">
        <AutoTextarea value={draft} onChange={setDraft} className="font-mono text-sm" />
        {draft.length > 1500 && <p className="text-danger text-xs">Too long ({draft.length}/1500) — won&apos;t save.</p>}
        {failed && <p role="alert" className="text-danger text-xs">Not saved — {failed}</p>}
        <div className="flex gap-2">
          <button type="button" disabled={draft === f.def} onClick={() => setDraft(f.def)} className={`${btn} flex-1`}>Reset to default</button>
          <button type="button" disabled={!dirty || draft.length > 1500} onClick={async () => setFailed(await onSave(f.patch(draft)))} className={`${btn} bg-accent text-accent-fg flex-1 border-transparent font-semibold`}>Save</button>
        </div>
      </div>
    </details>
  );
}

/** Aru's tag editors (saved to her own setting): character, constant, day outfit, per expression. */
function AruTagEditors({ aru: a, onSave }: { aru: AruSettings; onSave: Save }) {
  const D = ARU_DEFAULT_TAGS;
  const fields: Field[] = [
    { key: "char", label: "Character", value: a.charTags, def: D.charTags, patch: (v) => ({ charTags: v }) },
    { key: "constant", label: "Constant pieces", value: a.constantTags, def: D.constantTags, patch: (v) => ({ constantTags: v }) },
    { key: "layer-day", label: "day outfit", value: a.layerTags.day, def: D.layerTags.day, patch: (v) => ({ layerTags: { day: v } }) },
    ...EXPRESSIONS.map((e) => ({ key: `expr-${e}`, label: `Expression: ${e}`, value: a.exprTags[e], def: D.exprTags[e], patch: (v: string) => ({ exprTags: { [e]: v } }) })),
  ];
  return (
    <section>
      <h3 className={h3}>Aru&apos;s tags</h3>
      <div className="space-y-1">{fields.map((f) => <TagField key={f.key} field={f} onSave={onSave} />)}</div>
    </section>
  );
}

type Listing = { clips: Record<string, Partial<Record<ClipKind, number>>>; clipMeta: Record<string, { v: number; masks?: Partial<Record<MaskName, Mask>> }> };
type Item = { baseKey: string; kind: ClipKind };
type ClipConfirm = { items: Item[]; runs: number; images: number; total: number | null; anlas: number | null; redo: boolean };
const baseLabel = (k: string) => k.replace(/^pose\//, "").replace(/^talk\//, "").replaceAll("/", " · ").replaceAll("_", " ");

/** Frame-cycling <img> preview (lighter than a WebGL canvas for a studio thumbnail); a still first frame under reduced motion. */
function FrameLoop({ urls, kind, className }: { urls: string[]; kind: ClipKind; className?: string }) {
  const [i, setI] = useState(0);
  const seq = CLIP_SPEC[kind].sequence && urls.length === CLIP_SPEC[kind].frames ? CLIP_SPEC[kind].sequence! : urls.map((_, j) => j);
  useEffect(() => {
    setI(0);
    if (seq.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((x) => (x + 1) % seq.length), 1000 / CLIP_SPEC[kind].fps);
    return () => clearInterval(t);
  }, [urls.join("|"), kind]); // eslint-disable-line react-hooks/exhaustive-deps
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={urls[seq[i % seq.length]]} alt={`${kind} preview`} className={className} />;
}

/** Clips tab: pick a base sprite → per-kind frames + looping preview, make missing / redo with candidate pick, and nudge the eye/mouth masks. */
function ClipsPanel({ profile, outfit, sprites, listing, refresh, busy, setBusy, stop }: {
  profile: Profile; outfit: Outfit; sprites: Record<string, number>; listing: Listing; refresh: () => Promise<void>;
  busy: string | null; setBusy: (b: string | null) => void; stop: { current: boolean };
}) {
  const aru = profile === "aru", q = aru ? "&profile=aru" : "";
  const [key, setKey] = useState<string | null>(null);
  const [kind, setKind] = useState<ClipKind>("blink");
  const [runs, setRuns] = useState(2);
  const [confirm, setConfirm] = useState<ClipConfirm | null>(null);
  const [cand, setCand] = useState<{ baseKey: string; kind: ClipKind; runs: number } | null>(null);
  const [batch, setBatch] = useState(0); // bumps so candidate <img>s reload
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const keys = spriteKeys(sprites, outfit, aru);
  const groups: [string, string[]][] = [["Busts", keys.filter((k) => !k.startsWith("pose/") && !k.startsWith("talk/"))], ["Poses", keys.filter((k) => k.startsWith("pose/"))], ["Portraits", keys.filter((k) => k.startsWith("talk/"))]];
  const cur = key && key in sprites ? key : null;
  const frameUrls = (k: string, kd: ClipKind, c?: number) => Array.from({ length: CLIP_SPEC[kd].frames }, (_, n) => {
    const p = clipPath("/api/mascot/sprites", k, kd, n)!.slice(0, -4);
    return c === undefined ? `${p}?v=${listing.clipMeta[k]?.v ?? 0}${q}` : `${p}?c=${c}&b=${batch}${q}`;
  });
  const have = (k: string, kd: ClipKind) => !!listing.clips[k]?.[kd];
  const playable = (k: string) => clipKindsFor(k, !!listing.clipMeta[k]?.masks?.eyes);
  const pickBase = (k: string | null) => { setKey(k); setConfirm(null); setCand(null); setError(null); setNote(null); };

  /** One estimate call per base sprite (canvas size differs), then wait for the confirm tap. */
  async function ask(items: Item[], runs: number, redo: boolean) {
    if (!items.length || busy) return;
    setError(null); setNote(null); setBusy("Checking cost…");
    let total: number | null = 0, images = 0, anlas: number | null = null;
    for (const baseKey of new Set(items.map((i) => i.baseKey))) {
      const kinds = items.filter((i) => i.baseKey === baseKey).map((i) => i.kind);
      const r = await studio<{ anlas: number | null; perImage: number | null; count: number }>({ action: "clip-estimate", profile, baseKey, kinds, n: runs });
      if (!r.ok) { setBusy(null); setError(r.error); return; }
      anlas = r.data.anlas; images += r.data.count;
      total = total === null || r.data.perImage === null ? null : total + r.data.perImage * r.data.count;
    }
    setBusy(null);
    setConfirm({ items, runs, images, total, anlas, redo });
  }

  /** Runs only from the confirm button. Sequential; stops on the first error. A batch auto-picks run 0; a redo leaves its runs as candidates. */
  async function run(c: ClipConfirm) {
    setConfirm(null); stop.current = false;
    for (const [i, it] of c.items.entries()) {
      if (stop.current) break;
      const what = `${baseLabel(it.baseKey)} ${it.kind}`;
      setBusy(`Generating ${what} (${i + 1}/${c.items.length})…`);
      const g = await studio<unknown>({ action: "clip-generate", profile, ...it, n: c.runs, confirm: true });
      if (!g.ok) { setError(`${what}: ${g.error}`); break; }
      if (c.redo) { setCand({ ...it, runs: c.runs }); setBatch((b) => b + 1); setNote("Preview each run, then use one."); continue; }
      setBusy(`Saving ${what} (removing background)…`);
      const p = await studio<unknown>({ action: "clip-pick", profile, ...it, i: 0 });
      if (!p.ok) { setError(`${what}: ${p.error}`); break; }
    }
    setBusy(null); await refresh();
  }

  async function use(i: number) {
    if (!cand) return;
    setBusy("Saving (removing background)…"); setError(null);
    const r = await studio<unknown>({ action: "clip-pick", profile, baseKey: cand.baseKey, kind: cand.kind, i });
    setBusy(null);
    if (!r.ok) { setError(r.error); return; }
    setCand(null); setNote("Saved."); await refresh();
  }

  const mine = cur ? missingClipKinds(listing.clips, cur, !!listing.clipMeta[cur]?.masks?.eyes).map((k) => ({ baseKey: cur, kind: k })) : [];
  const all = clipBatch(sprites, listing.clips, outfit, aru, listing.clipMeta);
  const lock = !!busy || !!confirm;
  return (
    <section className="space-y-4">
      <div className="space-y-3">
        <h3 className={h3}>1 · Base sprite</h3>
        {groups.filter(([, ks]) => ks.length).map(([title, ks]) => (
          <div key={title}>
            <p className="text-faint mb-1 text-xs">{title}</p>
            <div className="grid grid-cols-4 gap-2">
              {ks.map((k) => (
                <button key={k} type="button" disabled={!!busy} onClick={() => pickBase(cur === k ? null : k)} aria-pressed={cur === k} aria-label={`${baseLabel(k)}, ${Object.keys(listing.clips[k] ?? {}).length} of ${playable(k).length} clips`}
                  className={`border-border bg-bg relative aspect-square overflow-hidden rounded-lg border ${cur === k ? "ring-accent ring-2" : ""}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/mascot/sprites/${k}?v=${sprites[k]}${q}`} alt="" className="absolute inset-0 size-full object-contain" />
                  <span className="bg-surface/80 absolute inset-x-0 bottom-0 text-center text-[10px]">{Object.keys(listing.clips[k] ?? {}).length}/{playable(k).length}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {!keys.length && <p className="text-faint text-xs">No sprites for this {aru ? "character" : "outfit"} yet. Generate one in the other tabs first.</p>}
        <button type="button" disabled={lock || !all.length} onClick={() => ask(all, 1, false)} className={`${btn} w-full`}>
          Make missing clips for all sprites of this outfit ({all.length})
        </button>
      </div>

      {cur && (
        <div className="space-y-3">
          <h3 className={h3}>2 · Clips for {baseLabel(cur)}</h3>
          <button type="button" disabled={lock || !mine.length} onClick={() => ask(mine, 1, false)} className={`${btn} w-full`}>Make missing clips for this sprite ({mine.length})</button>
          {have(cur, kind) && <div className="bg-bg border-border mx-auto flex h-48 w-fit items-end justify-center rounded-lg border px-2"><FrameLoop key={`${cur}${kind}${listing.clipMeta[cur]?.v}`} urls={frameUrls(cur, kind)} kind={kind} className="h-full max-w-full object-contain" /></div>}
          {!playable(cur).length && <p className="text-faint text-xs">No clips play on this sprite (back view and think/listen/talk frames stay still).</p>}
          <ul className="space-y-1">
            {playable(cur).map((kd) => (
              <li key={kd} className={`border-border flex items-center gap-2 rounded-md border p-1.5 ${kd === kind ? "ring-accent ring-1" : ""}`}>
                <button type="button" onClick={() => setKind(kd)} aria-pressed={kd === kind} className="flex min-h-11 flex-1 items-center gap-2 text-left text-sm capitalize">
                  <span className="w-12 shrink-0">{kd}</span>
                  {have(cur, kd)
                    ? <span className="flex gap-1">{frameUrls(cur, kd).slice(0, listing.clips[cur]![kd]).map((u, n) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={n} src={u} alt="" className="bg-bg border-border size-9 rounded border object-contain" />))}</span>
                    : <span className="text-faint text-xs normal-case">missing</span>}
                </button>
                <button type="button" disabled={lock} onClick={() => ask([{ baseKey: cur, kind: kd }], runs, true)} className="border-border min-h-11 rounded-md border px-3 text-sm disabled:opacity-50">Redo</button>
              </li>
            ))}
          </ul>
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
            Runs per redo
            <select value={runs} onChange={(e) => setRuns(Number(e.target.value))} disabled={!!busy} className="bg-bg border-border h-11 rounded-md border px-2 text-sm">
              {[1, 2, 3, 4].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
        </div>
      )}

      {confirm && (
        <div role="alertdialog" aria-label="Confirm generation" className="border-accent/40 bg-accent-soft space-y-2 rounded-lg border p-3 text-sm">
          <p>{confirm.items.length} clip{confirm.items.length > 1 ? "s" : ""}{confirm.runs > 1 ? ` × ${confirm.runs} runs` : ""} · {confirm.images} images ·{" "}
            <b>{confirm.total === 0 ? "Free on Opus" : confirm.total === null ? "Cost unknown — shown after" : `${confirm.total.toLocaleString()} Anlas`}</b></p>
          <p className="text-muted text-xs">Balance: {confirm.anlas === null ? "unknown" : `${confirm.anlas.toLocaleString()} Anlas`}{confirm.redo ? "" : " · run 1 of each is saved automatically"}</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setConfirm(null)} className="border-border flex-1 rounded-md border px-3 py-2">Cancel</button>
            <button type="button" onClick={() => run(confirm)} className="bg-accent text-accent-fg flex-1 rounded-md px-3 py-2 font-semibold">Generate</button>
          </div>
        </div>
      )}
      {busy && <p aria-live="polite" className="text-muted text-sm">{busy}{busy.startsWith("Generating") && <button type="button" onClick={() => { stop.current = true; }} className="text-accent ml-2 min-h-11 px-2">Stop after this</button>}</p>}
      {error && <p role="alert" className="text-danger text-sm">{error}</p>}
      {note && <p aria-live="polite" className="text-sm">{note}</p>}

      {cand && (
        <div>
          <p className="mb-1 text-sm">Pick a run for <span className="capitalize">{baseLabel(cand.baseKey)} {cand.kind}</span></p>
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: cand.runs }, (_, i) => (
              <div key={i} className="border-border space-y-1 rounded-lg border p-1">
                <div className="bg-bg flex h-36 items-end justify-center"><FrameLoop key={batch} urls={frameUrls(cand.baseKey, cand.kind, i)} kind={cand.kind} className="h-full max-w-full object-contain" /></div>
                <button type="button" disabled={!!busy} onClick={() => use(i)} className={`${btn} w-full`}>Use run {i + 1}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {cur && <MaskEditor key={cur} baseKey={cur} src={`/api/mascot/sprites/${cur}?v=${sprites[cur]}${q}`} saved={listing.clipMeta[cur]?.masks} busy={!!busy} refresh={refresh} profile={profile} />}
    </section>
  );
}

const MASK_STYLE: Record<MaskName, string> = { eyes: "border-sky-400 bg-sky-400/25", mouth: "border-rose-400 bg-rose-400/25" };

/** Eye/mouth box editor over the base sprite: drag to move, corner handle to resize, arrows nudge (shift + arrows resize). Masks only affect blink and talk (inpainted). */
function MaskEditor({ baseKey, src, saved, busy, refresh, profile }: { baseKey: string; src: string; saved?: Partial<Record<MaskName, Mask>>; busy: boolean; refresh: () => Promise<void>; profile: Profile }) {
  const D = defaultMasks(baseKey);
  const [m, setM] = useState<Record<MaskName, Mask>>({ ...D, ...saved });
  const [msg, setMsg] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ name: MaskName; resize: boolean; x: number; y: number; from: Mask } | null>(null);
  const edit = (name: MaskName, v: Mask) => { setM((p) => ({ ...p, [name]: v })); setMsg(null); };
  const down = (name: MaskName, resize: boolean) => (e: React.PointerEvent) => {
    e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { name, resize, x: e.clientX, y: e.clientY, from: m[name] };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current, r = box.current?.getBoundingClientRect();
    if (!d || !r?.width || !r.height) return;
    const dx = (e.clientX - d.x) / r.width, dy = (e.clientY - d.y) / r.height;
    edit(d.name, d.resize ? resizeMask(d.from, dx, dy) : dragMask(d.from, dx, dy));
  };
  const key = (name: MaskName, resize: boolean) => (e: React.KeyboardEvent) => {
    const a = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!a) return;
    e.preventDefault(); e.stopPropagation();
    const s = 0.01;
    edit(name, resize || e.shiftKey ? resizeMask(m[name], a[0] * s, a[1] * s) : dragMask(m[name], a[0] * s, a[1] * s));
  };
  async function save() {
    const r = await studio<unknown>({ action: "clip-masks", profile, baseKey, masks: m });
    if (!r.ok) { setMsg(r.error); return; }
    setMsg("Masks saved. Redo blink/talk to use them."); await refresh();
  }
  return (
    <div className="space-y-2">
      <h3 className={h3}>3 · Eye and mouth masks</h3>
      <p className="text-faint text-xs">Drag a box onto the eyes or mouth; the corner dot resizes. Masks only affect blink and talk (inpainted). Redo those clips after saving.</p>
      <div ref={box} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
        className="bg-bg border-border relative mx-auto w-fit max-w-full touch-none select-none rounded-lg border">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" draggable={false} className="block max-h-[60dvh] max-w-full rounded-lg" />
        {(["eyes", "mouth"] as const).map((n) => (
          <div key={n} role="group" tabIndex={0} aria-label={`${n} box: arrows move, shift and arrows resize`} onPointerDown={down(n, false)} onKeyDown={key(n, false)}
            style={{ left: `${m[n].x * 100}%`, top: `${m[n].y * 100}%`, width: `${m[n].w * 100}%`, height: `${m[n].h * 100}%` }}
            className={`absolute cursor-move border-2 ${MASK_STYLE[n]}`}>
            <button type="button" aria-label={`Resize ${n} box`} onPointerDown={down(n, true)} onKeyDown={key(n, true)}
              className="absolute -right-[22px] -bottom-[22px] z-10 flex size-11 cursor-nwse-resize items-center justify-center">
              <span aria-hidden="true" className="size-6 rounded-full border-2 border-white bg-black/60" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => { setM(D); setMsg(null); }} className={`${btn} flex-1`}>Reset</button>
        <button type="button" disabled={busy} onClick={save} className={`${btn} bg-accent text-accent-fg flex-1 border-transparent font-semibold`}>Save masks</button>
      </div>
      {msg && <p aria-live="polite" className="text-sm">{msg}</p>}
    </div>
  );
}
