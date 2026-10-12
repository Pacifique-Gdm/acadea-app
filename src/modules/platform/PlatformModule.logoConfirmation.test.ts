import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("logo institutionnel de l'application", () => {
  it("demande une phrase exacte avant suppression ou enregistrement", () => {
    const source = readFileSync("src/modules/platform/PlatformModule.tsx", "utf8");
    expect(source).toContain("SUPPRIMER LE LOGO ACTUEL");
    expect(source).toContain("ENREGISTRER LE NOUVEAU LOGO");
    expect(source).toContain('platformLogoConfirmation !== expected');
    expect(source).toContain('setPlatformLogoConfirmation("")');
    expect(source).toContain('if (!saved) throw new Error("Enregistrement Firestore indisponible.")');
    expect(source.indexOf('onPlatformLogoSaved(logoUrl)')).toBeGreaterThan(source.indexOf('if (!saved) throw new Error'));
    expect(source).toContain('platformLogoSavingRef.current');
  });
});
