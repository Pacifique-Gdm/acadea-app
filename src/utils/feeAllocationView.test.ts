import { describe, expect, it } from "vitest";
import type { AllocationWorkspace } from "../services/feeAllocation";
import { allocationClassKey, allocationFeeKey, allocationPeriod, allocationTotals, projectAllocations, type AllocationFilter } from "./feeAllocationView";
import { feeAllocationPdfSections } from "./feeAllocationPdf";
import { allocationFilterChoices } from './feeAllocationView';
const filter: AllocationFilter = { kind: "fee", value: "", from: "", to: "" };
const workspace = (schoolId = "s", currency: "USD" | "CDF" = "USD"): AllocationWorkspace => ({ school: { id: schoolId, name: `École ${schoolId}`, activeSchoolYearId: "y" }, year: { id: "y", schoolId, name: "2026", status: "active", startsAt: null, endsAt: null }, currency, canConfigure: true, operational: false,
  fees: [100, 200].map((amount, i) => ({ id: `f${i}`, name: "Minerval", className: `${i + 1}ère`, classOptionKey: `${i + 1}ère::option::A`, amount })),
  configs: [10000, 20000].map((feeAmountMinor, i) => ({ id: `${schoolId}-config-${i}`, schoolId, schoolYearId: "y", feeTypeId: `f${i}`, className: `${i + 1}ère`, classOptionKey: `${i + 1}ère::option::A`, currency, draftRevision: 1,
    draft: { feeAmountMinor, updatedAt: "2026-11-13T08:00:00Z", updatedBy: "a", rubrics: [{ id: "a".repeat(32), name: "Fonctionnement", mode: "percent", basisPoints: 2000 }, { id: "b".repeat(32), name: "Salaire", mode: "fixed", fixedMinor: 3000 }, { id: "c".repeat(32), name: "Prime", mode: "percent", basisPoints: 2500 }] } })),
});
describe("projection et PDF préparatoires identiques", () => {
  it('simplifie une école sans fusionner deux identifiants au libellé identique', () => {
    const w = workspace(); w.fees.push({ ...w.fees[0], id: 'other-id' });
    const choices = allocationFilterChoices([w], 'fee');
    expect(choices).toHaveLength(3);
    expect(choices[0][1]).toBe('Minerval — 1ère — A');
    expect(choices[0][1]).toBe(choices[2][1]);
    expect(choices[0][0]).not.toBe(choices[2][0]);
    expect(allocationFilterChoices([w], 'class')).toHaveLength(2);
    const multiple = allocationFilterChoices([w, workspace('b')], 'fee');
    expect(multiple[0][1]).toContain('École s · ');
    expect(multiple.at(-1)?.[1]).toContain('École b · ');
    expect(allocationFilterChoices([workspace('b')], 'fee')[0][1]).not.toContain('École');
  });
  it("conserve les montants 100/200, les identités et Non affecté sans fusion par nom", () => {
    const rows = projectAllocations([workspace()], filter); expect(rows).toHaveLength(8); expect(new Set(rows.map((r) => r.key)).size).toBe(8);
    expect(rows.filter((r) => r.rubricName === "Non affecté").map((r) => r.amountMinor)).toEqual([2500, 8000]);
    expect(allocationTotals(rows)).toEqual([{ currency: "USD", amountMinor: 30000 }]);
  });
  it("sépare les devises et les écoles de même nom de frais", () => {
    const rows = projectAllocations([workspace(), workspace("b", "CDF")], filter);
    expect(allocationTotals(rows)).toEqual([{ currency: "USD", amountMinor: 30000 }, { currency: "CDF", amountMinor: 30000 }]);
    expect(projectAllocations([workspace(), workspace("b", "CDF")], { ...filter, value: allocationFeeKey("b", "f1") })).toHaveLength(4);
  });
  it("filtre exactement frais, classe-option et période de préparation", () => {
    const data = [workspace()];
    expect(projectAllocations(data, { ...filter, value: allocationFeeKey("s", "f0") })).toHaveLength(4);
    expect(projectAllocations(data, { ...filter, kind: "class", value: allocationClassKey("s", "2ère::option::A") })).toHaveLength(4);
    expect(projectAllocations(data, { ...filter, kind: "period", value: "today" }, new Date(2026, 10, 14))).toEqual([]);
    expect(projectAllocations(data, { ...filter, kind: "period", value: "week" }, new Date(2026, 10, 14))).toHaveLength(8);
    expect(() => allocationPeriod("custom", "2026-02-30", "2026-03-01")).toThrow();
  });
  it("signale les brouillons dont le tarif a changé, sans réécrire l'historique", () => {
    const data = workspace(); data.fees[0].amount = 99;
    const rows = projectAllocations([data], filter); expect(rows.filter((r) => r.stale)).toHaveLength(4); expect(rows[0].config.draft?.feeAmountMinor).toBe(10000);
  });
  it("exporte seulement la vue choisie avec les vrais indisponibles, sans faux solde", () => {
    const rows = projectAllocations([workspace()], { ...filter, value: allocationFeeKey("s", "f0") });
    const html = feeAllocationPdfSections(rows, "Frais : Minerval", "École s · 2026 · USD").join("");
    expect(html).toContain("Non affecté"); expect(html).toContain("Préparatoire"); expect(html).toContain("Non disponible"); expect(html).toContain("1ère"); expect(html).not.toContain("2ère");
    expect(html).toContain("sans multiplication par les effectifs");
  });
});
