import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "@firebase/firestore";

type Filter = { field: string; op: string; value: unknown };
const mocks = vi.hoisted(() => ({
  listeners: [] as Array<{ q: unknown[]; next: (s: unknown) => void }>,
  reads: [] as Array<{ name: string; filters: Filter[] }>,
  rows: new Map<string, Array<Record<string, unknown>>>(),
}));
vi.mock("../firebase", () => ({ db: {} }));
vi.mock("@firebase/firestore", () => ({
  collection: (_db: unknown, name: string) => ({ name }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  limit: (count: number) => ({ limit: count }),
  startAfter: (cursor: unknown) => ({ startAfter: cursor }),
  query: (...args: unknown[]) => args,
  onSnapshot: (q: unknown[], _options: unknown, next: (s: unknown) => void) => { mocks.listeners.push({ q, next }); return vi.fn(); },
  getDocs: async (q: unknown[]) => {
    const name = (q[0] as { name: string }).name;
    const filters = q.slice(1).filter((part): part is Filter => typeof part === "object" && part !== null && "field" in part);
    mocks.reads.push({ name, filters });
    const docs = (mocks.rows.get(name) ?? []).filter((row) => filters.every((filter) => filter.op === "in" ? (filter.value as unknown[]).includes(row[filter.field]) : row[filter.field] === filter.value));
    return { docs: docs.map((row) => ({ id: String(row.id), data: () => row })) };
  },
}));

import { subscribeCoordinationDashboardUpdates } from "./coordinationDashboardUpdates";
import { loadCoordinationDashboardReadModel } from "./coordinationReadModel";

const filtersOf = (q: unknown[]) => q.slice(1) as Filter[];
const activeYears = { "school-a": "year-a26", "school-b": "year-b26", "school-c": "" };

describe("coordination limitée à l'année active", () => {
  beforeEach(() => { vi.useFakeTimers(); mocks.listeners.length = 0; mocks.reads.length = 0; mocks.rows.clear(); });
  afterEach(() => vi.useRealTimers());

  it("n'écoute que l'année active de chaque école, plus les arriérés encaissés cette année", () => {
    subscribeCoordinationDashboardUpdates({} as Firestore, Object.keys(activeYears), false, vi.fn().mockResolvedValue(undefined), vi.fn(), activeYears);
    const heavy = mocks.listeners.filter(({ q }) => (q[0] as { name: string }).name !== "schoolYears");
    expect(heavy).toHaveLength(12); // 2 écoles avec année active × (5 collections + arriérés encaissés)
    for (const { q } of heavy) {
      const fields = filtersOf(q).map((filter) => `${filter.field}${filter.op}`);
      expect(fields).toContain("schoolId==");
      expect(fields.some((field) => field === "schoolYearId==" || field === "collectionSchoolYearId==")).toBe(true);
      expect(filtersOf(q).every((filter) => filter.op === "==")).toBe(true);
    }
    expect(heavy.some(({ q }) => filtersOf(q).some((filter) => filter.value === "school-c"))).toBe(false);
  });

  it("une modification confirmée dans l'année active recharge le tableau, une écriture locale non", async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    subscribeCoordinationDashboardUpdates({} as Firestore, ["school-a"], false, reload, vi.fn(), { "school-a": "year-a26" });
    mocks.listeners[1].next({ metadata: { fromCache: false, hasPendingWrites: true }, docChanges: () => [{}] });
    await vi.advanceTimersByTimeAsync(400);
    expect(reload).not.toHaveBeenCalled();
    mocks.listeners[1].next({ metadata: { fromCache: false, hasPendingWrites: false }, docChanges: () => [{}] });
    await vi.advanceTimersByTimeAsync(400);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("charge seulement l'année active, garde les arriérés encaissés et ne double aucun paiement", async () => {
    mocks.rows.set("students", [{ id: "s-now", schoolId: "school-a", schoolYearId: "year-a26" }, { id: "s-old", schoolId: "school-a", schoolYearId: "year-a25", photoUrl: "data:image/jpeg;base64,AAAA" }]);
    mocks.rows.set("payments", [
      { id: "p-now", schoolId: "school-a", schoolYearId: "year-a26" },
      { id: "p-arrears", schoolId: "school-a", schoolYearId: "year-a25", collectionSchoolYearId: "year-a26" },
      { id: "p-old", schoolId: "school-a", schoolYearId: "year-a25" },
      { id: "p-both", schoolId: "school-a", schoolYearId: "year-a26", collectionSchoolYearId: "year-a26" },
    ]);
    const model = await loadCoordinationDashboardReadModel(["school-a", "school-c"], false, activeYears);
    expect(model.students.map((row) => row.id)).toEqual(["s-now"]);
    expect(model.payments.map((row) => row.id).sort()).toEqual(["p-arrears", "p-both", "p-now"]);
    const heavyReads = mocks.reads.filter((read) => !["users", "schoolYears"].includes(read.name));
    expect(heavyReads.every((read) => read.filters.some((filter) => filter.field === "schoolYearId" || filter.field === "collectionSchoolYearId"))).toBe(true);
    expect(heavyReads.some((read) => read.filters.some((filter) => filter.value === "school-c"))).toBe(false);
  });

  it("sans années actives fournies, garde exactement l'ancien chargement", async () => {
    await loadCoordinationDashboardReadModel(["school-a"], false);
    expect(mocks.reads.find((read) => read.name === "students")?.filters).toEqual([{ field: "schoolId", op: "in", value: ["school-a"] }]);
  });
});
