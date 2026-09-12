import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { realtimeManagedCollections } from "./firestoreData";

describe("garde-fous de volumétrie", () => {
  it("identifie les collections déjà alimentées par les listeners afin d’éviter leur double lecture au bootstrap", () => {
    expect(realtimeManagedCollections("school_admin")).toEqual(["students", "parents", "feeTypes", "payments", "expenses", "valves"]);
    expect(realtimeManagedCollections("secretary")).toEqual(["students", "parents", "valves"]);
    expect(realtimeManagedCollections("study_director")).toEqual([]);
  });

  it("utilise une pagination Firestore Élèves bornée à 50 et conserve un export explicite", () => {
    const students = readFileSync(new URL("../modules/students/StudentsModule.tsx", import.meta.url), "utf8");
    const pagination = readFileSync(new URL("./studentPagination.ts", import.meta.url), "utf8");
    const control = readFileSync(new URL("../modules/control/ControlModule.tsx", import.meta.url), "utf8");
    expect(pagination).toContain("export const STUDENT_SOURCE_PAGE_SIZE = 50");
    expect(pagination).toContain("startAfter(cursor)");
    expect(pagination).toContain("limit(STUDENT_SOURCE_PAGE_SIZE)");
    expect(students).toContain("useStudentPage(studentFilters");
    expect(students).toContain("visibleStudents.map");
    expect(control).toContain("const CONTROL_PAGE_SIZE = 50");
    expect(control).toContain("paginatedControlRows.map");
    expect(students).toContain("loadAllStudentResults(studentFilters, yearData.students)");
    expect(control).toContain("filterControlStudentRows(rows, controlStudentSearch)");
  });
});
