import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ onSnapshot: vi.fn(), effects: [] as Array<() => (() => void) | undefined> }));
vi.mock("react", () => ({ useEffect: (effect: () => (() => void) | undefined) => mocks.effects.push(effect) }));
vi.mock("../firebase", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({ collection: (_db: unknown, name: string) => name, where: vi.fn(), query: vi.fn(), onSnapshot: mocks.onSnapshot }));
import { useRealtimeFinancialTransactions } from "./useRealtimeFinancialTransactions";
describe("confirmation des listeners financiers", () => {
  beforeEach(() => { mocks.effects.length = 0; mocks.onSnapshot.mockReset().mockImplementation(() => vi.fn()); });
  it("attend les deux sources de paiements et ne remplace jamais les chiffres par le cache", () => {
    const onPayments = vi.fn(), onExpenses = vi.fn(), onCashInflows = vi.fn(), onError = vi.fn();
    useRealtimeFinancialTransactions({ enabled: true, schoolId: "school-a", schoolYearId: "year-a", onPayments, onExpenses, onCashInflows, onError });
    const stop = mocks.effects[0]();
    const snapshot = (fromCache = false, hasPendingWrites = false) => ({ docs: [], metadata: { fromCache, hasPendingWrites } });
    for (const call of mocks.onSnapshot.mock.calls) {
      expect(call[1]).toEqual({ includeMetadataChanges: true });
      call[2](snapshot(true)); call[2](snapshot(false, true));
    }
    expect(onPayments).not.toHaveBeenCalled(); expect(onExpenses).not.toHaveBeenCalled(); expect(onCashInflows).not.toHaveBeenCalled();
    mocks.onSnapshot.mock.calls[0][2](snapshot());
    expect(onPayments).not.toHaveBeenCalled();
    mocks.onSnapshot.mock.calls[1][2](snapshot());
    expect(onPayments).toHaveBeenCalledExactlyOnceWith([]);
    mocks.onSnapshot.mock.calls[2][3](new Error("denied"));
    expect(onError).toHaveBeenCalledOnce();
    stop?.();
    mocks.onSnapshot.mock.results.forEach(result => expect(result.value).toHaveBeenCalledOnce());
  });
});
