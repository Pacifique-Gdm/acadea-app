// Ordre du filtre de l'onglet Élèves, partout : Tous, Actifs, Archivés, Filles, Garçons.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { studentStatusChoices, studentStatusLabel } from "../../hooks/useStudentStatusCounts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("filtre de statut de l'onglet Élèves", () => {
  it("« Tous » en premier : Tous, Actifs, Archivés, Filles, Garçons", () => {
    expect(studentStatusChoices.map((choice) => studentStatusLabel(choice, null))).toEqual(["Tous", "Actifs", "Archivés", "Filles", "Garçons"]);
  });
  it("école, Coordination et Sous-coordination utilisent cette même liste", () => {
    for (const file of ["./StudentsModule.tsx", "../coordination/CoordinationStudents.tsx"]) {
      const source = read(file);
      expect(source, file).toContain("studentStatusChoices.map(");
      expect(source, file).not.toMatch(/<option value="active">/);
    }
  });
});
