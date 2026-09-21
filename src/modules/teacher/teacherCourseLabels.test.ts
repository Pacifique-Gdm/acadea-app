import { describe, expect, it } from "vitest";
import type { StudyClass } from "../studies/studyTypes";
import { teacherClassScopeLabel } from "./teacherCourseLabels";

const classes = [
  { id: "literary", name: "2ème Littéraire", option: "littéraire" },
  { id: "pedagogy", name: "3ème Pédagogie générale A", option: "PÉDAGOGIE  GÉNÉRALE" },
  { id: "common", name: "3ème Humanité" },
  { id: "cteb", name: "7ème CTEB" },
] as StudyClass[];

describe("libellé de classe Enseignant", () => {
  it("ne répète pas l'option déjà contenue dans la classe opérationnelle, y compris casse, accents et sous-classe", () => {
    expect(teacherClassScopeLabel(classes[0].name, { classId: "literary" }, classes)).toBe("2ème Littéraire");
    expect(teacherClassScopeLabel(classes[1].name, { classId: "pedagogy" }, classes)).toBe("3ème Pédagogie générale A");
  });

  it("conserve l'option lorsqu'elle précise réellement une classe parent et conserve les classes sans option", () => {
    expect(teacherClassScopeLabel("3ème Humanité", { classId: "common", courseScope: "option", targetOptionIds: ["common::litteraire"] }, classes)).toBe("3ème Humanité · litteraire");
    expect(teacherClassScopeLabel("7ème CTEB", { classId: "cteb" }, classes)).toBe("7ème CTEB");
  });
});
