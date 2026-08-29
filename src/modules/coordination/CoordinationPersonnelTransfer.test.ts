import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const menu = readFileSync(new URL("./CoordinationMenu.tsx", import.meta.url), "utf8");
const service = readFileSync(new URL("../../services/coordinationService.ts", import.meta.url), "utf8");
const api = readFileSync(new URL("../../../api/manage-coordination.js", import.meta.url), "utf8");

describe("mutation d'un personnel depuis sa fiche Coordination", () => {
  it("réserve l'action au Coordinateur principal et exclut l'école actuelle", () => {
    expect(menu).toContain('user.role === "coordination_admin"');
    expect(menu).toContain('school.id !== selectedPersonnel?.schoolId');
    expect(menu).toContain('setTransferOpen(true)');
    expect(menu).toContain('Muter</button>');
  });

  it("partage toute la toolbar en deux colonnes égales sans largeur intrinsèque", () => {
    expect(menu).toContain('grid w-full min-w-0 gap-2');
    expect(menu).toContain('transferAllowed ? "grid-cols-2" : "grid-cols-1"');
    expect(menu).toContain('primary-button w-full justify-center');
    expect(menu).toContain('secondary-button w-full justify-center');
    expect(menu).not.toContain('sm:w-auto" onClick={openPersonnelTransfer}');
  });

  it("exige la confirmation exacte, non préremplie, avant l'appel serveur", () => {
    expect(menu).toContain('const PERSONNEL_TRANSFER_CONFIRMATION = "MUTER CE PERSONNEL"');
    expect(menu).toContain('confirmation: ""');
    expect(menu).toContain('transferForm.confirmation === PERSONNEL_TRANSFER_CONFIRMATION');
    expect(menu).toContain('disabled={transferBusy || !transferReady}');
    expect(service).toContain('action: "transfer-personnel"');
  });

  it("affiche explicitement le trajet école source vers destination", () => {
    expect(menu).toContain('schoolName(selectedPersonnel.schoolId)} → {schoolName(transferForm.destinationSchoolId)');
  });

  it("préserve l'identité et les historiques en mutant seulement le rattachement actif", () => {
    expect(api).toContain('transaction.update(personnelRef, { schoolId: destinationSchoolId');
    expect(api).toContain('transaction.update(profileRef, { schoolId: destinationSchoolId');
    expect(api).toContain('auth.setCustomUserClaims(personnelId, { role: personnel.role, schoolId: destinationSchoolId })');
    expect(api).not.toContain("auth.deleteUser(personnelId)");
    expect(api).not.toContain('transaction.update(db.doc(`payments/');
    expect(api).not.toContain('transaction.update(db.doc(`expenses/');
  });
});
