const loadDrain = () => import("@/lib/comfy/jobs").then((m) => m.drainQueue);

// Node-only half of instrumentation.ts (kept separate so the Edge bundle never traces sharp/fs).
export async function registerNode() {
  const { getEngine } = await import("@/lib/comfy/engine");
  const e = getEngine();
  let running = false;
  // tick() does the boot reconcile (and retries it), so a hung listOurs can't block startup.
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await e.tick();
    } catch { /* next tick retries */ } finally {
      running = false;
    }
    // Not awaited: a wedged pod must not block the stop policy. drainQueue has its own re-entry guard.
    void loadDrain().then((drain) => drain()).catch(() => {});
  };
  void run();
  setInterval(run, 30_000);
}
