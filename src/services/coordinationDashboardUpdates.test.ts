import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "@firebase/firestore";
const mocks = vi.hoisted(() => ({ listeners: [] as Array<{ next: (s: unknown) => void; error: () => void; stop: ReturnType<typeof vi.fn>; q: unknown }> }));
vi.mock("@firebase/firestore", () => ({ collection: (_db: unknown, name: string) => name, where: (field: string, op: string, ids: string[]) => ({ field, op, ids }), query: (...args: unknown[]) => args,
  onSnapshot: (q: unknown, _options: unknown, next: (s: unknown) => void, error: () => void) => { const stop = vi.fn(); mocks.listeners.push({ q, next, error, stop }); return stop; } }));
import { subscribeCoordinationDashboardUpdates } from "./coordinationDashboardUpdates";
const snapshot = (fromCache = false, hasPendingWrites = false) => ({ metadata: { fromCache, hasPendingWrites }, docChanges: () => [{}] });
describe("Coordination financial invalidation", () => {
  beforeEach(() => { vi.useFakeTimers(); mocks.listeners.length = 0; });
  afterEach(() => vi.useRealTimers());
  it("coalesces confirmed changes and ignores unconfirmed local writes", async () => {
    const reload = vi.fn().mockResolvedValue(undefined), error = vi.fn();
    const stop = subscribeCoordinationDashboardUpdates({} as Firestore, ["school-a"], false, reload, error);
    mocks.listeners[0].next(snapshot(true)); mocks.listeners[1].next(snapshot(false, true));
    await vi.advanceTimersByTimeAsync(400); expect(reload).not.toHaveBeenCalled();
    mocks.listeners[2].next(snapshot()); mocks.listeners[0].next(snapshot());
    await vi.advanceTimersByTimeAsync(400); expect(reload).toHaveBeenCalledTimes(1); expect(error).not.toHaveBeenCalled(); stop();
    expect(mocks.listeners.every(l => l.stop.mock.calls.length === 1)).toBe(true);
    mocks.listeners[2].next(snapshot()); await vi.advanceTimersByTimeAsync(400); expect(reload).toHaveBeenCalledTimes(1);
  });
  it("keeps delegate queries at three authorized schools and exposes permission failures", () => {
    const error = vi.fn(); const stop = subscribeCoordinationDashboardUpdates({} as Firestore, ["a", "b", "c", "d"], true, vi.fn(), error);
    expect(mocks.listeners).toHaveLength(12);
    expect(mocks.listeners[0].q).toEqual(["students", { field: "schoolId", op: "in", ids: ["a", "b", "c"] }]);
    expect(mocks.listeners[6].q).toEqual(["students", { field: "schoolId", op: "in", ids: ["d"] }]);
    mocks.listeners[0].error(); expect(error).toHaveBeenCalledOnce(); stop();
  });
  it("does not lose a change arriving during a reload or retry errors forever", async () => {
    let finish!: () => void;
    const reload = vi.fn().mockImplementationOnce(() => new Promise<void>(r => { finish = r; })).mockRejectedValueOnce(Error("network"));
    const error = vi.fn(), stop = subscribeCoordinationDashboardUpdates({} as Firestore, ["a"], false, reload, error);
    mocks.listeners[2].next(snapshot()); await vi.advanceTimersByTimeAsync(300);
    mocks.listeners[2].next(snapshot()); finish(); await vi.advanceTimersByTimeAsync(1000);
    expect(reload).toHaveBeenCalledTimes(2); expect(error).toHaveBeenCalledOnce(); stop();
  });
});
