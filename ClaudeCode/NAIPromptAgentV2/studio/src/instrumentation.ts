/** Task 7 wires the queue here: () => import("@/lib/comfy/queue").then((m) => m.drainQueue) */
const loadDrain = async (): Promise<(() => Promise<void>) | undefined> => undefined;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getEngine } = await import("@/lib/comfy/engine");
  const e = getEngine();
  await e.reconcile().catch(() => {}); // errors may carry API text; swallow, tick will retry stops
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await e.tick();
      await (await loadDrain())?.();
    } catch { /* next tick retries */ } finally {
      running = false;
    }
  }, 30_000);
}
