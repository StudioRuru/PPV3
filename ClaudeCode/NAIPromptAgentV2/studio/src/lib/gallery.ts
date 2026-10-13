import fs from "node:fs/promises";
import path from "node:path";
import { GALLERY_DIR } from "./env";

export function safeGalleryName(name: string): string | null {
  return /^[\w-]+\.png$/.test(name) ? name : null;
}

/** Atomic write (temp + rename) so a crash never leaves a half PNG. */
export async function saveImage(png: Buffer, seed: number): Promise<string> {
  await fs.mkdir(GALLERY_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const name = `${stamp}-${seed}.png`;
  const tmp = path.join(GALLERY_DIR, `.${name}.tmp`);
  await fs.writeFile(tmp, png);
  await fs.rename(tmp, path.join(GALLERY_DIR, name));
  return name;
}
