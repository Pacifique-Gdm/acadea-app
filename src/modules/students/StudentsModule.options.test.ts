import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./StudentsModule.tsx", import.meta.url), "utf8");

describe("options du formulaire Élèves", () => {
  it("utilise uniquement le référentiel persistant de l'école", () => {
    expect(source).toContain("const optionChoices = schoolOptions;");
    expect(source).not.toContain("yearData.students.map((student) => student.option)");
  });

  it("laisse le champ Classe utiliser uniquement le référentiel canonique filtré par l'école", () => {
    const formSource = readFileSync(new URL("../../components/students/StudentForm.tsx", import.meta.url), "utf8");
    expect(formSource).toContain("{classChoices.map((className) => <option");
    expect(formSource).not.toContain("structuredClasses.filter((item) => !item.parentClassId && item.active !== false).map");
    expect(formSource).toContain('value={form.className}');
  });
});
