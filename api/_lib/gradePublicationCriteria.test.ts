import { describe, expect, it } from "vitest";
import { feeAppliesToPublishedStudent, qualifiesForPublication, validatedFeePaidMinor, validatePublicationCriteria } from "./gradePublicationCriteria.js";

describe("critères de publication", () => {
  const evaluation = { complete: true, percentage: 60 };
  it("applique les comparaisons exactes et combine les deux critères", () => {
    const gte = validatePublicationCriteria({ slot: "period_1", percentage: { operator: "gte", value: 60 }, fee: { feeTypeId: "minerval", operator: "gte", amountMinor: 15000000 } });
    expect(qualifiesForPublication(evaluation, gte, 15000000)).toBe(true);
    expect(qualifiesForPublication(evaluation, gte, 14999999)).toBe(false);
    expect(qualifiesForPublication({ complete: true, percentage: 59.9999 }, gte, 15000000)).toBe(false);
    const lt = validatePublicationCriteria({ slot: "period_2", percentage: { operator: "lt", value: 60 }, fee: { feeTypeId: "exam", operator: "lt", amountMinor: 5000 } });
    expect(qualifiesForPublication(evaluation, lt, 4999)).toBe(false);
    expect(qualifiesForPublication({ complete: true, percentage: 59.9999 }, lt, 4999)).toBe(true);
    expect(qualifiesForPublication({ complete: false, percentage: 0 }, lt, 0)).toBe(false);
  });

  it("additionne les paiements partiels validés, ignore les annulés et refuse les devises inconnues", () => {
    const scope = { schoolId: "school", schoolYearId: "year", studentId: "student", feeTypeId: "minerval", currency: "CDF" };
    const payment = { ...scope, amount: 100, currency: "CDF" };
    expect(validatedFeePaidMinor([{ ...payment, amount: 40 }, { ...payment, amount: 60 }, { ...payment, amount: 50, status: "cancelled" }], scope)).toBe(10000);
    expect(() => validatedFeePaidMinor([{ ...payment, currency: "USD" }], scope)).toThrow(/Devise/);
    expect(() => validatedFeePaidMinor([{ ...payment, currency: undefined }], scope)).toThrow(/Devise/);
    expect(() => validatedFeePaidMinor([{ ...payment, amount: 0.001 }], scope)).toThrow(/Montant/);
  });

  it("rejette les montants, périodes et opérateurs mal formés", () => {
    expect(() => validatePublicationCriteria({ slot: "semester_1_total" })).toThrow(/Période/);
    expect(() => validatePublicationCriteria({ slot: "period_1", percentage: { operator: "gt", value: 60 } })).toThrow(/pourcentage/);
    expect(() => validatePublicationCriteria({ slot: "period_1", fee: { feeTypeId: "a", operator: "gte", amountMinor: 1.5 } })).toThrow(/frais/);
  });
  it("respecte la clé financière classe-option historique sans se fier à classOptionKey de l'élève", () => {
    const fee = { className: "4ème Humanité", classOptionKey: "4ème Humanité::option::Scientifique" };
    expect(feeAppliesToPublishedStudent(fee, { className: "4ème Humanité", option: "Scientifique", classOptionKey: "operational-class-id" })).toBe(true);
    expect(feeAppliesToPublishedStudent(fee, { className: "4ème Humanité", option: "Littéraire" })).toBe(false);
    expect(feeAppliesToPublishedStudent({ className: "4ème Humanité" }, { className: "4ème Humanité", option: "Littéraire" })).toBe(true);
  });
});
