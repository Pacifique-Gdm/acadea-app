import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./MenuModule.tsx", import.meta.url), "utf8");

describe("référentiel des options dans Paramètres école", () => {
  it("ne supprime jamais une option sans dialogue et confirmation exacte", () => {
    expect(source).toContain("requestSchoolOptionRemoval");
    expect(source).toContain("SCHOOL_OPTION_DELETE_CONFIRMATION");
    expect(source).toContain("isSchoolOptionDeleteConfirmation");
    expect(source).toContain('role="dialog"');
    expect(source).toContain("disabled={!isSchoolOptionDeleteConfirmation(schoolOptionDeleteConfirmation)");
    expect(source).not.toContain("onClick={() => removeSchoolFormOption(option)}");
  });

  it("persiste la suppression via le référentiel école", () => {
    expect(source).toContain("persistSchoolSettings(school, school.schoolOptions, desiredSchool)");
    expect(source).toContain("Cette option est encore utilisée par au moins un élève");
  });
});
