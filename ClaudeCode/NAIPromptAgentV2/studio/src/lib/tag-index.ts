import "server-only";
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { DANBOORU_CSV, TAGS_DIR } from "./env";
import { buildIndex, parseDanbooruCsv, V5_TAGS, yamlTagNames, type TagEntry } from "./tags";

let cache: TagEntry[] | null = null;

export function tagIndex(): TagEntry[] {
  if (cache) return cache;
  const entries: TagEntry[] = fs.existsSync(DANBOORU_CSV) ? parseDanbooruCsv(fs.readFileSync(DANBOORU_CSV, "utf8")) : [];
  for (const f of fs.readdirSync(TAGS_DIR).filter((f) => f.endsWith(".yaml"))) {
    for (const name of yamlTagNames(parse(fs.readFileSync(path.join(TAGS_DIR, f), "utf8"))))
      entries.push({ name, category: "general", count: 0, aliases: [], source: "yaml" });
  }
  for (const name of V5_TAGS) entries.push({ name, category: "v5", count: 0, aliases: [], source: "v5" });
  return (cache = buildIndex(entries));
}
