// Ported from Delfino Plaza src/lib/ingest/html.ts.

/**
 * Fetching and flattening a canon source (a wiki page, a character profile) into
 * plain text chunks a model can distil.
 *
 * Deliberately dependency-free: a full DOM parser buys accuracy we don't need,
 * because the output is never shown to the user or injected into a prompt as-is —
 * it is fed to the distiller, which is tolerant of ragged input. What matters is
 * that navigation, scripts and styling don't survive to waste the model's context.
 */

/** Hard cap on a fetched page, so one enormous URL can't exhaust memory. */
const MAX_BYTES = 2_000_000;
/** Chunk size in characters. Small enough that a 12–32B local model stays coherent. */
const CHUNK_CHARS = 1500;

export class IngestError extends Error {}

/** Read a response body, giving up as soon as it passes `max` bytes (a chunked multi-GB reply is never buffered). */
export async function readCapped(res: Response, max: number): Promise<Buffer> {
  if (Number(res.headers.get("content-length") ?? 0) > max) throw new IngestError("That response is too big.");
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { await reader.cancel().catch(() => {}); throw new IngestError("That response is too big."); }
    parts.push(value);
  }
  return Buffer.concat(parts);
}
const readJson = async (res: Response, max = MAX_BYTES) => JSON.parse((await readCapped(res, max)).toString("utf8"));

/**
 * Hosts the server must never fetch on a user's behalf: loopback, private ranges, link-local, mDNS and the tailnet
 * (the model servers and this app live there).
 * ponytail: hostname check only — a public name that resolves or redirects to a private address still gets through; owner-only app.
 */
export function privateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".ts.net") || h.endsWith(".internal")) return true;
  if (h.includes(":")) return true; // any IPv6 literal (::1, ::ffff:127.0.0.1 …) — wiki sources are never raw IPv6
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** Elements whose *contents* are never prose. */
const DROP_CONTENT =
  /<(script|style|noscript|template|svg|head|nav|footer|form|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi;

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name: string) => HTML_ENTITIES[name.toLowerCase()] ?? m);
}

/** Strip markup to readable text, preserving paragraph and list breaks. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(DROP_CONTENT, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      // Block-level tags become newlines so paragraphs survive as chunk boundaries.
      .replace(/<\/(p|div|section|article|h[1-6]|li|tr|blockquote)\s*>/gi, "\n")
      .replace(/<(br|hr)\s*\/?>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ------------------------------- MediaWiki ------------------------------- */

/**
 * Wikis are the canon sources that matter for this feature, and they're MediaWiki,
 * so we ask the API rather than scrape the page. That is better on every axis:
 * Fandom serves a Cloudflare 403 to any server-side page fetch but leaves `api.php`
 * open; wikitext arrives with no navigation chrome to strip; and — the real prize —
 * the infobox spells out a character's aliases (`kana`, `romanji`, `othernames`),
 * which is precisely what lorebook keys need, while `{{quote}}` templates are
 * literal, quotable voice lines.
 */
function wikiApiUrl(u: URL): { api: URL; page: string } | null {
  const m = /^\/wiki\/(.+)$/.exec(u.pathname);
  if (!m) return null;
  const page = decodeURIComponent(m[1]);
  if (!page || page.includes(":")) return null; // Special:/File:/Category: pages aren't articles.

  const api = new URL(`${u.origin}/api.php`);
  api.searchParams.set("action", "parse");
  api.searchParams.set("page", page);
  api.searchParams.set("prop", "wikitext");
  api.searchParams.set("format", "json");
  api.searchParams.set("formatversion", "2");
  return { api, page };
}

/**
 * Flatten wikitext to prose, deliberately *keeping* the two things a distiller
 * most wants and a naive strip would destroy: infobox fields (aliases, birthday,
 * height) and quote templates (real lines of dialogue).
 */
export function wikitextToText(wt: string): string {
  const kept: string[] = [];

  // {{quote|line|speaker}} → an explicit quote line the distiller can lift verbatim.
  for (const m of wt.matchAll(/\{\{\s*quote\s*\|([^|}]+)/gi)) {
    const line = m[1].trim();
    if (line) kept.push(`QUOTE: ${line}`);
  }

  // Infobox `|key = value` pairs, which carry the name variants and vital stats.
  const infobox = /\{\{\s*infobox[\s\S]*?\n\}\}/i.exec(wt)?.[0] ?? "";
  for (const m of infobox.matchAll(/^\s*\|\s*([a-z_ ]+?)\s*=\s*([^\n|]+)$/gim)) {
    const key = m[1].trim();
    const value = m[2].replace(/\[\[|\]\]|'''|''/g, "").trim();
    if (value && !/^</.test(value) && key !== "image") kept.push(`${key}: ${value}`);
  }

  const body = wt
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, " ")
    .replace(/<ref[^>]*\/>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\{\|[\s\S]*?\|\}/g, " ") // tables
    .replace(/\{\{[\s\S]*?\}\}/g, " ") // remaining templates (already harvested above)
    .replace(/\[\[(?:[^\]|]*\|)?([^\]|]+)\]\]/g, "$1") // [[Link|text]] → text
    .replace(/\[[^\s\]]+\s([^\]]+)\]/g, "$1") // [http://x label] → label
    .replace(/^=+\s*(.+?)\s*=+$/gm, "\n$1\n") // headings
    .replace(/'''|''/g, "")
    .replace(/^[*#:;]+\s*/gm, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return [kept.join("\n"), body].filter(Boolean).join("\n\n");
}

/** Try the MediaWiki API for a /wiki/ URL. Returns null when this isn't a wiki. */
async function fetchViaMediaWiki(u: URL): Promise<{ text: string; title: string } | null> {
  const target = wikiApiUrl(u);
  if (!target) return null;

  let res: Response;
  try {
    res = await fetch(target.api, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    return null; // Not a MediaWiki host, or unreachable — fall back to scraping.
  }
  if (!res.ok) return null;

  let data: { parse?: { title?: string; wikitext?: string }; error?: unknown };
  try {
    data = (await readJson(res)) as typeof data;
  } catch {
    return null;
  }
  const wikitext = data.parse?.wikitext;
  if (!wikitext || typeof wikitext !== "string") return null;

  const text = wikitextToText(wikitext);
  if (text.length < 200) return null;
  return { text, title: data.parse?.title || target.page };
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/* --------------------------------- search -------------------------------- */

export interface WikiHit {
  title: string;
  /** Canonical /wiki/ URL, ready to feed straight into fetchPageText. */
  url: string;
}

/**
 * Reduce whatever the user typed to a MediaWiki host.
 *
 * Fandom has no reliable keyless cross-wiki search, so research is scoped to one
 * wiki. The user names it however is convenient — "umamusume.fandom.com", the
 * bare "umamusume", "https://…/wiki/Special:Foo" — and we distil that to the host
 * whose /api.php we'll query. A bare word is assumed to be a Fandom subdomain,
 * since Fandom is the source this feature targets.
 */
export function normalizeWikiHost(input: string): string {
  const raw = input.trim();
  if (!raw) throw new IngestError("Name the wiki to search (e.g. umamusume.fandom.com).");
  // A full URL (or scheme-less host/path): take its host.
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (u.hostname.includes(".")) return u.hostname;
  } catch {
    /* fall through to bare-word handling */
  }
  // A bare word with no dot → treat as a Fandom subdomain.
  const word = raw.replace(/^https?:\/\//, "").split("/")[0];
  if (!word.includes(".")) return `${word}.fandom.com`;
  return word;
}

/**
 * Search *within* one MediaWiki host for a name, returning candidate article
 * pages. Namespaced results (Category:, File:, User:…) are dropped — only real
 * articles make sense as a character source. Throws IngestError on failure so the
 * route can surface a clean message.
 */
export async function searchWiki(hostInput: string, query: string): Promise<WikiHit[]> {
  const host = normalizeWikiHost(hostInput);
  if (privateHost(host)) throw new IngestError("Local and private network addresses can't be fetched.");
  const q = query.trim();
  if (!q) throw new IngestError("Enter a character name to search for.");

  const api = new URL(`https://${host}/api.php`);
  api.searchParams.set("action", "query");
  api.searchParams.set("list", "search");
  api.searchParams.set("srsearch", q);
  api.searchParams.set("srlimit", "8");
  api.searchParams.set("srnamespace", "0"); // Main/article namespace only.
  api.searchParams.set("format", "json");
  api.searchParams.set("formatversion", "2");

  let res: Response;
  try {
    res = await fetch(api, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new IngestError(`Couldn't reach ${host}. Check the wiki name.`);
  }
  if (!res.ok) throw new IngestError(`${host} returned ${res.status}. Check the wiki name.`);

  let data: { query?: { search?: { title?: string }[] } };
  try {
    data = (await readJson(res)) as typeof data;
  } catch {
    throw new IngestError(`${host} didn't return a MediaWiki search response.`);
  }

  const hits = data.query?.search ?? [];
  const out: WikiHit[] = [];
  for (const h of hits) {
    const title = typeof h.title === "string" ? h.title.trim() : "";
    if (!title || title.includes(":")) continue;
    out.push({ title, url: `https://${host}/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}` });
  }
  return out;
}

/** Fetch a page as text. Rejects non-HTTP schemes and oversized or non-textual bodies. */
export async function fetchPageText(url: string): Promise<{ text: string; title: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new IngestError("That doesn't look like a URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new IngestError("Only http(s) URLs can be ingested.");
  }
  if (privateHost(parsed.hostname)) throw new IngestError("Local and private network addresses can't be fetched.");

  // Wikis: ask the API. Far cleaner than the rendered page, and Fandom blocks the
  // rendered page to server-side clients anyway.
  const viaWiki = await fetchViaMediaWiki(parsed);
  if (viaWiki) return viaWiki;

  let res: Response;
  try {
    res = await fetch(parsed, {
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
      },
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    throw new IngestError(
      `Couldn't reach ${parsed.hostname}: ${err instanceof Error ? err.message : "network error"}`,
    );
  }

  if (res.status === 403) {
    throw new IngestError(
      `${parsed.hostname} refused the request (403). Sites behind bot protection can't be fetched — ` +
        `if it's a wiki, link the /wiki/Page_Name URL directly and it'll go through the wiki API instead.`,
    );
  }
  if (!res.ok) throw new IngestError(`${parsed.hostname} returned HTTP ${res.status}.`);

  const type = res.headers.get("content-type") ?? "";
  if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) {
    throw new IngestError(`That URL serves ${type || "an unknown type"}, not a web page.`);
  }

  // Read at most 4× the text cap (multi-byte pages), then keep the first MAX_BYTES characters.
  const raw = await readCapped(res, MAX_BYTES * 4).then((b) => b.toString("utf8"), (e) => { throw e instanceof IngestError ? new IngestError(`${parsed.hostname} sent a page that's too big to read.`) : e; });
  const body = raw.length > MAX_BYTES ? raw.slice(0, MAX_BYTES) : raw;

  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1] ?? "")
    .trim()
    .slice(0, 120);
  const text = /text\/plain/i.test(type) ? body : htmlToText(body);

  if (text.length < 200) {
    throw new IngestError(
      "That page had almost no readable text — it may be JavaScript-rendered. Try a different source, or paste the text directly.",
    );
  }

  return { text, title: title || parsed.hostname };
}

/**
 * Split text into chunks on paragraph boundaries. A paragraph longer than the
 * chunk size is emitted whole rather than cut mid-sentence — an over-long chunk
 * costs a little context, a severed one costs meaning.
 */
export function chunkText(text: string, size: number = CHUNK_CHARS): string[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const p of paragraphs) {
    if (current && current.length + p.length + 2 > size) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current}\n\n${p}` : p;
    if (current.length >= size) {
      chunks.push(current);
      current = "";
    }
  }
  if (current) chunks.push(current);

  // Drop chunks too small to carry a fact — mostly nav crumbs that survived stripping.
  return chunks.filter((c) => c.length >= 80);
}
