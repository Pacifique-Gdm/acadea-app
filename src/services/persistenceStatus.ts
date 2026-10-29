type PersistenceStatus = { pending: number; failed: boolean; completed: boolean };
let status: PersistenceStatus = { pending: 0, failed: false, completed: false };
const listeners = new Set<() => void>();
function publish(next: PersistenceStatus) { status = next; listeners.forEach((listener) => listener()); }
export const persistenceStatus = {
  getSnapshot: () => status,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
};
/** One completion cannot hide another pending write or a failure in the same batch. */
export async function trackPersistence(action: () => Promise<unknown>): Promise<boolean> {
  publish({ pending: status.pending + 1, failed: status.pending ? status.failed : false, completed: false });
  let succeeded = false;
  try { if (await action() === false) throw new Error("Persistence unavailable"); succeeded = true; }
  catch { publish({ ...status, failed: true }); }
  finally { publish({ ...status, pending: status.pending - 1, completed: true }); }
  return succeeded;
}
