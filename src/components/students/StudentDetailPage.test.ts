import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const detailSource = readFileSync(new URL("./StudentDetailPage.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");

describe("fiche Élève — liaison Parent", () => {
  it("affiche les deux états dans le composant partagé Admin/Secrétaire", () => {
    expect(detailSource).toContain("Lier à un parent");
    expect(detailSource).toContain("Délier le parent");
    expect(detailSource).toContain('user.role === "school_admin" || user.role === "secretary"');
    expect(appSource).not.toContain("canLinkParent={false}");
  });

  it("n'appelle l'API qu'après la confirmation exacte et bloque les doubles soumissions", () => {
    expect(detailSource).toContain("if (!isExactParentUnlinkConfirmation(parentUnlinkConfirmation))");
    expect(detailSource).toContain("if (!student || !parent || parentUnlinkBusy) return");
    expect(detailSource).toContain("await unlinkParentFromStudent");
    expect(detailSource).toContain("disabled={parentUnlinkBusy || !isExactParentUnlinkConfirmation(parentUnlinkConfirmation)}");
    expect(detailSource).toContain('updateData(applyParentUnlinkResult(data');
    expect(detailSource).toContain("{ persist: false }");
  });

  it("explique que le compte Parent et les autres enfants sont conservés", () => {
    expect(detailSource).toContain("Le compte Parent et ses liens avec d’autres enfants seront conservés.");
    expect(detailSource).toContain("Le parent a été délié de cet élève.");
    expect(detailSource).toContain('role="alert"');
  });
});
