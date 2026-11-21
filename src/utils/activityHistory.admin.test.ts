import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AppData, AppUser, AuditLog } from "../types";
import { ACTIVITY_HISTORY_PAGE_SIZE, activityHistoryActors, buildActivityHistoryItems, filterActivityHistoryItems } from "./activityHistory";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const admin: AppUser = { id: "admin-a", name: "Admin", email: "admin@example.invalid", role: "school_admin", schoolId: "school-a", activeSchoolYearId: "year-a", status: "active" };
const secretary: AppUser = { ...admin, id: "secretary-a", name: "Secrétaire A", role: "secretary" };
const cashier: AppUser = { ...admin, id: "cashier-a", name: "Caissier A", role: "cashier" };
const data: AppData = { users: [admin, secretary, cashier], schools: [], schoolYears: [], students: [], parents: [], feeTypes: [], payments: [], expenses: [], messages: [], notifications: [], auditLogs: [], valves: [], disciplineSanctions: [], attendance: [], attendanceSettings: [], biometricTerminals: [] };
const log = (id: string, actor: AppUser, changes: Partial<AuditLog>): AuditLog => ({ id, schoolId: "school-a", schoolYearId: "year-a", actorId: actor.id, actorName: actor.name, action: "Activité", createdAt: "2026-11-20T10:00:00.000Z", ...changes });
const yearData = (auditLogs: AuditLog[]) => ({ students: [], parents: [], users: data.users, feeTypes: [], payments: [], expenses: [], messages: [], disciplineSanctions: [], auditLogs });

describe("Historique de l'administrateur : toutes les activités essentielles de l'école au même endroit", () => {
  it("montre l'ajout et la modification d'élève du secrétaire et du caissier, avec qui, quand, avant et après", () => {
    const items = buildActivityHistoryItems(admin, data, yearData([
      log("upd", secretary, { eventType: "student.updated", action: "Modification élève", createdAt: "2026-11-21T09:00:00.000Z",
        metadata: { matricule: "ACD-26-0001", student: "KABILA Mbuyi Anne", fields: "address, className", changes: "Adresse : vide → Avenue 2 · Classe : 1ère Primaire → 2ème Primaire" } }),
      log("new", cashier, { eventType: "student.created", action: "Création élève", createdAt: "2026-11-21T08:00:00.000Z",
        metadata: { matricule: "ACD-26-0002", student: "BETA Fictif Nouveau", fields: "nom, className", changes: "Nom : BETA · Classe : 1ère Primaire" } }),
    ]), "admin");
    expect(items.map((item) => [item.type, item.title, item.actorName])).toEqual([
      ["student", "Modification élève", "Secrétaire A"],
      ["student", "Création élève", "Caissier A"],
    ]);
    expect(items[0].details).toBe("Élève : KABILA Mbuyi Anne (ACD-26-0001) · Adresse : vide → Avenue 2 · Classe : 1ère Primaire → 2ème Primaire");
  });

  it("montre aussi les autres activités du secrétaire (avant : seules celles de l'administrateur, du caissier et du directeur de discipline)", () => {
    const items = buildActivityHistoryItems(admin, data, yearData([log("courrier", secretary, { action: "Création courrier" })]), "admin");
    expect(items.map((item) => item.id)).toEqual(["audit-courrier"]);
  });

  it("filtre par utilisateur, type d'activité et période, les plus récentes d'abord", () => {
    const items = buildActivityHistoryItems(admin, data, yearData([
      log("a", secretary, { eventType: "student.updated", action: "Modification élève", createdAt: "2026-11-01T10:00:00.000Z", metadata: { changes: "Téléphone : vide → 099" } }),
      log("b", cashier, { action: "Correction paiement", createdAt: "2026-11-15T10:00:00.000Z" }),
      log("c", secretary, { action: "Création courrier", createdAt: "2026-11-20T10:00:00.000Z" }),
    ]), "admin");
    expect(items.map((item) => item.id)).toEqual(["audit-c", "audit-b", "audit-a"]);
    expect(activityHistoryActors(items)).toEqual(["Caissier A", "Secrétaire A"]);
    expect(filterActivityHistoryItems(items, { actor: "Secrétaire A" }).map((item) => item.id)).toEqual(["audit-c", "audit-a"]);
    expect(filterActivityHistoryItems(items, { type: "student" }).map((item) => item.id)).toEqual(["audit-a"]);
    expect(filterActivityHistoryItems(items, { from: "2026-11-10", to: "2026-11-15" }).map((item) => item.id)).toEqual(["audit-b"]);
    expect(filterActivityHistoryItems(items, { query: "099" }).map((item) => item.id)).toEqual(["audit-a"]);
  });

  it("le drawer affiche les activités par pages avec « Voir plus » et les filtres de l'administrateur", () => {
    const drawer = read("../components/history/ActivityHistoryContent.tsx");
    expect(ACTIVITY_HISTORY_PAGE_SIZE).toBe(30);
    expect(drawer).toContain("const shownItems = filteredItems.slice(0, visibleCount);");
    expect(drawer).toContain("Voir plus (");
    expect(drawer).toContain('aria-label="Filtrer par utilisateur"');
    expect(drawer).toContain('aria-label="Début de la période"');
    expect(drawer).toContain('<option value="student">Élèves (ajouts et modifications)</option>');
  });

  it("la fiche élève n'a plus son propre panneau d'historique", () => {
    expect(read("../components/students/StudentDetailPage.tsx")).not.toContain("StudentChangeHistory");
  });
});

describe("Paiement du caissier : bouton « Ajouter un élève »", () => {
  const control = read("../modules/control/ControlModule.tsx");
  const students = read("../modules/students/StudentsModule.tsx");
  it("tient sur une seule ligne et porte la même icône que dans l'onglet Élèves", () => {
    const button = control.slice(control.indexOf('setPaymentStudentRecord({ mode: "create" })'), control.indexOf("Ajouter un élève</button>"));
    expect(button).toContain("whitespace-nowrap");
    expect(button).not.toContain("whitespace-normal");
    expect(button).toContain("<Plus ");
    expect(students).toContain('<Plus className="h-4 w-4" /> Ajouter un élève');
    expect(control).not.toContain("UserPlus");
  });
});
