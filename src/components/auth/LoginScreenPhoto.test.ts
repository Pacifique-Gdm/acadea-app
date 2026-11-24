import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const screen = () => readFileSync("src/components/auth/LoginScreen.tsx", "utf8");

describe("écran de connexion : photo, slogan et avantages (proposition B)", () => {
  it("affiche le slogan sur la photo", () => {
    expect(screen()).toContain("La gestion scolaire dans ma poche");
  });

  it("affiche les 4 avantages", () => {
    const source = screen();
    expect(source).toContain("Paiements et reçus en quelques secondes");
    expect(source).toContain("Suivi des élèves, des présences et des dettes");
    expect(source).toContain("Répartition des frais claire et transparente");
    expect(source).toContain("Parents, enseignants et direction connectés");
  });

  it("utilise une photo légère (moins de 100 Ko) avec son crédit", () => {
    const source = screen();
    expect(source).toContain("/connexion-enseignante.jpg");
    expect(source).toContain("Katerina Holmes");
    expect(existsSync("public/connexion-enseignante.jpg")).toBe(true);
    expect(statSync("public/connexion-enseignante.jpg").size).toBeLessThan(100 * 1024);
  });

  it("garde la connexion inchangée : mêmes champs et même bouton", () => {
    const source = screen();
    expect(source).toContain('placeholder="email@ecole.com"');
    expect(source).toContain('placeholder="Votre mot de passe"');
    expect(source).toContain("Se connecter");
    expect(source).toContain("await onLogin(email, password);");
  });
});
