import { describe, expect, it, vi } from "vitest";
import { useRealtimeSchoolRecords } from "./useRealtimeSchoolRecords";
const harness = vi.hoisted(() => ({ cleanup: undefined as (() => void) | undefined, listeners: [] as Array<{ query: unknown; next: (snapshot: unknown) => void; error: (error: Error) => void }>, unsubscribe: vi.fn() }));
vi.mock("react", () => ({ useEffect: (effect: () => (() => void) | undefined) => { harness.cleanup = effect(); } }));
vi.mock("../firebase", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, name: string) => name,
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  query: (...args: unknown[]) => args,
  onSnapshot: (query: unknown, next: (snapshot: unknown) => void, error: (error: Error) => void) => { harness.listeners.push({ query, next, error }); return harness.unsubscribe; },
}));
describe("changement d'année — callbacks historiques tardifs", () => {
  it("recrée les requêtes sur chaque année sélectionnée et ignore tous les anciens snapshots", () => {
    harness.listeners = []; harness.unsubscribe.mockClear();
    const onData = vi.fn();
    function SubscriptionHarness({ schoolYearId }: { schoolYearId: string }) {
      useRealtimeSchoolRecords({ user: { id: "admin", role: "school_admin", schoolId: "s", name: "Test", email: "test@example.invalid" }, schoolId: "s", schoolYearId, onData });
      return null;
    }
    for (const schoolYearId of ["active", "archived", "active", "older-archive"]) {
      const previous = [...harness.listeners];
      SubscriptionHarness({ schoolYearId });
      const studentListener = harness.listeners[previous.length];
      expect(studentListener.query).toEqual(["students", { field: "schoolId", op: "==", value: "s" }, { field: "schoolYearId", op: "==", value: schoolYearId }]);
      onData.mockClear();
      for (const listener of previous) listener.next({ docs: [] });
      expect(onData).not.toHaveBeenCalled();
      studentListener.next({ docs: [{ id: schoolYearId, data: () => ({ schoolId: "s", schoolYearId }) }] });
      expect(onData).toHaveBeenCalledWith(expect.objectContaining({ students: [{ id: schoolYearId, schoolId: "s", schoolYearId }] }));
      harness.cleanup?.();
    }
    expect(harness.unsubscribe).toHaveBeenCalledTimes(12);
  });
  it("ne remplace pas les données de la nouvelle année après nettoyage des anciens listeners", () => {
    harness.listeners = []; harness.unsubscribe.mockClear();
    const onData = vi.fn(), onError = vi.fn();
    useRealtimeSchoolRecords({ user: { id: "admin", role: "school_admin", schoolId: "s", name: "Test", email: "test@example.invalid" }, schoolId: "s", schoolYearId: "old", onData, onError });
    harness.listeners[0].next({ docs: [{ id: "old-student", data: () => ({ schoolId: "s", schoolYearId: "old" }) }] });
    expect(onData).toHaveBeenCalledOnce();
    harness.cleanup?.();
    onData.mockClear();
    for (const listener of harness.listeners) { listener.next({ docs: [] }); listener.error(new Error("ancienne écoute")); }
    expect(harness.unsubscribe).toHaveBeenCalledTimes(3);
    expect(onData).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
