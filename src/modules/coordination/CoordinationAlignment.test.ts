import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const portal = readFileSync(new URL("./CoordinationPortal.tsx", import.meta.url), "utf8");
const menu = readFileSync(new URL("./CoordinationMenu.tsx", import.meta.url), "utf8");
const students = readFileSync(new URL("./CoordinationStudents.tsx", import.meta.url), "utf8");
const control = readFileSync(new URL("./CoordinationControl.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../../../api/manage-coordination.js", import.meta.url), "utf8");

describe("alignement Coordination / Administrateur", () => {
  it("affiche les contrôles Élèves dans l'ordre et ouvre la fiche partagée", () => {
    const labels = ["Rechercher", "Tous", "Toutes les classes", "Toutes les options", "Exporter PDF"];
    labels.reduce((cursor, label) => { const next = students.indexOf(label, cursor + 1); expect(next).toBeGreaterThan(cursor); return next; }, -1);
    expect(students).toContain("CoordinationStudentRecord");
  });

  it("isole Contrôle de toutes les mutations Administrateur", () => {
    expect(portal).toContain('["control", "Contrôle", Banknote]');
    for (const forbidden of ["Avertissement", "Modifier", "Supprimer", "createPaymentTransaction", "updateExpenseTransaction"]) expect(control).not.toContain(forbidden);
    expect(control).toContain("Historique");
    expect(control).toContain("CoordinationStudentRecord");
  });

  it("filtre les quatre Drawers et exclut les Parents des personnels", () => {
    expect(menu.match(/<SchoolPdfControls/g)?.length).toBe(4);
    expect(menu).toContain("INTERNAL_PERSONNEL_ROLES");
    expect(menu).toContain("isInternalPersonnel");
    expect(menu).not.toContain('parent: "Parent"');
    expect(menu).toContain("PersonnelProfileReadOnly");
    expect(menu).toContain("printPersonnelProfilePdf");
  });

  it("borne côté serveur la lecture du parent par le périmètre Coordination", () => {
    expect(api).toContain('action === "read-student-parent"');
    expect(api).toContain("requireActiveCoordinationActor");
    expect(api).toContain("resolveCoordinationSchoolScope");
    expect(api).toContain("schoolIds.has(student.schoolId)");
  });
});
