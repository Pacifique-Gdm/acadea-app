import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./CoordinationManagement.tsx", import.meta.url), "utf8");

describe("gestion Super Administrateur des Coordinations", () => {
  it("expose la création et le provisioning via l'API existante", () => {
    expect(source).not.toContain("createCoordination");
    expect(source).not.toContain("Créer Coordination");
    expect(source).not.toContain("selectedSchools");
  });
  it("permet l'ajout et le retrait historisé des écoles", () => {
    expect(source).toContain("addCoordinationSchool");
    expect(source).toContain("removeCoordinationSchool");
    expect(source).toContain("Retirée le");
    expect(source).toContain("AJOUTER CETTE ECOLE");
    expect(source).toContain("RETIRER CETTE ECOLE");
    expect(source).toContain("confirmation !==");
  });
  it("affiche la fiche, le statut et le Coordinateur principal", () => {
    expect(source).toContain("principalCoordinatorUserId");
    expect(source).toContain("selected.status");
    expect(source).toContain("Écoles rattachées");
    expect(source).toContain("<AdminDrawer");
  });
  it("réutilise la source temps réel partagée avec le Dashboard", () => {
    expect(source).toContain("coordinations, coordinationError");
    expect(source).not.toContain("setCoordinations");
    expect(source).not.toContain('collection(db, "coordinations")');
  });
  it("attache l'ajout à l'école ciblée et réinitialise confirmation et clic extérieur", () => {
    expect(source).toContain('availableSchools.map((school) => <div key={school.id}');
    expect(source).toContain('pendingRelation.school.id === school.id && relationConfirmation()');
    expect(source).toContain('pendingRelation?.action === "remove" && relationConfirmation()');
    expect(source).toContain('setPendingRelation({ action, school }); setConfirmation("")');
    expect(source).toContain('document.addEventListener("pointerdown", onOutsidePointerDown)');
    expect(source).toContain('document.removeEventListener("pointerdown", onOutsidePointerDown)');
    expect(source).toContain('onClick={cancelRelation}');
  });
  it("ne rend pas le retrait inerte si la liste des écoles n'a pas encore cette relation", () => {
    expect(source).toContain('school ?? { id: relation.schoolId, name: schoolName(relation.schoolId) }');
    expect(source).not.toContain('if (school) requestRelation("remove", school)');
  });
  it("affiche l'état canonique de l'école, sans confondre rattachement et activité", () => {
    expect(source).toContain('school?.status === "suspended" ? "Suspendue"');
    expect(source).toContain('school?.status === "active" ? "Active"');
    expect(source).not.toContain('relation.active ? "Active"');
  });
});
