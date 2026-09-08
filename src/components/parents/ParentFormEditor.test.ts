import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ParentFormEditor.tsx", import.meta.url), "utf8");

describe("fiche Parent — déliaison d'un élève", () => {
  it("demande la confirmation exacte et persiste la mutation serveur", () => {
    expect(source).toContain("PARENT_STUDENT_UNLINK_CONFIRMATION");
    expect(source).toContain("isExactParentStudentUnlinkConfirmation(studentUnlinkConfirmation)");
    expect(source).toContain("await unlinkParentFromStudent");
    expect(source).toContain("applyParentUnlinkResult(data");
    expect(source).toContain('role="dialog" aria-label="Confirmer la déliaison de l\'élève"');
  });

  it("désactive la confirmation pendant la mutation et permet l'annulation", () => {
    expect(source).toContain("disabled={studentUnlinkBusy}");
    expect(source).toContain("onClick={closeStudentUnlink}");
    expect(source).toContain("Déliaison…");
  });
});
