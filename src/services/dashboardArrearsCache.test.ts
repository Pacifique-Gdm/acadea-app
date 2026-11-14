import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./financialTransactions", () => ({ loadStudentArrearsBatch: vi.fn(() => { throw new Error("appel réel interdit dans ce test"); }) }));
vi.mock("./coordinationService", () => ({ loadCoordinationStudentArrearsBatch: vi.fn(() => { throw new Error("appel réel interdit dans ce test"); }) }));

import { clearDashboardArrearsCache, readCachedArrears, refreshStaleArrears, type ArrearsLoader, type ArrearsPayment, type ArrearsStudent } from "./dashboardArrearsCache";

const students: ArrearsStudent[] = Array.from({ length: 199 }, (_, index) => ({ id: `s${String(index).padStart(3, "0")}`, schoolId: "school-a", schoolYearId: "year-a" }));
const payments: ArrearsPayment[] = [{ id: "p1", amount: 10, studentId: "s001", schoolYearId: "year-a" }];

function fakeLoader(values: (id: string) => { USD: number; CDF: number } = () => ({ USD: 1, CDF: 100 })) {
  return vi.fn<ArrearsLoader>(async (_year, ids) => Object.fromEntries(ids.map((id) => [id, values(id)])));
}

/** Simule un passage complet du tableau de bord : lecture de la mémoire, puis
 * recalcul des seuls élèves périmés, comme le fait useDashboardArrears. */
async function visitDashboard(loader: ArrearsLoader, list = students, ledger = payments, scope = "user-a") {
  const first = readCachedArrears(list, ledger, scope, false);
  if (first.stale.length) await refreshStaleArrears(first.stale, first.prints, scope, false, { loader });
  return { shownImmediately: first.totals, final: readCachedArrears(list, ledger, scope, false).totals };
}

describe("arriérés du tableau de bord gardés entre deux visites", () => {
  beforeEach(() => clearDashboardArrearsCache());

  it("aller-retour sur le Dashboard sans changement : aucun nouvel appel serveur ni recalcul", async () => {
    const loader = fakeLoader();
    const firstVisit = await visitDashboard(loader);
    expect(firstVisit.shownImmediately).toBeUndefined();
    expect(loader).toHaveBeenCalledTimes(4); // 199 élèves par paquets de 50
    expect(firstVisit.final).toEqual({ USD: 199, CDF: 19_900 });

    const secondVisit = await visitDashboard(loader);
    expect(secondVisit.shownImmediately).toEqual({ USD: 199, CDF: 19_900 });
    expect(loader).toHaveBeenCalledTimes(4);
  });

  it("un nouveau paiement d'un autre utilisateur ne fait recalculer que l'élève concerné", async () => {
    const loader = fakeLoader();
    await visitDashboard(loader);
    loader.mockClear();
    const ledger = [...payments, { id: "p2", amount: 5, studentId: "s150", schoolYearId: "year-a" }];
    const visit = await visitDashboard(loader, students, ledger);
    expect(visit.shownImmediately).toBeUndefined(); // jamais d'ancien montant affiché
    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader.mock.calls[0][1]).toEqual(["s150"]);
  });

  it("une correction de montant invalide l'élève concerné", async () => {
    const loader = fakeLoader();
    await visitDashboard(loader);
    loader.mockClear();
    await visitDashboard(loader, students, [{ ...payments[0], amount: 12 }]);
    expect(loader.mock.calls.map((call) => call[1])).toEqual([["s001"]]);
  });

  it("par prudence, un paiement non rattachable à un élève affiché invalide tout", async () => {
    const loader = fakeLoader();
    await visitDashboard(loader);
    loader.mockClear();
    await visitDashboard(loader, students, [...payments, { id: "p3", amount: 7, studentId: "ancien-dossier", schoolYearId: "year-a" }]);
    expect(loader).toHaveBeenCalledTimes(4);
  });

  it("garde les paquets réussis quand un paquet échoue, puis ne redemande que le reste", async () => {
    let calls = 0;
    const flaky = vi.fn<ArrearsLoader>(async (_year, ids) => {
      calls += 1;
      if (calls === 3) throw new TypeError("Failed to fetch");
      return Object.fromEntries(ids.map((id) => [id, { USD: 1, CDF: 0 }]));
    });
    const first = readCachedArrears(students, payments, "user-a", false);
    await expect(refreshStaleArrears(first.stale, first.prints, "user-a", false, { loader: flaky })).rejects.toThrow("Failed to fetch");
    const second = readCachedArrears(students, payments, "user-a", false);
    expect(second.totals).toBeUndefined();
    expect(second.stale).toHaveLength(99);
  });

  it("isole les résultats par compte et par mode coordination", async () => {
    const loader = fakeLoader();
    await visitDashboard(loader);
    expect(readCachedArrears(students, payments, "user-b", false).stale).toHaveLength(199);
    expect(readCachedArrears(students, payments, "user-a", true).stale).toHaveLength(199);
  });

  it("additionne au centime près", async () => {
    const loader = fakeLoader((id) => (id === "s000" ? { USD: 0.1, CDF: 0 } : id === "s001" ? { USD: 0.2, CDF: 0 } : { USD: 0, CDF: 0 }));
    const visit = await visitDashboard(loader);
    expect(visit.final?.USD).toBe(0.3);
  });

  it("une fiche financière modifiée (prise en charge) invalide l'élève", async () => {
    const loader = fakeLoader();
    await visitDashboard(loader);
    loader.mockClear();
    const changed = students.map((student) => (student.id === "s010" ? { ...student, financialSupport: { d: { id: "d", schoolYearId: "year-a", thirdPartyName: "Tiers", lines: {} } } } : student));
    await visitDashboard(loader, changed);
    expect(loader.mock.calls.map((call) => call[1])).toEqual([["s010"]]);
  });
});
