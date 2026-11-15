import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./financialTransactions", () => ({ loadStudentArrearsBatch: vi.fn() }));
vi.mock("./coordinationService", () => ({ loadCoordinationStudentArrearsBatch: vi.fn() }));

import { clearDashboardArrearsCache, readCachedArrears, refreshStaleArrears, type ArrearsLoader, type ArrearsStudent } from "./dashboardArrearsCache";

const students = (count: number): ArrearsStudent[] => Array.from({ length: count }, (_, index) => ({ id: `s${index}`, schoolId: `school-${index % 3}`, schoolYearId: `year-${index % 3}` }));

/** Chargeur factice qui mesure le nombre d'appels simultanés. */
function trackingLoader(delayMs = 5) {
  const state = { active: 0, max: 0, calls: 0 };
  const loader = vi.fn<ArrearsLoader>(async (_year, ids) => {
    state.calls += 1; state.active += 1; state.max = Math.max(state.max, state.active);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    state.active -= 1;
    return Object.fromEntries(ids.map((id) => [id, { USD: 1, CDF: 0 }]));
  });
  return { loader, state };
}

describe("coordination : arriérés calculés 4 paquets à la fois", () => {
  beforeEach(() => clearDashboardArrearsCache());

  it("lance jusqu'à 4 paquets en parallèle et garde tous les résultats", async () => {
    const list = students(1100); // 22 paquets de 50, comme sur l'école de test
    const { loader, state } = trackingLoader();
    const first = readCachedArrears(list, [], "coord", true);
    await refreshStaleArrears(first.stale, first.prints, "coord", true, { loader });
    expect(state.calls).toBe(22);
    expect(state.max).toBe(4);
    expect(readCachedArrears(list, [], "coord", true).totals).toEqual({ USD: 1100, CDF: 0 });
  });

  it("reste un par un pour une école (comportement inchangé)", async () => {
    const list = students(199).map((student) => ({ ...student, schoolId: "school-a", schoolYearId: "year-a" }));
    const { loader, state } = trackingLoader();
    const first = readCachedArrears(list, [], "admin", false);
    await refreshStaleArrears(first.stale, first.prints, "admin", false, { loader });
    expect(state.max).toBe(1);
  });

  it("ne dépasse jamais 60 appels par minute glissante", async () => {
    let now = 0;
    const starts: number[] = [];
    const loader = vi.fn<ArrearsLoader>(async (_year, ids) => { starts.push(now); return Object.fromEntries(ids.map((id) => [id, { USD: 0, CDF: 0 }])); });
    const sleep = vi.fn(async (ms: number) => { now += ms; });
    const list = students(70 * 50); // 70 paquets
    const first = readCachedArrears(list, [], "coord", true);
    await refreshStaleArrears(first.stale, first.prints, "coord", true, { loader, now: () => now, sleep });
    expect(starts).toHaveLength(70);
    for (const start of starts) expect(starts.filter((other) => other > start - 60_000 && other <= start).length).toBeLessThanOrEqual(60);
    expect(sleep).toHaveBeenCalled();
  });

  it("s'arrête proprement si l'écran est quitté", async () => {
    let cancelled = false;
    const { loader, state } = trackingLoader();
    loader.mockImplementationOnce(async (_year, ids) => { cancelled = true; return Object.fromEntries(ids.map((id) => [id, { USD: 1, CDF: 0 }])); });
    const first = readCachedArrears(students(1100), [], "coord", true);
    await refreshStaleArrears(first.stale, first.prints, "coord", true, { loader, isCancelled: () => cancelled });
    expect(state.calls).toBeLessThan(22);
  });
});
