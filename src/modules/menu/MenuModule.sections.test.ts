import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./MenuModule.tsx", import.meta.url), "utf8");

describe("sections dans Paramètres école", () => {
  it("ouvre une confirmation sans persister ni cocher immédiatement", () => {
    expect(source).toContain("onChange={() => requestSchoolSectionChange(level)}");
    expect(source).toContain("checked={schoolFormEducationLevels.includes(level)}");
    expect(source).toContain("getSchoolEducationLevels(school).filter");
    expect(source).not.toContain("onChange={() => toggleSchoolFormEducationLevel(level)}");
  });

  it("demande l'action exacte, autorise l'annulation et bloque le double clic", () => {
    expect(source).toContain("SCHOOL_SECTION_CONFIRMATIONS[schoolSectionPending.action]");
    expect(source).toContain("isSchoolSectionConfirmation(schoolSectionPending.action, schoolSectionConfirmation)");
    expect(source).toContain("onClick={closeSchoolSectionConfirmation}");
    expect(source).toContain("schoolSectionSavingRef.current = true");
    expect(source).toContain("if (schoolSectionSavingRef.current) return;");
  });

  it("n'enregistre que la section après confirmation et montre un échec sans état optimiste", () => {
    expect(source).toContain("await persistSchoolEducationLevel(school.id, pending.level, pending.wasChecked)");
    expect(source).toContain("setSchoolSectionError(error instanceof Error");
    expect(source).toContain("disabled={schoolSaving || schoolSectionSaving || Boolean(schoolSectionPending)}");
  });

  it("supprime le texte obsolète et garde la confirmation dans la largeur du drawer", () => {
    expect(source).not.toContain("Ces sections peuvent évoluer après la création de l'école.");
    expect(source).toContain("grid min-w-0 max-w-full gap-3 rounded border border-amber-200");
    expect(source).toContain("input min-w-0 w-full max-w-full");
  });
});
