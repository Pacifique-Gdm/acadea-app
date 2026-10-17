import { describe, expect, it } from "vitest";
import type { PedagogicalAssignment, StudyClass, TimetableEntry } from "./studyTypes";
import { scheduleClassPresentation } from "./scheduleClassPresentation";

const classes = [
  { id: "parent", name: "4ème Humanité" },
  { id: "literary", name: "4ème Littéraire", option: "Littéraire", parentClassId: "parent", classOptionKey: "literary" },
  { id: "science", name: "4ème Scientifique", option: "Scientifique", parentClassId: "parent", classOptionKey: "science" },
] as StudyClass[];
const entry = { classId: "literary", courseScope: "option", targetOptionIds: ["literary"] } as TimetableEntry;

describe("libellé de classe dans les horaires", () => {
  it("n'affiche pas deux fois l'option déjà présente dans la classe opérationnelle", () => {
    expect(scheduleClassPresentation(entry, undefined, classes)).toEqual({ name: "4ème Littéraire", scope: "" });
  });

  it("lit l'option de l'entrée enregistrée si la classe parent n'en porte pas", () => {
    expect(scheduleClassPresentation({ ...entry, classId: "parent" }, undefined, classes)).toEqual({ name: "4ème Littéraire", scope: "" });
  });

  it("conserve la portée distincte des cours communs et supporte les anciennes affectations", () => {
    const legacy = { classId: "parent", courseScope: "common", targetOptionIds: ["literary", "science"] } as PedagogicalAssignment;
    expect(scheduleClassPresentation({ ...entry, courseScope: "common", targetOptionIds: ["literary", "science"] }, undefined, classes).scope).toBe("Littéraire + Scientifique");
    expect(scheduleClassPresentation({ ...entry, classId: "parent", courseScope: undefined, targetOptionIds: undefined }, legacy, classes).scope).toBe("Littéraire + Scientifique");
  });

  it("harmonise les références historiques et parent + option avec la vraie classe enregistrée", () => {
    const base = "school__2027-2028__1ere-humanite";
    const science = `${base}::sciences`;
    const commercial = `${base}::commerciale et gestion`;
    const actual = [
      { id: base, schoolId: "school", schoolYearId: "year", name: "1ère" },
      { id: science, schoolId: "school", schoolYearId: "year", name: "1ère Sciences" },
      { id: commercial, schoolId: "school", schoolYearId: "year", name: "1ère Commerciale et Gestion" },
    ] as StudyClass[];
    const legacy = { classId: science } as TimetableEntry;
    const modern = { classId: base, courseScope: "option", targetOptionIds: [commercial] } as TimetableEntry;
    expect(scheduleClassPresentation(legacy, { classId: science } as PedagogicalAssignment, actual)).toEqual({ name: "1ère Sciences", scope: "" });
    expect(scheduleClassPresentation(modern, undefined, actual, ["Sciences", "Commerciale et Gestion"])).toEqual({ name: "1ère Commerciale et Gestion", scope: "" });
  });

  it("respecte les accents, les sous-classes distinctes, et les références incomplètes", () => {
    const actual = [
      { id: "base", schoolId: "school", schoolYearId: "year", name: "3ème" },
      { id: "base::litteraire", schoolId: "school", schoolYearId: "year", name: "3ème Littéraire" },
      { id: "child", schoolId: "school", schoolYearId: "year", name: "3ème Littéraire A", parentClassId: "base", classOptionKey: "base::litteraire", subClassLabel: "A" },
      { id: "other-school-option", schoolId: "other", schoolYearId: "year", name: "3ème Sciences", parentClassId: "base", classOptionKey: "base::sciences" },
      { id: "other-year-option", schoolId: "school", schoolYearId: "other-year", name: "3ème Sciences", parentClassId: "base", classOptionKey: "base::sciences" },
    ] as StudyClass[];
    const selected = { classId: "base", courseScope: "option", targetOptionIds: ["base::litteraire"] } as TimetableEntry;
    expect(scheduleClassPresentation(selected, undefined, actual, ["Littéraire"])).toEqual({ name: "3ème Littéraire", scope: "" });
    expect(scheduleClassPresentation({ ...selected, classId: "child" }, undefined, actual)).toEqual({ name: "3ème Littéraire A", scope: "" });
    expect(scheduleClassPresentation({ ...selected, targetOptionIds: ["base::sciences"] }, undefined, actual, ["Sciences"])).toEqual({ name: "3ème", scope: "Sciences" });
  });

  it("préserve les classes sans option et la portée multi-options avec les libellés officiels", () => {
    const actual = [
      { id: "base", schoolId: "school", schoolYearId: "year", name: "7ème CTEB" },
      { id: "base::litteraire", schoolId: "school", schoolYearId: "year", name: "7ème Littéraire", parentClassId: "base", option: "litteraire" },
      { id: "base::commerciale et gestion", schoolId: "school", schoolYearId: "year", name: "7ème Commerciale et Gestion", parentClassId: "base", option: "commerciale et gestion" },
    ] as StudyClass[];
    expect(scheduleClassPresentation({ classId: "base" } as TimetableEntry, undefined, actual)).toEqual({ name: "7ème CTEB", scope: "" });
    expect(scheduleClassPresentation({ classId: "base", courseScope: "common", targetOptionIds: ["base::litteraire", "base::commerciale et gestion"] } as TimetableEntry, undefined, actual, ["Littéraire", "Commerciale et Gestion"])).toEqual({ name: "7ème CTEB", scope: "Commerciale et Gestion + Littéraire" });
  });
});
