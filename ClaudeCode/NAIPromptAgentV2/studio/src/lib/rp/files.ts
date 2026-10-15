import path from "node:path";

export type RpFileKind = "avatars" | "images";
const NAME = /^[\w-]+\.(png|jpe?g|webp)$/i;

/** Absolute path of an RP avatar/image, or null for anything that isn't a plain image name in a known folder. */
export function rpFile(rpDir: string, kind: string, name: string): string | null {
  if ((kind !== "avatars" && kind !== "images") || !NAME.test(name)) return null;
  return path.join(rpDir, kind, name);
}
