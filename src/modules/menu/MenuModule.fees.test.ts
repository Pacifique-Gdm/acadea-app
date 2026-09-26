import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./MenuModule.tsx", import.meta.url), "utf8");

describe("Types de frais", () => {
  it("réutilise la saisie monétaire formatée sans changer le stockage numérique", () => {
    expect(source).toContain("<MoneyInput value={feeAmount} onChange={setFeeAmount}");
    expect(source).toContain("const amount = Number(feeAmount)");
    expect(source).not.toContain('value={feeAmount} onChange={(event) => setFeeAmount(event.target.value)} type="number"');
  });
  it("garde le formulaire vertical et les actions d'édition équilibrées", () => {
    const editor = source.slice(source.indexOf('<div ref={feeEditorRef}'), source.indexOf('{showNewFeeForm &&', source.indexOf('<div ref={feeEditorRef}')));
    expect(editor).not.toContain("sm:grid-cols");
    expect(editor).toContain("grid-cols-2 gap-2");
    expect(editor).toContain("Annuler</button>");
    expect(source).not.toContain("Annuler la modification");
  });
  it("protège aussi la modification par une confirmation exacte et réinitialisée", () => {
    expect(source).toContain('editingFeeId && confirmation !== "MODIFIER CE FRAIS"');
    expect(source).toContain('feeEditConfirmation !== "MODIFIER CE FRAIS"');
    expect(source).toContain('setFeeEditConfirmation("")');
    expect(source).toContain("onClick={cancelFeeEdit}");
    expect(source).toContain("groupFeeTypes(yearData.feeTypes, school, selectedYear.id)");
  });
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
    expect(source).toContain("await deleteFeeType(user, fee)");
    expect(source.indexOf("await deleteFeeType(user, fee)")).toBeLessThan(source.indexOf("feeTypes: data.feeTypes.filter"));
    expect(source).toContain("des paiements historiques y sont liés");
  });

  it("affiche la devise annuelle de l'école sans forcer le dollar", () => {
    expect(source).toContain("resolveSchoolYearCurrency(selectedYear, school)");
    expect(source).toContain("schoolCurrencySymbol({ currency: feeCurrency })");
    expect(source).toContain("formatCurrencyMoney(fee.amount, feeCurrency)");
    expect(source).not.toContain("<strong>${fee.amount}</strong>");
  });
});
