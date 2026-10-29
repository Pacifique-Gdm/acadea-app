import { describe, expect, it } from "vitest";
import { canonicalSchoolOption, isSchoolOptionAddConfirmation, isSchoolOptionDeleteConfirmation, mergeSchoolOptions, normalizeSchoolOptions, reconcileSchoolOptions, reconcileSchoolOptionsFromStudents, schoolOptionDisplayName, SCHOOL_OPTION_ADD_CONFIRMATION, SCHOOL_OPTION_DELETE_CONFIRMATION, SCHOOL_OPTION_RENAME_CONFIRMATION } from "./schoolOptions";

describe("schoolOptions", () => {
  it("change uniquement le libellé visible et conserve la clé historique", () => {
    expect(SCHOOL_OPTION_RENAME_CONFIRMATION).toBe("CHANGER LE NOM DE CETTE OPTION");
    const school = { schoolOptions: ["Sciences"], schoolOptionDisplayNames: { Sciences: "Technologies" } };
    expect(schoolOptionDisplayName(school, "Sciences")).toBe("Technologies");
    expect(schoolOptionDisplayName(school, "Scientifique")).toBe("Technologies");
    expect(schoolOptionDisplayName(school, "Section scientifique")).toBe("Technologies");
    expect(school.schoolOptions).toEqual(["Sciences"]);
  });
  it("exige la phrase d'ajout exacte sans tolérer de variante", () => {
    expect(SCHOOL_OPTION_ADD_CONFIRMATION).toBe("AJOUTER CETTE OPTION");
    expect(isSchoolOptionAddConfirmation("AJOUTER CETTE OPTION")).toBe(true);
    expect(isSchoolOptionAddConfirmation("ajouter cette option")).toBe(false);
    expect(isSchoolOptionAddConfirmation("AJOUTER CETTE OPTION ")).toBe(false);
  });
  it("exige la confirmation de suppression exacte, sans trim", () => {
    expect(SCHOOL_OPTION_DELETE_CONFIRMATION).toBe("SUPPRIMER CETTE OPTION");
    expect(isSchoolOptionDeleteConfirmation("SUPPRIMER CETTE OPTION")).toBe(true);
    expect(isSchoolOptionDeleteConfirmation("supprimer cette option")).toBe(false);
    expect(isSchoolOptionDeleteConfirmation(" SUPPRIMER CETTE OPTION")).toBe(false);
    expect(isSchoolOptionDeleteConfirmation("SUPPRIMER CETTE OPTION ")).toBe(false);
  });
  it("normalise le tableau actuel et l'alias historique", () => {
    expect(normalizeSchoolOptions(["Latin-Philo", "  Scientifique  ", "Latin-Philo", null])).toEqual(["Latin-Philo", "Sciences"]);
  });

  it.each([undefined, null])("retourne un tableau vide pour %s", (value) => {
    expect(normalizeSchoolOptions(value)).toEqual([]);
  });

  it("lit les anciennes structures Firestore", () => {
    expect(normalizeSchoolOptions({ options: ["Commerciale", "Pédagogie"] })).toEqual(["Commerciale", "Pédagogie"]);
    expect(normalizeSchoolOptions({ Scientifique: true, Littéraire: false })).toEqual(["Sciences"]);
    expect(normalizeSchoolOptions({ unexpected: 42 })).toEqual([]);
  });

  it.each(["Scientifique", "scientifique", "SCIENCES", "Science", "Section scientifique"])("canonicalise %s en Sciences", (value) => {
    expect(canonicalSchoolOption(value)).toBe("Sciences");
  });

  it("déduplique la casse, les accents et l'alias Sciences", () => {
    expect(normalizeSchoolOptions([" Pédagogie ", "pedagogie", "Scientifique", "Sciences"])).toEqual(["Pédagogie", "Sciences"]);
  });

  it("fusionne deux ajouts concurrents sans écrasement", () => {
    expect(mergeSchoolOptions(["Option A", "Option B"], ["Option C"])).toEqual(["Option A", "Option B", "Option C"]);
  });

  it("réconcilie un formulaire avec un ajout concurrent", () => {
    expect(reconcileSchoolOptions(["Initiale", "Ajout secrétaire"], ["Initiale"], ["Initiale", "Ajout admin"])).toEqual([
      "Initiale", "Ajout secrétaire", "Ajout admin",
    ]);
  });

  it("réconcilie les options historiques de la seule école ciblée, toutes années confondues", () => {
    const students = [
      { schoolId: "school-a", schoolYearId: "year-1", option: "Sciences" },
      { schoolId: "school-a", schoolYearId: "year-2", option: " Scientifique " },
      { schoolId: "school-a", schoolYearId: "year-2", option: "  " },
      { schoolId: "school-b", schoolYearId: "year-1", option: "Commerciale" },
      { schoolId: "school-a", schoolYearId: "year-1", option: null },
    ];
    expect(reconcileSchoolOptionsFromStudents([], students, "school-a")).toEqual(["Sciences"]);
    expect(reconcileSchoolOptionsFromStudents(["Commerciale"], students, "school-a")).toEqual(["Commerciale", "Sciences"]);
  });

  it("est idempotente et ne modifie jamais les références élèves", () => {
    const students = [{ schoolId: "school-a", option: "Sciences" }];
    const first = reconcileSchoolOptionsFromStudents([], students, "school-a");
    const second = reconcileSchoolOptionsFromStudents(first, students, "school-a");
    expect(second).toEqual(first);
    expect(students).toEqual([{ schoolId: "school-a", option: "Sciences" }]);
  });
});
