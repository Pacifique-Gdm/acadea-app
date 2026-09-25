import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./MenuModule.tsx", import.meta.url), "utf8");

describe("Types de frais", () => {
  it("refuse explicitement les doublons normalisés et les doubles soumissions", () => {
    expect(source).toContain("feeTypeBusinessKey");
    expect(source).toContain("Ce type de frais existe déjà pour cette classe.");
    expect(source).toContain("if (feeSubmittingRef.current");
    expect(source).toContain("disabled={feeClassNames.length === 0 || feeSubmitting}");
  });

  it("ramène le formulaire d'édition dans la zone visible et place le focus", () => {
    expect(source).toContain('setShowNewFeeForm(false)');
    expect(source).toContain('feeEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })');
    expect(source).toContain('feeNameSelectRef.current?.focus({ preventScroll: true })');
    expect(source).toContain('setFeeName(fee.name)');
    expect(source).toContain('setFeeAmount(String(fee.amount))');
  });

  it("exige la confirmation exacte avant une création et attend la persistance", () => {
    expect(source).toContain('confirmation !== "AJOUTER CE FRAIS"');
    expect(source).toContain('feeAddConfirmation !== "AJOUTER CE FRAIS"');
    expect(source).toContain("await persistFirestorePatch({ feeTypes: feesToSave, auditLogs: [feeAuditLog] }, { throwOnError: true })");
    expect(source.indexOf("await persistFirestorePatch")).toBeLessThan(source.indexOf("updateData({", source.indexOf("await persistFirestorePatch")));
  });

  it("supprime le document canonique avant de retirer le frais de l'état local", () => {
    expect(source).toContain("await deleteFeeType(user, fee, feeAuditLog)");
    expect(source.indexOf("await deleteFeeType(user, fee, feeAuditLog)")).toBeLessThan(source.indexOf("feeTypes: data.feeTypes.filter"));
    expect(source).toContain("des paiements historiques y sont liés");
  });

  it("affiche la devise annuelle de l'école sans forcer le dollar", () => {
    expect(source).toContain("resolveSchoolYearCurrency(selectedYear, school)");
    expect(source).toContain("schoolCurrencySymbol({ currency: feeCurrency })");
    expect(source).toContain("formatCurrencyMoney(fee.amount, feeCurrency)");
    expect(source).not.toContain("<strong>${fee.amount}</strong>");
  });
});
