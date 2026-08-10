import { describe, expect, it } from "vitest";
import { activeSubclasses, classesWithEnrolledStudents, operationalClasses, validateSubclassLabels } from "./schoolSubclasses";
import fs from "node:fs";
import type { SchoolClassRecord } from "../types";
const base = (id: string, extra: Partial<SchoolClassRecord> = {}): SchoolClassRecord => ({ id, schoolId: "school-a", schoolYearId: "year-a", name: id, active: true, ...extra });
describe("sous-classes structurées", () => {
  it("autorise zéro, refuse une seule et accepte deux ou plus", () => { expect(activeSubclasses([base("parent")], "parent")).toEqual([]); expect(validateSubclassLabels(["A"])).toContain("au moins deux"); expect(validateSubclassLabels(["A", "B"])).toBe(""); expect(validateSubclassLabels(["A", "B", "C"])).toBe(""); });
  it("refuse les doublons normalisés", () => expect(validateSubclassLabels([" A ", "a"])).toContain("uniques"));
  it("expose les sous-classes comme unités opérationnelles", () => { const rows = [base("parent"), base("a", { parentClassId: "parent" }), base("b", { parentClassId: "parent" }), base("normal")]; expect(operationalClasses(rows).map((item) => item.id)).toEqual(["a", "b", "normal"]); });
  it("ne mélange pas deux classes principales", () => { const rows = [base("a", { parentClassId: "x" }), base("b", { parentClassId: "y" })]; expect(activeSubclasses(rows, "x").map((item) => item.id)).toEqual(["a"]); });
  it("branche le bouton partagé sur les classes initiales et la création temps réel", () => { const form = fs.readFileSync("src/components/students/StudentForm.tsx", "utf8"); const module = fs.readFileSync("src/modules/students/StudentsModule.tsx", "utf8"); expect(form).toContain("item.name === form.className"); expect(form).toContain("Ajouter sous-classe"); expect(form).toContain('useState(["A", "B"])'); expect(form).toContain("Sous-classe ${index + 1}"); expect(module).toContain("subscribeToSchoolClasses"); expect(module).toContain("createSchoolSubclasses"); });
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
  it("conserve un className legacy sans document classe", () => expect(classesWithEnrolledStudents(classes, [student({ className: "Classe historique" })], "school-a", "year-a")[0]).toMatchObject({ name: "Classe historique", schoolId: "school-a", schoolYearId: "year-a" }));
  it("préfère subClassId à la classe principale", () => expect(classesWithEnrolledStudents(classes, [student({ classId: "7", subClassId: "7a", className: "7ème CTEB" })], "school-a", "year-a").map((item) => item.id)).toEqual(["7a"]));
  it("déduplique et trie naturellement les classes", () => expect(classesWithEnrolledStudents(classes, [student({ classId: "8" }), student({ classId: "8" }), student({ subClassId: "7b" }), student({ subClassId: "7a" })], "school-a", "year-a").map((item) => item.id)).toEqual(["7a", "7b", "8"]));
  it("exclut les élèves d’une autre école ou année", () => expect(classesWithEnrolledStudents(classes, [{ schoolId: "school-b", schoolYearId: "year-a", classId: "8" }, { schoolId: "school-a", schoolYearId: "year-b", classId: "8" }], "school-a", "year-a")).toEqual([]));
  it("recalcule la liste lorsqu’un nouvel élève arrive du listener", () => { const before = classesWithEnrolledStudents(classes, [student({ classId: "8" })], "school-a", "year-a"); const after = classesWithEnrolledStudents(classes, [student({ classId: "8" }), student({ classId: "empty" })], "school-a", "year-a"); expect(before.map((item) => item.id)).toEqual(["8"]); expect(after.map((item) => item.id)).toEqual(["8", "empty"]); });
});
