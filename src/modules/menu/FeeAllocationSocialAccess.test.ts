import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Règle du propriétaire (23/11) : la « Partie 2 — cas sociaux » n'est visible que pour l'Administrateur de l'école.
const drawer = readFileSync(new URL("./FeeAllocationDrawer.tsx", import.meta.url), "utf8");

describe("écran : partie 2 réservée à l'Administrateur", () => {
  it("l'autorisation ne dépend que du rôle Administrateur de l'école", () => {
    expect(drawer).toContain('const socialPartAllowed = user.role === "school_admin";');
  });
  it("le bouton « Partie 2 — cas sociaux » du détail d'une rubrique est réservé à l'Administrateur", () => {
    expect(drawer).toMatch(/\{socialPartAllowed && config\.currentVersionId && <button[^>]*data-social-part-detail/);
    // Plus aucun bouton « Partie 2 » sans contrôle du rôle.
    expect(drawer).not.toMatch(/\{config\.currentVersionId && <button[^>]*>Partie 2/);
  });
  it("le formulaire de la partie 2 ne s'ouvre que pour l'Administrateur", () => {
    expect(drawer).toContain("{socialPart && socialPartAllowed && <SocialPartEditor");
  });
  it("« Ajouter une répartition » ne montre la partie des cas sociaux qu'à l'Administrateur", () => {
    expect(drawer).toContain("const showSocial = workspace.canConfigure === true && workspace.forecast?.socialStudentCount !== 0;");
  });
});
