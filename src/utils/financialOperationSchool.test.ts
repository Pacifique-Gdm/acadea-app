import { describe, expect, it } from "vitest";
import type { School } from "../types";
import { resolveFinancialOperationSchool } from "./financialOperationSchool";

function school(id: string, name: string): School {
  return { id, name, address: `${name} adresse`, phone: "+243000000000", email: `${id}@example.invalid`, activeSchoolYearId: `year-${id}`, status: "active", subscriptionPlan: "Standard", subscriptionAmount: 0 };
}

describe("résolution de l’école source d’une opération financière", () => {
  const schools = [school("school-a", "École A"), school("school-b", "École B"), school("school-c", "École C")];
  const schoolsById = new Map(schools.map((item) => [item.id, item]));

  it.each([
    ["school-a", "École A"],
    ["school-b", "École B"],
    ["school-c", "École C"],
  ])("résout %s sans dépendre de l’école sélectionnée", (schoolId, expectedName) => {
    expect(resolveFinancialOperationSchool({ schoolId }, schoolsById)?.name).toBe(expectedName);
  });

  it("ne substitue aucune école quand l’école source est inaccessible", () => {
    expect(resolveFinancialOperationSchool({ schoolId: "school-inconnue" }, schoolsById)).toBeUndefined();
  });
});
