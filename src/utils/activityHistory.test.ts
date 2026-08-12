import { describe, expect, it } from "vitest";
import type { AppData, AppUser, DisciplineSanction } from "../types";
import { buildActivityHistoryItems } from "./activityHistory";

const admin: AppUser = { id: "admin-a", name: "Admin", email: "admin@example.invalid", role: "school_admin", schoolId: "school-a", activeSchoolYearId: "year-a", status: "active" };
const discipline: AppUser = { id: "discipline-a", name: "Discipline", email: "discipline@example.invalid", role: "discipline_director", schoolId: "school-a", activeSchoolYearId: "year-a", status: "active" };
const sanction: DisciplineSanction = { id: "sanction-a", schoolId: "school-a", schoolYearId: "year-a", studentId: "student-a", studentName: "Élève Test", className: "6ème Primaire", reason: "Retards", description: "Retards répétés", sanctionType: "Avertissement", duration: 1, startDate: "2026-08-01", expectedEndDate: "2026-08-02", status: "active", recurrenceNumber: 1, createdBy: discipline.id, createdByName: discipline.name, createdAt: "2026-08-01T08:00:00.000Z" };
const data: AppData = { users: [admin, discipline], schools: [], schoolYears: [], students: [], parents: [], feeTypes: [], payments: [], expenses: [], messages: [], notifications: [], auditLogs: [], valves: [], disciplineSanctions: [], attendance: [], attendanceSettings: [], biometricTerminals: [] };

describe("historique Administrateur des sanctions", () => {
  it("affiche la sanction tenantée et les audits de clôture du Directeur de discipline", () => {
    const items = buildActivityHistoryItems(admin, data, {
      students: [], parents: [], users: data.users, feeTypes: [], payments: [], expenses: [], messages: [],
      disciplineSanctions: [sanction],
      auditLogs: [{ id: "audit-close", schoolId: "school-a", schoolYearId: "year-a", actorId: discipline.id, actorName: discipline.name, action: "Clôture sanction disciplinaire", details: "Élève Test", createdAt: "2026-08-02T09:00:00.000Z" }],
    }, "admin");
    expect(items.map((item) => item.type)).toEqual(["discipline", "discipline"]);
    expect(items[1]?.details).toContain("Identifiant : sanction-a");
    expect(items[1]?.details).toContain("École : school-a");
  });

  it("ne mélange pas les sanctions absentes des données annuelles déjà bornées", () => {
    const items = buildActivityHistoryItems(admin, data, { students: [], parents: [], users: data.users, feeTypes: [], payments: [], expenses: [], messages: [], disciplineSanctions: [], auditLogs: [] }, "admin");
    expect(items).toEqual([]);
  });
});

describe("historique personnel Secrétaire", () => {
  it("n'affiche que les audits du Secrétaire connecté", () => {
    const secretary: AppUser = { id: "secretary-a", name: "Secrétaire A", email: "secretary@example.invalid", role: "secretary", schoolId: "school-a", activeSchoolYearId: "year-a", status: "active" };
    const other: AppUser = { ...secretary, id: "secretary-b", name: "Secrétaire B", email: "secretary-b@example.invalid" };
    const scopedData = { ...data, users: [secretary, other] };
    const items = buildActivityHistoryItems(secretary, scopedData, { students: [], parents: [], users: scopedData.users, feeTypes: [], payments: [], expenses: [], messages: [], disciplineSanctions: [], auditLogs: [
      { id: "own", schoolId: "school-a", schoolYearId: "year-a", actorId: secretary.id, actorName: secretary.name, action: "Création courrier", createdAt: "2026-08-12T10:00:00.000Z" },
      { id: "other", schoolId: "school-a", schoolYearId: "year-a", actorId: other.id, actorName: other.name, action: "Création rapport", createdAt: "2026-08-12T11:00:00.000Z" },
    ] }, "secretary");
    expect(items.map((item) => item.id)).toEqual(["audit-own"]);
  });
});
