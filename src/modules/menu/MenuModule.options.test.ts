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

  it("persiste directement les options ajoutées depuis Paramètres école", () => {
    expect(source).toContain("persistSchoolOption(school.id, trimmed)");
    expect(source).toContain("Option « ${persisted.option} » enregistrée dans l'école.");
    expect(source).toContain("schoolOptionAdding");
  });

  it("rend la confirmation dans la ligne de l'option et partage les actions en deux colonnes", () => {
    expect(source).toContain("schoolOptionDeleteTarget === option");
    expect(source).toContain('className="grid w-full grid-cols-2 gap-2"');
    expect(source).not.toContain("{schoolOptionDeleteTarget && (");
  });

  it("ne force pas la largeur du logo avec le viewport", () => {
    const upload = readFileSync(new URL("../../components/ui/ImageUploadField.tsx", import.meta.url), "utf8");
    expect(upload).toContain("w-full rounded border border-red-200");
    expect(upload).not.toContain("100vw");
  });
});
