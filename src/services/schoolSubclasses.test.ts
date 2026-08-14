import { describe, expect, it } from "vitest";
import { activeSubclasses, canonicalOperationalClasses, classesWithEnrolledStudents, operationalClasses, operationalSchoolClasses, schoolClassOptionKey, schoolClassRecordId, secondarySubclassesForOption, studentBelongsToOperationalClass, validateSubclassLabels } from "./schoolSubclasses";
import fs from "node:fs";
import type { SchoolClassRecord } from "../types";
const base = (id: string, extra: Partial<SchoolClassRecord> = {}): SchoolClassRecord => ({ id, schoolId: "school-a", schoolYearId: "year-a", name: id, active: true, ...extra });
it("filtre les classes opérationnelles par école, année et sections", () => { const items = [base("parent", { name: "1ère Humanité" }), base("commerciale", { name: "1ère Humanité Commerciale", parentClassId: "parent" }), base("Primaire", { name: "1ère Primaire" }), { ...base("foreign", { name: "2ème Humanité" }), schoolId: "school-b" }]; expect(operationalSchoolClasses(items, "school-a", "year-a", ["Secondaire"]).map((item) => item.id)).toEqual(["commerciale"]); });
describe("sous-classes structurées", () => {
  it("autorise zéro, refuse une seule et accepte deux ou plus", () => { expect(activeSubclasses([base("parent")], "parent")).toEqual([]); expect(validateSubclassLabels(["A"])).toContain("au moins deux"); expect(validateSubclassLabels(["A", "B"])).toBe(""); expect(validateSubclassLabels(["A", "B", "C"])).toBe(""); });
  it("refuse les doublons normalisés", () => expect(validateSubclassLabels([" A ", "a"])).toContain("uniques"));
  it("expose les sous-classes comme unités opérationnelles", () => { const rows = [base("parent"), base("a", { parentClassId: "parent" }), base("b", { parentClassId: "parent" }), base("normal")]; expect(operationalClasses(rows).map((item) => item.id)).toEqual(["a", "b", "normal"]); });
  it("ne mélange pas deux classes principales", () => { const rows = [base("a", { parentClassId: "x" }), base("b", { parentClassId: "y" })]; expect(activeSubclasses(rows, "x").map((item) => item.id)).toEqual(["a"]); });
  it("isole deux options de la même classe et autorise le même libellé dans chacune", () => {
    const scientific = schoolClassOptionKey("secondary-1", "Scientifique");
    const literary = schoolClassOptionKey("secondary-1", "Littéraire");
    const rows = [
      base("scientific-a", { parentClassId: "secondary-1", classOptionKey: scientific, subClassLabel: "A" }),
      base("literary-a", { parentClassId: "secondary-1", classOptionKey: literary, subClassLabel: "A" }),
    ];
    expect(secondarySubclassesForOption(rows, "secondary-1", scientific).map((item) => item.id)).toEqual(["scientific-a"]);
    expect(secondarySubclassesForOption(rows, "secondary-1", literary).map((item) => item.id)).toEqual(["literary-a"]);
  });
  it("conserve uniquement la sous-classe legacy déjà sélectionnée pendant une modification", () => {
    const rows = [base("legacy-a", { parentClassId: "secondary-1", subClassLabel: "A" }), base("legacy-b", { parentClassId: "secondary-1", subClassLabel: "B" })];
    expect(secondarySubclassesForOption(rows, "secondary-1", schoolClassOptionKey("secondary-1", "Scientifique"), "legacy-a").map((item) => item.id)).toEqual(["legacy-a"]);
  });
  it("génère un identifiant stable pour une classe legacy", () => expect(schoolClassRecordId("school-a", "year-a", "7ème CTEB")).toBe("school-a__year-a__7eme-cteb"));
  it("branche le bouton partagé dans l'ordre classe puis option puis sous-classe", () => { const form = fs.readFileSync("src/components/students/StudentForm.tsx", "utf8"); const module = fs.readFileSync("src/modules/students/StudentsModule.tsx", "utf8"); expect(form).toContain("item.name === form.className"); expect(form).toContain("schoolClassRecordId("); expect(form.indexOf("Option")).toBeLessThan(form.indexOf("Ajouter sous-classe")); expect(form).toContain("Sélectionnez d’abord une option."); expect(form).toContain("subClassId: undefined"); expect(form).toContain('useState(["A", "B"])'); expect(form).toContain("Sous-classe ${index + 1}"); expect(module).toContain("subscribeToSchoolClasses"); expect(module).toContain("createSchoolSubclasses"); });
});

describe("identite operationnelle stable des classes", () => {
  const commercial = base("commerciale-a", { name: "1ere Humanite", parentClassId: "secondary-1", classOptionKey: schoolClassOptionKey("secondary-1", "Commerciale"), subClassLabel: "A" });
  const literary = base("litteraire-a", { name: "1ere Humanite", parentClassId: "secondary-1", classOptionKey: schoolClassOptionKey("secondary-1", "Litteraire"), subClassLabel: "A" });

  it("distingue deux options et sous-classes homonymes", () => {
    const student = { schoolId: "school-a", schoolYearId: "year-a", classId: "secondary-1", subClassId: "commerciale-a", classOptionKey: commercial.classOptionKey, option: "Commerciale" };
    expect(studentBelongsToOperationalClass(student, commercial)).toBe(true);
    expect(studentBelongsToOperationalClass(student, literary)).toBe(false);
  });

  it("refuse une classe d'une autre ecole ou annee", () => {
    const student = { schoolId: "school-a", schoolYearId: "year-a", classId: "secondary-1", subClassId: "commerciale-a" };
    expect(studentBelongsToOperationalClass(student, { ...commercial, schoolId: "school-b" })).toBe(false);
    expect(studentBelongsToOperationalClass(student, { ...commercial, schoolYearId: "year-b" })).toBe(false);
  });

  it("conserve une classe active sans eleve et retire une classe desactivee au recalcul", () => {
    expect(operationalSchoolClasses([base("active-empty"), base("inactive", { active: false })], "school-a", "year-a").map((item) => item.id)).toEqual(["active-empty"]);
    expect(operationalSchoolClasses([base("active-empty", { active: false })], "school-a", "year-a")).toEqual([]);
  });
});

describe("source canonique partagée entre élèves, vacations et homogénéité", () => {
  const student = (extra: Record<string, unknown>) => ({
    id: "student", schoolId: "school-a", schoolYearId: "year-a", matricule: "M", nom: "N", postnom: "P", prenom: "R",
    sexe: "F" as const, birthDate: "2010-01-01", address: "", phone: "", className: "1ère Humanité" as const, ...extra,
  });

  it("students class display, vacation classes and age-homogeneity classes share the same canonical class identities", () => {
    const classes = [base("primary", { name: "2ème Primaire", section: "Primaire" }), base("inactive", { name: "4ème Primaire", active: false })];
    const result = canonicalOperationalClasses(classes, [student({ option: "Scientifique", section: "Secondaire" })], "school-a", "year-a");
    expect(result.map((item) => item.name)).toEqual(["1ère Scientifique", "2ème Primaire"]);
    expect(studentBelongsToOperationalClass(student({ option: "Scientifique" }), result[0])).toBe(true);
  });

  it("recalcule l’union des sections et retire immédiatement une section", () => {
    const classes = [base("primary", { name: "2ème Primaire", section: "Primaire" }), base("secondary", { name: "1ère Humanité", section: "Secondaire" })];
    expect(canonicalOperationalClasses(classes, [], "school-a", "year-a", ["Primaire", "Secondaire"]).map((item) => item.id)).toEqual(["secondary", "primary"]);
    expect(canonicalOperationalClasses(classes, [], "school-a", "year-a", ["Secondaire"]).map((item) => item.id)).toEqual(["secondary"]);
  });
});

describe("classes réellement utilisées par les élèves", () => {
  const classes = [
    base("7", { name: "7ème CTEB" }),
    base("7a", { name: "7ème CTEB - A", parentClassId: "7", subClassLabel: "A" }),
    base("7b", { name: "7ème CTEB - B", parentClassId: "7", subClassLabel: "B" }),
    base("8", { name: "8ème CTEB" }),
    base("empty", { name: "9ème CTEB" }),
  ];
  const student = (extra: Record<string, string | undefined>) => ({ schoolId: "school-a", schoolYearId: "year-a", ...extra });

  it("résout classId et exclut une classe sans élève", () => expect(classesWithEnrolledStudents(classes, [student({ classId: "8", className: "8ème CTEB" })], "school-a", "year-a").map((item) => item.id)).toEqual(["8"]));
  it("conserve un className legacy et le résout vers la classe structurée", () => expect(classesWithEnrolledStudents(classes, [student({ className: "8ème CTEB" })], "school-a", "year-a").map((item) => item.id)).toEqual(["8"]));
  it("conserve un className legacy sans document classe avec un identifiant tenanté", () => expect(classesWithEnrolledStudents(classes, [student({ className: "Classe historique" })], "school-a", "year-a")[0]).toMatchObject({ id: "school-a__year-a__classe-historique", name: "Classe historique", schoolId: "school-a", schoolYearId: "year-a" }));
  it("préfère subClassId à la classe principale", () => expect(classesWithEnrolledStudents(classes, [student({ classId: "7", subClassId: "7a", className: "7ème CTEB" })], "school-a", "year-a").map((item) => item.id)).toEqual(["7a"]));
  it("déduplique et trie naturellement les classes", () => expect(classesWithEnrolledStudents(classes, [student({ classId: "8" }), student({ classId: "8" }), student({ subClassId: "7b" }), student({ subClassId: "7a" })], "school-a", "year-a").map((item) => item.id)).toEqual(["7a", "7b", "8"]));
  it("exclut les élèves d’une autre école ou année", () => expect(classesWithEnrolledStudents(classes, [{ schoolId: "school-b", schoolYearId: "year-a", classId: "8" }, { schoolId: "school-a", schoolYearId: "year-b", classId: "8" }], "school-a", "year-a")).toEqual([]));
  it("recalcule la liste lorsqu’un nouvel élève arrive du listener", () => { const before = classesWithEnrolledStudents(classes, [student({ classId: "8" })], "school-a", "year-a"); const after = classesWithEnrolledStudents(classes, [student({ classId: "8" }), student({ classId: "empty" })], "school-a", "year-a"); expect(before.map((item) => item.id)).toEqual(["8"]); expect(after.map((item) => item.id)).toEqual(["8", "empty"]); });
});
