import sharp from "sharp";

const MAX_BYTES = 20 * 1024 * 1024;

/** base64 (or data URL) → PNG at most 1536 px on the long side. Throws a user-facing message. */
export async function decode(b64: unknown): Promise<Buffer> {
  if (typeof b64 !== "string") throw new Error("Images must be base64 text.");
  const s = b64.replace(/^data:[^,]*,/, "");
  if (s.length > Math.ceil(MAX_BYTES / 3) * 4 + 4) throw new Error("That image is too large (20 MB max).");
  const buf = Buffer.from(s, "base64");
  if (!buf.length || buf.length > MAX_BYTES) throw new Error(buf.length ? "That image is too large (20 MB max)." : "The image is empty.");
  try {
    return await sharp(buf).rotate().resize({ width: 1536, height: 1536, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  } catch {
    throw new Error("That file isn't an image.");
  }
}
