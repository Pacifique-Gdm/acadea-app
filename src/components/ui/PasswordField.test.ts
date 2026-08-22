import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./PasswordField.tsx", import.meta.url), "utf8");

describe("PasswordField", () => {
  it("masque par défaut puis bascule sans modifier la valeur", () => {
    expect(source).toContain("useState(false)");
    expect(source).toContain('type={isVisible ? "text" : "password"}');
    expect(source).toContain("value={value}");
    expect(source).toContain("setInternalVisible((current) => !current)");
  });

  it("utilise un bouton non soumetteur et des libellés accessibles dynamiques", () => {
    expect(source).toContain('type="button"');
    expect(source).toContain('"Masquer le mot de passe" : "Afficher le mot de passe"');
    expect(source).toContain("<EyeOff");
    expect(source).toContain("<Eye");
  });
});
