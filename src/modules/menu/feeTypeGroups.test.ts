import { describe, expect, it } from "vitest";
import type { FeeType, School } from "../../types";
import { groupFeeTypes } from "./feeTypeGroups";

const school = { id: "a", schoolType: "Mixte", educationLevels: ["Secondaire", "CTEB", "Primaire", "Maternelle"] } as School;
const fee = (id: string, className?: FeeType["className"], overrides: Partial<FeeType> = {}): FeeType => ({ id, name: "Minerval", amount: 10, schoolId: "a", schoolYearId: "y", className, ...overrides });
describe("classement des frais par parents", () => {
  it("réutilise l'ordre pédagogique indépendamment de l'ordre des documents", () => {
    const result = groupFeeTypes([fee("s", "2ème Humanité"), fee("c8", "8ème CTEB"), fee("p6", "6ème Primaire"), fee("m", "Maternelle 1"), fee("p1", "1ère Primaire"), fee("c7", "7ème CTEB")], school, "y");
    expect(result.groups.map((g) => g.section)).toEqual(["Maternelle", "Primaire", "CTEB", "Secondaire"]);
    expect(result.groups[1].classes.map((g) => g.name)).toEqual(["1ère Primaire", "6ème Primaire"]);
    expect(result.groups[2].classes.map((g) => g.name)).toEqual(["7ème CTEB", "8ème CTEB"]);
  });
  it("ne crée pas de rubrique inactive ni ne masque les frais historiques", () => {
    const result = groupFeeTypes([fee("m", "Maternelle 1"), fee("p", "1ère Primaire"), fee("all"), fee("old", "Classe supprimée" as FeeType["className"])], { ...school, educationLevels: ["Primaire", "CTEB"] }, "y");
    expect(result.groups.map((g) => g.section)).toEqual(["Primaire"]);
    expect(result.legacy.map((f) => f.id).sort()).toEqual(["all", "m", "old"]);
  });
  it("conserve les options sous leur parent et l'identité des documents multi-cibles", () => {
    const fees = [fee("lit", "1ère Humanité", { classOptionKey: "1ère Humanité::option::Littéraire" }), fee("sci", "1ère Humanité", { classOptionKey: "1ère Humanité::option::Sciences" }), fee("p", "1ère Primaire")];
    const result = groupFeeTypes(fees, school, "y");
    expect(result.groups[1].classes).toHaveLength(1);
    expect(result.groups[1].classes[0].fees.map((f) => f.id)).toEqual(["lit", "sci"]);
    expect(fees[0].classOptionKey).toBe("1ère Humanité::option::Littéraire");
  });
  it("isole école et année sans modifier les données", () => {
    const fees = [fee("a", "1ère Primaire"), fee("b", "Maternelle 1", { schoolId: "b" }), fee("old", "1ère Primaire", { schoolYearId: "old" })];
    const before = JSON.stringify(fees);
    expect(groupFeeTypes(fees, school, "y").groups.flatMap((g) => g.classes.flatMap((c) => c.fees.map((f) => f.id)))).toEqual(["a"]);
    expect(groupFeeTypes(fees, { ...school, id: "b", educationLevels: ["Maternelle"] }, "y").groups[0].section).toBe("Maternelle");
    expect(JSON.stringify(fees)).toBe(before);
  });
});
