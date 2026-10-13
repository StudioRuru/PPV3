/**
 * Errors thrown before the request left this machine — the only ones safe to retry
 * without risking a double NovelAI charge. Socket resets ("other side closed",
 * ECONNRESET) can happen after NovelAI accepted the job, so they are NOT retried.
 */
const PRE_SEND = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"]);

export function isPreSendError(err: unknown): boolean {
  return PRE_SEND.has((err as { cause?: { code?: string } })?.cause?.code ?? "");
}

export type JsonResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** fetch + JSON that never throws: network drops and non-JSON bodies become readable errors. */
export async function requestJson<T = Record<string, unknown>>(url: string, init?: RequestInit): Promise<JsonResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return { ok: false, error: "Network error — check the connection and tap again to retry." };
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) return { ok: false, error: data?.error ?? `Server error ${res.status}.` };
  return { ok: true, data: data as T };
}
