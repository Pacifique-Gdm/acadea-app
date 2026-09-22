import { describe, expect, it } from "vitest";
import type { Student } from "../types";
import { studentSearchFields } from "./studentSearch.js";
import { planStudentQueryFields, rollbackStudentQueryFields, sameUpdateTime, virtualSecondRun } from "../../scripts/studentQueryBackfillCore.js";

const student = (overrides: Partial<Student> = {}): Partial<Student> => ({
  id: "student-a", schoolId: "school-a", schoolYearId: "year-a", matricule: "ACD-27-0042",
  nom: "Kabuya", postnom: "Kasai", prenom: "Élise", status: "ACTIVE", ...overrides,
});

describe("migration ciblée des champs de requête élèves", () => {
  it("projette seulement les trois champs techniques absents et reste idempotente", () => {
    const source = student();
    const plan = planStudentQueryFields(source, studentSearchFields);
    expect(plan.changedFields).toEqual(["sortName", "searchPrefixes", "searchArchived"]);
    expect(plan.projected.sortName).toBe("kabuya kasai elise");
    expect(virtualSecondRun(source, plan, studentSearchFields)).toBe(0);
  });

  it("distingue un champ absent d'une chaîne vide déjà présente pour rollback", () => {
    const source = student({ sortName: "" });
    const plan = planStudentQueryFields(source, studentSearchFields);
    expect(plan.original.sortName).toEqual({ existed: true, value: "" });
    expect(rollbackStudentQueryFields(plan.original, plan.changedFields, "DELETE").sortName).toBe("");
    const absent = planStudentQueryFields(student(), studentSearchFields);
    expect(rollbackStudentQueryFields(absent.original, absent.changedFields, "DELETE").sortName).toBe("DELETE");
  });

  it("ne modifie aucun champ déjà conforme", () => {
    const source = student();
    const projection = studentSearchFields(source);
    expect(planStudentQueryFields({ ...source, ...projection }, studentSearchFields).changedFields).toEqual([]);
  });

  it("normalise accents, casse, espaces, noms composés et traits d'union selon la fonction produit", () => {
    const plan = planStudentQueryFields(student({ nom: "  ÉKÓLÉ  -   Mbuyi ", postnom: "  KASAI  ", prenom: "  Élise  " }), studentSearchFields);
    expect(plan.projected.sortName).toBe("ekole - mbuyi kasai elise");
  });

  it("accepte postnom ou prénom absent sans produire de clé vide", () => {
    expect(planStudentQueryFields(student({ postnom: undefined }), studentSearchFields).projected.sortName).toBe("kabuya elise");
    expect(planStudentQueryFields(student({ prenom: undefined }), studentSearchFields).projected.sortName).toBe("kabuya kasai");
  });

  it("refuse les documents dont la projection alphabétique est vide", () => {
    expect(() => planStudentQueryFields(student({ nom: "", postnom: "", prenom: "" }), studentSearchFields)).toThrow(/Projection/);
  });

  it("conserve deux élèves homonymes distincts, même dans une école/année", () => {
    const first = planStudentQueryFields(student({ id: "student-a" }), studentSearchFields);
    const second = planStudentQueryFields(student({ id: "student-b" }), studentSearchFields);
    expect(first.projected.sortName).toBe(second.projected.sortName);
    expect(first.changedFields).toHaveLength(3);
    expect(second.changedFields).toHaveLength(3);
  });

  it("projette correctement l'état archivé, y compris une année différente", () => {
    const active = planStudentQueryFields(student({ schoolYearId: "year-a" }), studentSearchFields);
    const archived = planStudentQueryFields(student({ schoolYearId: "year-b", deletedAt: "2026-01-01" }), studentSearchFields);
    expect(active.projected.searchArchived).toBe(false);
    expect(archived.projected.searchArchived).toBe(true);
  });

  it("garde les écoles isolées : aucune valeur d'école n'entre dans la projection", () => {
    const one = planStudentQueryFields(student({ schoolId: "school-a" }), studentSearchFields);
    const other = planStudentQueryFields(student({ schoolId: "school-b" }), studentSearchFields);
    expect(one.projected).toEqual(other.projected);
    expect(one.changes).not.toHaveProperty("schoolId");
    expect(other.changes).not.toHaveProperty("schoolYearId");
  });

  it("ne remplace pas les champs de recherche déjà canoniques", () => {
    const source = student();
    const projection = studentSearchFields(source);
    const plan = planStudentQueryFields({ ...source, searchPrefixes: projection.searchPrefixes, searchArchived: projection.searchArchived }, studentSearchFields);
    expect(plan.changedFields).toEqual(["sortName"]);
    expect(rollbackStudentQueryFields(plan.original, plan.changedFields, "DELETE")).toEqual({ sortName: "DELETE" });
  });

  it("détecte la concurrence à la nanoseconde et interdit les champs de rollback étrangers", () => {
    expect(sameUpdateTime({ seconds: 100, nanoseconds: 42 }, { seconds: 100, nanoseconds: 42 })).toBe(true);
    expect(sameUpdateTime({ seconds: 100, nanoseconds: 42 }, { seconds: 100, nanoseconds: 43 })).toBe(false);
    expect(sameUpdateTime(undefined, { seconds: 100, nanoseconds: 42 })).toBe(false);
    const plan = planStudentQueryFields(student(), studentSearchFields);
    expect(() => rollbackStudentQueryFields(plan.original, ["nom"], "DELETE")).toThrow(/interdit/);
  });
});
