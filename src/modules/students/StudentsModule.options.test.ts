import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./StudentsModule.tsx", import.meta.url), "utf8");

describe("options du formulaire Élèves", () => {
  it("utilise uniquement le référentiel persistant de l'école", () => {
    expect(source).toContain("const optionChoices = schoolOptions;");
    expect(source).not.toContain("yearData.students.map((student) => student.option)");
  });
});
