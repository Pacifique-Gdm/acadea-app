import { describe, expect, it } from "vitest";
import { PRODUCTION_CONFIRMATION, PRODUCTION_PROJECT, STAGING_CONFIRMATION, STAGING_PROJECT, validateReconciliationPolicy } from "../../scripts/reconcileSchoolOptionsPolicy";

describe("reconcileSchoolOptions policy", () => {
  it("autorise le dry-run Staging et exige un schoolId pour apply", () => {
    expect(validateReconciliationPolicy({ project: STAGING_PROJECT, apply: false })).toMatchObject({ project: STAGING_PROJECT });
    expect(() => validateReconciliationPolicy({ project: STAGING_PROJECT, apply: true, confirmation: STAGING_CONFIRMATION })).toThrow("school-id");
  });

  it("protège l'application Staging par confirmation exacte", () => {
    expect(validateReconciliationPolicy({ project: STAGING_PROJECT, schoolId: "school-a", apply: true, confirmation: STAGING_CONFIRMATION })).toMatchObject({ apply: true });
    expect(() => validateReconciliationPolicy({ project: STAGING_PROJECT, schoolId: "school-a", apply: true, confirmation: "RECONCILE SCHOOL OPTIONS " })).toThrow("Confirmation");
  });

  it("refuse les projets inconnus et protège Production par une confirmation distincte", () => {
    expect(() => validateReconciliationPolicy({ project: "other-project", apply: false })).toThrow("non autorisé");
    expect(() => validateReconciliationPolicy({ project: PRODUCTION_PROJECT, schoolId: "school-a", apply: true, confirmation: STAGING_CONFIRMATION })).toThrow("Confirmation");
    expect(validateReconciliationPolicy({ project: PRODUCTION_PROJECT, schoolId: "school-a", apply: true, confirmation: PRODUCTION_CONFIRMATION })).toMatchObject({ project: PRODUCTION_PROJECT });
  });
});
