/** Task 7 wires the queue here: () => import("@/lib/comfy/queue").then((m) => m.drainQueue) */
const loadDrain = async (): Promise<(() => Promise<void>) | undefined> => undefined;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getEngine } = await import("@/lib/comfy/engine");
  const e = getEngine();
  let running = false;
  // tick() does the boot reconcile (and retries it), so a hung listOurs can't block startup.
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await e.tick();
      await (await loadDrain())?.();
    } catch { /* next tick retries */ } finally {
      running = false;
    }
  };
  void run();
  setInterval(run, 30_000);
}
