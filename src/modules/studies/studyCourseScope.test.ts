import { describe, expect, it } from "vitest";
import type { PedagogicalAssignment, StudyClass } from "./studyTypes";
import { assignmentAppliesToClass, assignmentStudentGroupKey, assignmentsShareStudents, logicalStudyClasses, validateAssignmentClassSelection } from "./studyCourseScope";

const base: StudyClass = { id: "3h", schoolId: "s", schoolYearId: "y", name: "3ème Humanité", section: "Secondaire" };
const option = (name: string): StudyClass => ({ id: `3h::${name.toLowerCase()}`, schoolId: "s", schoolYearId: "y", name: `3ème ${name}`, section: "Secondaire", parentClassId: "3h", classOptionKey: `3h::${name.toLowerCase()}`, option: name });
const classes = [base, option("Scientifique"), option("Commerciale"), option("Littéraire"), option("Pédagogie")];
const assignment = (id: string, courseScope?: "common" | "option", targetOptionIds?: string[]): PedagogicalAssignment => ({ id, schoolId: "s", schoolYearId: "y", teacherId: id, subjectId: id, classId: "3h", courseScope, targetOptionIds, studentGroupKey: courseScope ? assignmentStudentGroupKey({ courseScope, targetOptionIds }) : undefined, weeklyPeriods: 1, active: true, createdAt: "n", updatedAt: "n", createdBy: "u", updatedBy: "u" });

describe("portée pédagogique par classe et options", () => {
  it("accepte les cardinalités métier et refuse une option étrangère", () => {
    expect(validateAssignmentClassSelection({ classId: "3h", courseScope: "common", targetOptionIds: ["3h::scientifique", "3h::commerciale"] }, classes)).toBe("");
    expect(validateAssignmentClassSelection({ classId: "3h", courseScope: "common", targetOptionIds: ["3h::scientifique"] }, classes)).toContain("au moins deux");
    expect(validateAssignmentClassSelection({ classId: "3h", courseScope: "option", targetOptionIds: ["3h::scientifique", "3h::commerciale"] }, classes)).toContain("exactement une");
    expect(validateAssignmentClassSelection({ classId: "3h", courseScope: "option", targetOptionIds: ["other::option"] }, classes)).toContain("n’appartient pas");
  });

  it("conserve les classes sans options comme un groupe-classe unique", () => {
    const plain = [{ ...base, id: "primary", name: "3ème Primaire", section: "Primaire" as const }];
    expect(validateAssignmentClassSelection({ classId: "primary" }, plain)).toBe("");
    expect(assignmentsShareStudents({ ...assignment("a"), classId: "primary" }, { ...assignment("b"), classId: "primary" }, plain)).toBe(true);
  });

  it("autorise uniquement les groupes d’options disjoints en parallèle", () => {
    const common = assignment("fr", "common", ["3h::scientifique", "3h::commerciale"]);
    expect(assignmentsShareStudents(common, assignment("accounting", "option", ["3h::commerciale"]), classes)).toBe(true);
    expect(assignmentsShareStudents(assignment("physics", "option", ["3h::scientifique"]), assignment("accounting", "option", ["3h::commerciale"]), classes)).toBe(false);
    expect(assignmentsShareStudents(common, assignment("latin", "common", ["3h::littéraire", "3h::pédagogie"]), classes)).toBe(false);
    expect(assignmentsShareStudents(common, assignment("math", "common", ["3h::commerciale", "3h::littéraire"]), classes)).toBe(true);
  });

  it("filtre un horaire d’option en incluant ses troncs communs", () => {
    const common = assignment("fr", "common", ["3h::scientifique", "3h::commerciale"]);
    expect(assignmentAppliesToClass(common, classes[2], classes)).toBe(true);
    expect(assignmentAppliesToClass(common, classes[3], classes)).toBe(false);
  });

  it("regroupe les classes opérationnelles par classe parente", () => {
    expect(logicalStudyClasses(classes.slice(1), classes)).toEqual([expect.objectContaining({ id: "3h", name: "3ème Humanité" })]);
  });
});
