// Fake cut chat clips for manual checks: node scripts/sprite-fixtures.mjs <scratch library dir> <scratch studio.db> [outfit]
// Writes 3 coloured, numbered frames + meta.json per clip and marks the cells cut=done. Scratch paths only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import sharp from "sharp";

const [lib, dbPath, outfit = "day"] = process.argv.slice(2).map((p, i) => (i < 2 ? path.resolve(p) : p));
const tmp = [fs.realpathSync(os.tmpdir()), "/private/tmp"];
if (!lib || !dbPath || ![lib, dbPath].every((p) => tmp.some((t) => p.startsWith(t + path.sep)))) { console.error("usage: sprite-fixtures.mjs <library dir> <studio.db>  (both under the temp dir)"); process.exit(1); }

const COLOR = { neutral: "#6b7280", happy: "#f59e0b", sad: "#3b82f6", smug: "#a855f7" };
const clips = [["neutral", "neutral"], ["happy", "happy"], ["sad", "sad"], ["smug", "smug"], ["neutral", "happy"], ["happy", "sad"], ["happy", "smug"]];
const db = new Database(dbPath);
const sort = (k) => db.prepare("SELECT sort FROM sprite_keys WHERE surface = 'chat' AND key = ?").get(k)?.sort;
const W = 480, H = 832, N = 3;

for (const [from, to] of clips) {
  const dir = path.join(lib, "chat", outfit, `${from}~${to}`);
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < N; i++) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect x="60" y="80" width="360" height="752" rx="60" fill="${COLOR[to]}"/><circle cx="240" cy="${200 + i * 12}" r="${70 + i * 4}" fill="${COLOR[from]}" stroke="#fff" stroke-width="6"/><text x="240" y="520" font-size="64" text-anchor="middle" fill="#fff" font-family="sans-serif">${from}</text><text x="240" y="600" font-size="64" text-anchor="middle" fill="#fff" font-family="sans-serif">${to}</text><text x="240" y="700" font-size="96" text-anchor="middle" fill="#fff" font-family="sans-serif">${i}</text></svg>`;
    await sharp(Buffer.from(svg)).webp().toFile(path.join(dir, `${String(i).padStart(3, "0")}.webp`));
  }
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ frames: N, fps: 30, w: W, h: H, v: 1 }));
  const rev = from !== to && sort(from) > sort(to) ? 1 : 0;
  db.prepare("INSERT OR IGNORE INTO sprite_cells (surface, outfit, from_key, to_key, reverse) VALUES ('chat', ?, ?, ?, ?)").run(outfit, from, to, rev);
  db.prepare("UPDATE sprite_cells SET cut = 'done' WHERE surface = 'chat' AND outfit = ? AND from_key = ? AND to_key = ?").run(outfit, from, to);
}
// the reverse cell of happy~sad has no clip of its own: it plays the mirror backwards
db.prepare("INSERT OR IGNORE INTO sprite_cells (surface, outfit, from_key, to_key, reverse) VALUES ('chat', ?, 'sad', 'happy', 1)").run(outfit);
console.log(`fixtures: ${clips.length} clips in ${lib}`);
