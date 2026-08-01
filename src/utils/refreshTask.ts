export type RefreshLock = { current: boolean };

export async function runRefreshTask<T>(params: {
  lock: RefreshLock;
  setRefreshing: (refreshing: boolean) => void;
  load: () => Promise<T>;
  apply: (data: T) => void;
  onError: (error: unknown) => void;
}) {
  if (params.lock.current) return false;
  params.lock.current = true;
  params.setRefreshing(true);
  try {
    const data = await params.load();
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
