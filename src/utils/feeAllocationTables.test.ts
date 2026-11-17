import { describe, expect, it } from "vitest";
import { buildAllocationTables, projectAllocations, prorataShares } from "./feeAllocationView";
import { feeAllocationPdfSections } from "./feeAllocationPdf";
import type { AllocationWorkspace } from "../services/feeAllocation";

const salaries = "a".repeat(32), upkeep = "b".repeat(32);
function workspace(): AllocationWorkspace {
  const row = (fee: string, table: 1 | 2, rubricId: string, rubricName: string, amountMinor: number, basisPoints: number | null, rubricShare: number) =>
    ({ feeTypeId: fee, className: "1ère", classOptionKey: null, table, rubricId, rubricName, amountMinor, studentsCount: 1, rubricShare, tariffMinor: 10000, rubricMode: basisPoints ? "percent" as const : null, basisPoints });
  const movement = (id: string, sourceType: "opening" | "payment" | "expense", lines: [string, number][], socialCase = false) => ({
    id, sourceType, type: sourceType, amountMinor: lines.reduce((n, [, a]) => n + a, 0), lines: lines.map(([rubricId, amountMinor]) => ({ rubricId, amountMinor })),
    feeTypeId: sourceType === "payment" ? "minerval" : null, className: "1ère", classOptionKey: null, originSchoolYearId: "year", postedAt: "2026-11-13", socialCase });
  return {
    school: { id: "school", name: "École fictive", activeSchoolYearId: "year" }, year: { id: "year", schoolId: "school", name: "2027-2028", status: "active", startsAt: null, endsAt: null },
    currency: "USD", canConfigure: false, operational: false,
    fees: [{ id: "minerval", name: "Minerval", className: "1ère", classOptionKey: null, amount: 100 }, { id: "transport", name: "Transport", className: "1ère", classOptionKey: null, amount: 100 }],
    configs: [{ id: "c", schoolId: "school", schoolYearId: "year", feeTypeId: "minerval", className: "1ère", currency: "USD", draftRevision: 1 }],
    forecast: { status: "complete", revision: null, calculatedAt: "", studentCount: 3, rows: [
      row("minerval", 1, salaries, "Salaires", 60000, 6000, 6000), row("minerval", 2, salaries, "Salaires", 6667, 6000, 6000),
      row("transport", 1, salaries, "Salaires", 4000, 4000, 4000), row("minerval", 1, upkeep, "Entretien", 0, 1000, 1000) ] },
    ledger: { status: "ACTIVE", cutoffAt: "2026-11-01", testOnly: true, rubrics: [{ id: salaries, name: "Salaires" }, { id: upkeep, name: "Entretien" }],
      movements: [movement("p1", "payment", [[salaries, 42000]]), movement("p2", "payment", [[salaries, 3333]], true), movement("e1", "expense", [[salaries, -30000]])],
      balances: [{ rubricId: salaries, openingMinor: 0, receivedMinor: 45333, spentMinor: 30000, reservedMinor: 0, availableMinor: 15333 },
        { rubricId: upkeep, openingMinor: 0, receivedMinor: 0, spentMinor: 0, reservedMinor: 0, availableMinor: 0 }] },
  } as unknown as AllocationWorkspace;
}

describe("lot 27c-1 : trois tableaux sur le même modèle", () => {
  it("les dépenses se partagent au prorata des encaissements ; le tableau 3 retombe exactement sur le total", () => {
    expect(prorataShares(30000, 42000, 3333)).toEqual([27795, 2205]);
    expect(prorataShares(30000, 42000, 0)).toEqual([30000, 0]);
    expect(prorataShares(30000, 0, 3333)).toEqual([0, 30000]);
    const tables = buildAllocationTables(projectAllocations([workspace()], { kind: "fee", value: "", from: "", to: "" }));
    const [t1] = tables.one, [t2] = tables.two, [t3] = tables.three;
    expect(t1.financial).toMatchObject({ receivedMinor: 42000, spentMinor: 27795, availableMinor: 14205 });
    expect(t2.financial).toMatchObject({ receivedMinor: 3333, spentMinor: 2205, availableMinor: 1128 });
    expect(t3.financial).toMatchObject({ receivedMinor: 45333, spentMinor: 30000, availableMinor: 15333 });
    expect(t3.amountMinor).toBe(60000 + 6667 + 4000);
  });
  it("une rubrique sans aucun montant n'apparaît pas", () => {
    const tables = buildAllocationTables(projectAllocations([workspace()], { kind: "fee", value: "", from: "", to: "" }));
    expect([...tables.one, ...tables.two, ...tables.three].map((row) => row.rubricName)).not.toContain("Entretien");
  });
  it("pourcentage après le nom ; pourcentages différents : « 60 % et 40 % » avec le détail par frais", () => {
    const rows = projectAllocations([workspace()], { kind: "fee", value: "", from: "", to: "" });
    const salary = rows.find((row) => row.rubricName === "Salaires")!;
    expect(salary.percentLabel).toBe("60 % et 40 %");
    expect(salary.percentDetail).toBe("Minerval 60 % · Transport 40 %");
    const single = projectAllocations([workspace()], { kind: "fee", value: JSON.stringify(["school", "minerval"]), from: "", to: "" }).find((row) => row.rubricName === "Salaires")!;
    expect(single.percentLabel).toBe("60 %");
    expect(single.percentDetail).toBeUndefined();
  });
  it("PDF : les trois tableaux, textes justifiés, l'année une seule fois (en-tête)", () => {
    const html = feeAllocationPdfSections(projectAllocations([workspace()], { kind: "fee", value: "", from: "", to: "" }), "Tous les frais", "École fictive · 2027-2028 · USD").join("");
    for (const title of ["Tableau 1 — Élèves normalement inscrits", "Tableau 2 — Cas sociaux et prises en charge", "Tableau 3 — Ensemble"]) expect(html).toContain(title);
    expect(html).toContain("text-align: justify");
    expect(html.split("2027-2028").length - 1).toBe(1);
    expect(html).toContain("Salaires (60 % et 40 %)");
  });
});
