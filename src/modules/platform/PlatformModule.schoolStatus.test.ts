import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("confirmation du statut d'une école", () => {
  it("n'appelle l'API qu'après une saisie exacte et propose une annulation", () => {
    const source = readFileSync("src/modules/platform/PlatformModule.tsx", "utf8");
    expect(source).toContain('schoolStatusConfirmation !== expectedConfirmation');
    expect(source).toContain('confirmation: expectedConfirmation');
    expect(source).toContain('setSchoolStatusConfirmation("")');
    expect(source).toContain('disabled={schoolStatusSaving || schoolStatusConfirmation !==');
    expect(source).toContain('onClick={closeSchoolStatusChange}');
    expect(source).not.toContain('confirm(`Confirmer: ${label} ${school.name} ?`)');
  });
});
