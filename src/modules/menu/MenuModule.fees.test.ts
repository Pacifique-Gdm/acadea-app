import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./MenuModule.tsx", import.meta.url), "utf8");

describe("Types de frais", () => {
  it("n'impose aucun libellé à une école neuve tout en conservant les frais enregistrés", () => {
    expect(source).toContain('const [feeName, setFeeName] = useState<FeeKind>("")');
    expect(source).toContain('...yearData.feeTypes.map((fee) => fee.name)');
    expect(source).toContain('...persistedCustomFeeKindChoices');
    expect(source).not.toContain('...FEE_KINDS');
    expect(source).toContain('<option value="">Sélectionnez un frais</option>');
    expect(source).toContain("Aucun type de frais n'a encore été ajouté pour cet établissement.");
    expect(source).toContain('<option value="__add_fee__">Ajouter un frais</option>');
    const platform = readFileSync(new URL("../platform/PlatformModule.tsx", import.meta.url), "utf8");
    const creation = platform.slice(platform.indexOf("async function createSchool()"), platform.indexOf("function changeSchoolLevel("));
    expect(creation).not.toContain("feeTypes:");
  });
  it("confirme le libellé par API sans écriture cliente sur l'année coordonnée", () => {
    const add = source.slice(source.indexOf("async function addFeeKind()"), source.indexOf("function closeSchoolSectionConfirmation"));
    expect(add).toContain("await persistFeeKind(request)");
    expect(add).toContain("{ persist: false }");
    expect(add.indexOf("await persistFeeKind(request)")).toBeLessThan(add.indexOf("updateData("));
    expect(add).toContain("newFeeRequestRef.current = request");
  });
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
    expect(source).toContain("disabled={(feeClassNames.length === 0 && !feePendingConfirmation) || feeSubmitting}");
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
    expect(source).toContain("await saveFeeTypes(request)");
    expect(source).toContain("feeSaveRequestRef.current = request");
    expect(source).toContain("feePendingConfirmation ? \"Vérifier l'enregistrement\"");
    expect(source.indexOf("await saveFeeTypes(request)")).toBeLessThan(source.indexOf("updateData({", source.indexOf("await saveFeeTypes(request)")));
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
