export type RefreshLock = { current: boolean };

export async function runRefreshTask<T>(params: {
  lock: RefreshLock;
  setRefreshing: (refreshing: boolean) => void;
  load: () => Promise<T>;
  apply: (data: T) => void;
  onError: (error: unknown) => void;
  retryOnError?: (error: unknown) => boolean;
  retryDelayMs?: number;
}) {
  if (params.lock.current) return false;
  params.lock.current = true;
  params.setRefreshing(true);
  try {
    let data: T;
    try {
      data = await params.load();
    } catch (error) {
      if (!params.retryOnError?.(error)) throw error;
      await new Promise((resolve) => globalThis.setTimeout(resolve, params.retryDelayMs ?? 500));
      data = await params.load();
    }
    params.apply(data);
    return true;
  } catch (error) {
    params.onError(error);
    return false;
  } finally {
    params.lock.current = false;
    params.setRefreshing(false);
  }
}
