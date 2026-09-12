import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { realtimeManagedCollections } from "./firestoreData";

describe("garde-fous de volumétrie", () => {
  it("identifie les collections déjà alimentées par les listeners afin d’éviter leur double lecture au bootstrap", () => {
    expect(realtimeManagedCollections("school_admin")).toEqual(["students", "parents", "feeTypes", "payments", "expenses", "valves"]);
    expect(realtimeManagedCollections("secretary")).toEqual(["students", "parents", "valves"]);
    expect(realtimeManagedCollections("study_director")).toEqual([]);
  });

  it("borne le DOM Élèves et Contrôle à 50 éléments sans réduire les résultats de recherche/export", () => {
    const students = readFileSync(new URL("../modules/students/StudentsModule.tsx", import.meta.url), "utf8");
    const control = readFileSync(new URL("../modules/control/ControlModule.tsx", import.meta.url), "utf8");
    expect(students).toContain("const STUDENTS_PAGE_SIZE = 50");
    expect(students).toContain("visibleStudents.map");
    expect(control).toContain("const CONTROL_PAGE_SIZE = 50");
    expect(control).toContain("paginatedControlRows.map");
    expect(students).toContain("sortStudentsForPdfByClass(students)");
    expect(control).toContain("filterControlStudentRows(rows, controlStudentSearch)");
  });
});
