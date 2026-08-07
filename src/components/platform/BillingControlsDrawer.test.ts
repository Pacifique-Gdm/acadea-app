import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("contrôle Super Administrateur des pièces jointes", () => {
  const source = readFileSync(new URL("./BillingControlsDrawer.tsx", import.meta.url), "utf8");
  const platform = readFileSync(new URL("../../modules/platform/PlatformModule.tsx", import.meta.url), "utf8");

  it("affiche uniquement l'action pertinente avec les styles du design system", () => {
    expect(source).toContain("controls.valvesUploadsEnabled ? <button");
    expect(source).toContain("border-red-200 bg-red-50");
    expect(source).toContain("border-emerald-200 bg-emerald-50");
    expect(source).toContain("focus-visible:ring-2");
  });

  it("conserve une confirmation explicite pour les deux actions", () => {
    expect(source).toContain("SUSPENDRE LES PIECES JOINTES");
    expect(source).toContain("REACTIVER LES PIECES JOINTES");
    expect(source).toContain("Les pièces existantes seront conservées.");
    expect(source).toContain("confirmation !== expectedConfirmation");
  });

  it("rend les boutons Créer et Enregistrer le logo pleine largeur", () => {
    expect(platform).toContain('className="primary-button w-full justify-center"');
    expect(platform).toContain("primary-button w-full justify-center disabled:cursor-not-allowed");
  });
});
