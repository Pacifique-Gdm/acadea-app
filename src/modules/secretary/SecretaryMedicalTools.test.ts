import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Drawers médicaux et statistiques du Secrétaire", () => {
  const source = readFileSync(new URL("./SecretaryMedicalTools.tsx", import.meta.url), "utf8");

  it("réutilise AdminDrawer pour la liste, la consultation, le formulaire et les statistiques", () => {
    expect(source.match(/<AdminDrawer/g)?.length).toBeGreaterThanOrEqual(4);
    expect(source).toContain('title="Fiches médicales"');
    expect(source).toContain('title="Statistiques"');
  });

  it("présente la recherche, les statuts et les actions attendues", () => {
    for (const label of ["Rechercher un élève", "Complète", "Incomplète", "Non créée", "Consulter", "Modifier", "Créer"]) expect(source).toContain(label);
  });

  it("contient tous les champs médicaux et un verrou anti-double soumission", () => {
    for (const label of ["Groupe sanguin", "Rhésus", "Allergies", "Maladies chroniques", "Traitements en cours", "Handicap ou besoin particulier", "Vaccinations", "Observations médicales", "Contact d'urgence", "Téléphone du contact d'urgence", "Lien avec l'élève", "Médecin traitant", "Téléphone du médecin", "Centre de santé de référence"]) expect(source).toContain(label);
    expect(source).toContain("saveLock.current");
  });
});
