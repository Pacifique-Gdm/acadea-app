import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./PersonnelPayrollHistory.tsx", import.meta.url), "utf8");
const coordination = readFileSync(new URL("../../modules/coordination/CoordinationControl.tsx", import.meta.url), "utf8");

describe("historique Salaire/Prime", () => {
  it("aligne les actions à droite sur une seule ligne pour Caissier et Administrateur", () => {
    expect(source).toContain("grid-cols-[minmax(0,1fr)_auto] items-center");
    expect(source).toContain("flex shrink-0 flex-nowrap items-center");
    expect(source.indexOf('title="Modifier le paiement du personnel"')).toBeLessThan(source.indexOf('title="Télécharger le bulletin PDF"'));
    expect(source).toContain("{allowEdit && <button");
  });
  it("préremplit les composantes et garde les avances déjà imputées en lecture seule", () => {
    for (const field of ["setCnss(String(payment.cnss", "setTax(String(payment.tax", "setDeduction(String(payment.deduction", "setPeriodMonth(payment.periodMonth", "setPaidAt(payment.paidAt"]) {
      expect(source).toContain(field);
    }
    expect(source).toContain("Les avances déjà imputées ne peuvent pas être modifiées");
    expect(source).toContain("MODIFIER CE SALAIRE");
    expect(source).toContain("MODIFIER CETTE PRIME");
  });
  it("renomme seulement Coordination et place l'export après Date fin", () => {
    expect(coordination).toContain('onClick={() => setHistoryKind("payroll")}>Salaire/Prime');
    expect(coordination.indexOf('aria-label="Date fin historique"')).toBeLessThan(coordination.indexOf('runPdfExport(historyKind === "payroll" ? exportPayrollHistory : exportHistory)'));
    expect(coordination).toContain("startDate={historyStart} endDate={historyEnd}");
  });
});
