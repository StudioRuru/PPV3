import path from "node:path";

/** Repo root holding the shared tags/ and data/ folders (parent of studio/). */
export const REPO_DIR = process.env.REPO_DIR || path.resolve(process.cwd(), "..");
export const DATA_DIR = path.join(REPO_DIR, "data");
export const GALLERY_DIR = path.join(DATA_DIR, "gallery");
export const TAGS_DIR = path.join(REPO_DIR, "tags");
export const DB_PATH = path.join(DATA_DIR, "studio.db");
/** Danbooru tag CSV (name,type,count,aliases) fetched by `npm run fetch:danbooru`. */
export const DANBOORU_CSV = path.join(process.cwd(), "data", "danbooru.csv");

export const NOVELAI_TOKEN = process.env.NOVELAI_TOKEN || "";
export const APP_PASSWORD = process.env.APP_PASSWORD || "";
export const AUTH_ENABLED = APP_PASSWORD.length > 0;
export const TAGGER_URL = (process.env.TAGGER_URL || "http://127.0.0.1:8190").replace(/\/$/, "");
export const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
export const BRAIN_MODEL = process.env.BRAIN_MODEL || "gemma4-12b-heretic-vision:latest";
export const CAPTION_URL = (process.env.CAPTION_URL || "http://127.0.0.1:8191").replace(/\/$/, "");
export const TIPO_URL = (process.env.TIPO_URL || "http://127.0.0.1:8193").replace(/\/$/, "");
/** Optional Danbooru account (raises the 2-tag search limit). */
export const DANBOORU_LOGIN = process.env.DANBOORU_LOGIN || "";
export const DANBOORU_API_KEY = process.env.DANBOORU_API_KEY || "";
