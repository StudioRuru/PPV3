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
/** RP model pod (llama.cpp server) through the SSH tunnel; its models show up as "pod:<alias>". */
export const RP_POD_URL = (process.env.RP_POD_URL || "http://127.0.0.1:8091").replace(/\/$/, "");
/** Local KoboldCpp (DRY/XTC/phrase bans that Ollama lacks); its model shows up as "kobold:<id>". */
export const KOBOLD_URL = (process.env.KOBOLD_URL || "http://127.0.0.1:5001").replace(/\/$/, "");
/** KoboldCpp binary + the one GGUF it serves; the studio starts it on demand and stops it with the heavy gate. */
export const KOBOLD_BIN = process.env.KOBOLD_BIN || `${process.env.HOME}/ClaudeCode/koboldcpp/koboldcpp-mac-arm64`;
export const KOBOLD_MODEL = process.env.KOBOLD_MODEL || `${process.env.HOME}/ClaudeCode/koboldcpp/models/Omega-Arsenal-26B-A4B-Final.i1-Q4_K_M_hb16.gguf`;
export const BRAIN_MODEL = process.env.BRAIN_MODEL || "gemma4-12b-heretic-vision:latest";
export const CAPTION_URL = (process.env.CAPTION_URL || "http://127.0.0.1:8191").replace(/\/$/, "");
export const TIPO_URL = (process.env.TIPO_URL || "http://127.0.0.1:8193").replace(/\/$/, "");
/** Optional Danbooru account (raises the 2-tag search limit). */
export const DANBOORU_LOGIN = process.env.DANBOORU_LOGIN || "";
export const DANBOORU_API_KEY = process.env.DANBOORU_API_KEY || "";

/** Comfy GPU tab: secrets are read here only; never log or return them. */
export const HYPERSTACK_API_KEY = process.env.HYPERSTACK_API_KEY || "";
export const HYPERSTACK_KEY_NAME = process.env.HYPERSTACK_KEY_NAME || "";
export const COMFY_TS_AUTHKEY = process.env.COMFY_TS_AUTHKEY || "";
export const HF_TOKEN = process.env.HF_TOKEN || "";
export const CIVITAI_TOKEN = process.env.CIVITAI_TOKEN || process.env.CIVITAIRED_KEY || "";
export const COMFY_DIR = path.join(DATA_DIR, "comfy");

/** Sprites studio: ffmpeg (launchd's PATH lacks Homebrew) and the cut WebP frame library. */
export const FFMPEG = process.env.FFMPEG || "/opt/homebrew/bin/ffmpeg";
export const SPRITE_LIB = path.join(DATA_DIR, "mascot", "library");
