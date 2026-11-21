import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("écran de connexion", () => {
  it("n'affiche plus le rappel « téléphone partagé » (retiré à la demande du propriétaire)", () => {
    const screen = readFileSync("src/components/auth/LoginScreen.tsx", "utf8");
    expect(screen).not.toContain("Sur un téléphone partagé");
    expect(screen).not.toContain("dossier Téléchargements");
  });
});
