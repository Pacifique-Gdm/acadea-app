import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("sélecteur parent–élèves", () => {
  const source = readFileSync(new URL("./ParentFormEditor.tsx", import.meta.url), "utf8");

  it("remplace le champ direct par un bouton et un sélecteur filtrable", () => {
    expect(source).toContain("Lier à un élève");
    expect(source).toContain("Filtrer par section");
    expect(source).toContain("Filtrer par classe");
    expect(source).toContain("toggleLinkedStudent");
    expect(source).toContain("removeLinkedStudent");
  });

  it("borne les choix à l'école, l'année et aux inscriptions actives", () => {
    expect(source).toContain("student.schoolId === school.id");
    expect(source).toContain("student.schoolYearId === year.id");
    expect(source).toContain('student.status === "ACTIVE"');
  });
});
