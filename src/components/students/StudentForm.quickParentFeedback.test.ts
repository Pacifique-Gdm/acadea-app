import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./StudentForm.tsx", import.meta.url), "utf8");

describe("retour de création rapide d'un Parent", () => {
  it("rend le message de succès directement avant le bouton de création", () => {
    const feedback = source.indexOf('quickParentFeedback && <p role="status"');
    const button = source.indexOf("Créer et sélectionner");
    expect(feedback).toBeGreaterThan(-1);
    expect(button).toBeGreaterThan(feedback);
  });
});
