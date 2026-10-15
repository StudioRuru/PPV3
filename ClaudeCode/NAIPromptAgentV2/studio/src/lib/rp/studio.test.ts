import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkText, fetchPageText, htmlToText, privateHost, wikitextToText } from "./ingest";
import { coerceCard, extractJson } from "./draft";

test("wikitextToText keeps prose and quotes, drops templates and link markup", () => {
  const t = wikitextToText("{{Infobox|name=Mio}}\n'''Mio''' is a [[cat girl|catgirl]].\n\n\"Hmph!\" she said.");
  assert.doesNotMatch(t, /Infobox/);
  assert.match(t, /Mio is a catgirl\./);
  assert.match(t, /"Hmph!" she said\./);
});

test("htmlToText strips scripts and styles, keeps paragraphs", () => {
  const t = htmlToText("<html><head><style>p{}</style></head><body><script>alert(1)</script><p>One</p><p>Two &amp; three</p></body></html>");
  assert.doesNotMatch(t, /alert|p\{\}/);
  assert.match(t, /One\s+Two & three/);
});

test("chunkText splits on paragraphs near the size", () => {
  const text = Array.from({ length: 10 }, (_, i) => `${i} ${"a".repeat(500)}`).join("\n\n");
  const chunks = chunkText(text, 1500);
  assert.ok(chunks.length >= 3 && chunks.length <= 5);
  assert.ok(chunks.every((c) => c.length <= 1600));
});

test("extractJson pulls JSON out of fenced or chatty replies; coerceCard fills gaps", () => {
  assert.deepEqual(extractJson('Sure! ```json\n{"name":"Mio"}\n``` hope that helps'), { name: "Mio" });
  assert.deepEqual(extractJson('blah {"a":1} blah'), { a: 1 });
  const c = coerceCard({ name: "Mio", tags: ["a", 3] });
  assert.equal(c.name, "Mio");
  assert.equal(c.description, "");
  assert.deepEqual(c.tags, ["a"]);
  assert.deepEqual(c.voiceLines, []);
});

test("private hosts are refused before any fetch", async () => {
  for (const h of ["localhost", "127.0.0.1", "10.0.0.5", "192.168.1.2", "172.16.0.1", "169.254.1.1", "::1", "big-mac-mini.tail57826e.ts.net", "printer.local", "0.0.0.0"]) assert.equal(privateHost(h), true, h);
  for (const h of ["naruto.fandom.com", "en.wikipedia.org", "172.32.0.1"]) assert.equal(privateHost(h), false, h);
  await assert.rejects(fetchPageText("http://127.0.0.1:8191/health"), /local|private/i);
});

test("wiki search refuses private hosts too", async () => {
  const { searchWiki } = await import("./ingest");
  await assert.rejects(searchWiki("192.168.1.10", "Mio"), /local|private/i);
});

test("review I4: IPv6 literals (incl. IPv4-mapped loopback) are refused", async () => {
  for (const h of ["[::ffff:7f00:1]", "::ffff:c0a8:101", "[2001:db8::1]", "[::]"]) assert.equal(privateHost(h), true, h);
  await assert.rejects(fetchPageText("http://[::ffff:7f00:1]:11434/"), /local|private/i);
});

test("review I5: readCapped stops reading past the cap; small bodies come back whole", async () => {
  const { readCapped } = await import("./ingest");
  let pulled = 0;
  const endless = new ReadableStream<Uint8Array>({ pull(c) { pulled++; c.enqueue(new Uint8Array(1024)); } });
  await assert.rejects(readCapped(new Response(endless), 10_000), /too big/i);
  assert.ok(pulled < 50, `stopped early (pulled ${pulled} chunks)`);
  assert.equal((await readCapped(new Response("hello"), 100)).toString(), "hello");
});
