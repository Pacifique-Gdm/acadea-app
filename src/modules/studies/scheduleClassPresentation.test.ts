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
    expect(scheduleClassPresentation({ ...entry, classId: "parent" }, undefined, classes)).toEqual({ name: "4ème Humanité", scope: "Littéraire" });
  });

  it("conserve seulement les options absentes du nom et supporte les anciennes affectations", () => {
    const legacy = { classId: "parent", courseScope: "common", targetOptionIds: ["literary", "science"] } as PedagogicalAssignment;
    expect(scheduleClassPresentation({ ...entry, targetOptionIds: ["literary", "science"] }, undefined, classes).scope).toBe("Scientifique");
    expect(scheduleClassPresentation({ ...entry, classId: "parent", courseScope: undefined, targetOptionIds: undefined }, legacy, classes).scope).toBe("Littéraire + Scientifique");
  });
});
