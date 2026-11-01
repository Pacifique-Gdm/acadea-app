/** One scope, one in-flight request. Disposed scopes can never publish results. */
export function createScopedAsyncLoader<T>(
  load: () => Promise<T>,
  publish: (state: { value?: T; loading: boolean; error: string }) => void,
) {
  let disposed = false;
  let running = false;
  let queued = false;
  return {
    async reload() {
      if (disposed) return;
      if (running) { queued = true; return; }
      running = true;
      do {
        queued = false;
        publish({ loading: true, error: "" });
        try {
          const value = await load();
          if (!disposed) publish({ value, loading: false, error: "" });
        } catch (cause) {
          if (!disposed) publish({ loading: false, error: cause instanceof Error ? cause.message : "Chargement indisponible." });
        }
      } while (queued && !disposed);
      running = false;
    },
    dispose() { disposed = true; queued = false; },
  };
}
