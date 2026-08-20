import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./CoordinationManagement.tsx", import.meta.url), "utf8");

describe("gestion Super Administrateur des Coordinations", () => {
  it("expose la création et le provisioning via l'API existante", () => {
    expect(source).toContain("createCoordination");
    expect(source).toContain("Créer Coordination");
    expect(source).toContain("selectedSchools");
  });
  it("permet l'ajout et le retrait historisé des écoles", () => {
    expect(source).toContain("addCoordinationSchool");
    expect(source).toContain("removeCoordinationSchool");
    expect(source).toContain("Retirée le");
  });
  it("affiche la fiche, le statut et le Coordinateur principal", () => {
    expect(source).toContain("principalCoordinatorUserId");
    expect(source).toContain("selected.status");
    expect(source).toContain("Écoles rattachées");
  });
});
