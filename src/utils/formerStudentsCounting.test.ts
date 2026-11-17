// Lot 27c-2 — chaque paiement d'un ancien élève compte du même montant dans le prévu ET dans l'encaissé, partout.
import { describe, expect, it } from "vitest";
import type { FeeType, Payment, School, SchoolYear, Student } from "../types";
import { buildDashboardFinancialAggregates, formerStudentPaymentsOfYear } from "./dashboardStats";
import { buildCoordinationDashboardStats } from "./coordinationDashboardStats";
import { buildAllocationTables, projectAllocations } from "./feeAllocationView";
import type { AllocationWorkspace } from "../services/feeAllocation";

const active = { id: "s1", schoolId: "a", schoolYearId: "y", className: "1ère", status: "ACTIVE", sexe: "F", nom: "A", postnom: "", prenom: "" } as unknown as Student;
const fee = { id: "f", schoolId: "a", schoolYearId: "y", name: "Minerval", amount: 100, className: "1ère" } as unknown as FeeType;
const pay = (id: string, extra: Partial<Payment>): Payment => ({ id, schoolId: "a", schoolYearId: "y", studentId: "s1", feeTypeId: "f", amount: 40, currency: "USD", paidAt: "2026-11-10", cashierName: "C", ...extra } as Payment);
const own = pay("p1", {});
// Dette d'une année passée réglée par un ancien élève (fiche archivée), encaissée cette année.
const former = pay("p2", { schoolYearId: "old", studentId: "old-1", feeTypeId: "old-fee", collectionSchoolYearId: "y", formerStudent: true, formerStudentId: "old-1", feeName: "Minerval", amount: 25 });

describe("lot 27c-2 — tableaux de bord Administrateur et Caissier", () => {
  it("prévu et encaissé augmentent du même montant ; le reste à payer ne change pas ; mention « dont anciens élèves »", () => {
    const before = buildDashboardFinancialAggregates([active], [fee], [own, former]);
    const formerList = formerStudentPaymentsOfYear([own, former], "y", new Set(["s1"]));
    const after = buildDashboardFinancialAggregates([active], [fee], [own, former], undefined, formerList);
    expect(formerList.map((p) => p.id)).toEqual(["p2"]);
    expect(after.financialStats.expected - before.financialStats.expected).toBe(25);
    expect(after.financialStats.paid - before.financialStats.paid).toBe(25);
    expect(after.financialStats.remaining).toBe(before.financialStats.remaining);
    expect(after.financialStats.formerPaid).toBe(25);
    expect(after.feeProgressRows.find((r) => r.name === "Minerval")).toMatchObject({ expected: 125, paid: 65 });
  });
  it("jamais compté deux fois : un paiement déjà rattaché à un élève actif n'est pas ajouté", () => {
    const twice = pay("p3", { formerStudent: true, formerStudentId: "s1" });
    expect(formerStudentPaymentsOfYear([twice], "y", new Set(["s1"]))).toEqual([]);
  });
});

describe("lot 27c-2 — Coordination et Sous-coordination", () => {
  it("même règle que l'école, avec la mention", () => {
    const schools = [{ id: "a", name: "A", currency: "USD", activeSchoolYearId: "y", status: "active" } as School];
    const schoolYears = [{ id: "y", schoolId: "a", name: "2026-2027", status: "active" } as SchoolYear, { id: "old", schoolId: "a", name: "2025-2026", status: "archived" } as SchoolYear];
    const stats = buildCoordinationDashboardStats(schools, { students: [active], feeTypes: [fee], payments: [own, former], expenses: [], personnel: [], schoolYears });
    const [group] = stats.financialGroups;
    expect(group).toMatchObject({ expected: 125, paid: 65, remaining: 60, formerPaid: 25 });
  });
});

describe("lot 27c-2 — Répartition des frais", () => {
  it("le prévu de la rubrique augmente de l'encaissement de l'ancien élève, dans son tableau et au tableau 3", () => {
    const rubric = "a".repeat(32);
    const movement = (id: string, amountMinor: number, formerStudent: boolean, socialCase = false) => ({ id, sourceType: "payment", type: "receipt", amountMinor, lines: [{ rubricId: rubric, amountMinor }],
      feeTypeId: "f", className: "1ère", classOptionKey: null, originSchoolYearId: formerStudent ? "old" : "y", postedAt: "2026-11-10", socialCase, formerStudent });
    const workspace = { school: { id: "a", name: "A", activeSchoolYearId: "y" }, year: { id: "y", schoolId: "a", name: "2026-2027", status: "active" }, currency: "USD",
      fees: [{ id: "f", name: "Minerval", className: "1ère", classOptionKey: null, amount: 100 }], configs: [{ id: "c", schoolId: "a", schoolYearId: "y", feeTypeId: "f", className: "1ère", currency: "USD", draftRevision: 1 }],
      forecast: { status: "complete", revision: null, calculatedAt: "", studentCount: 1, rows: [{ feeTypeId: "f", className: "1ère", classOptionKey: null, table: 1, rubricId: rubric, rubricName: "Fonctionnement", amountMinor: 10000, studentsCount: 1, rubricShare: 10000, tariffMinor: 10000, rubricMode: null, basisPoints: null }] },
      ledger: { status: "ACTIVE", cutoffAt: "2026-11-01", testOnly: true, rubrics: [{ id: rubric, name: "Fonctionnement" }],
        movements: [movement("m1", 4000, false), movement("m2", 2500, true), movement("m3", 1000, true, true)],
        balances: [{ rubricId: rubric, openingMinor: 0, receivedMinor: 7500, spentMinor: 0, reservedMinor: 0, availableMinor: 7500 }] } } as unknown as AllocationWorkspace;
    const tables = buildAllocationTables(projectAllocations([workspace], { kind: "fee", value: "", from: "", to: "" }));
    expect(tables.one[0]).toMatchObject({ amountMinor: 12500, financial: { receivedMinor: 6500, formerMinor: 2500 } });
    expect(tables.two[0]).toMatchObject({ amountMinor: 1000, financial: { receivedMinor: 1000, formerMinor: 1000 } });
    expect(tables.three[0]).toMatchObject({ amountMinor: 13500, financial: { receivedMinor: 7500, formerMinor: 3500 } });
  });
});
