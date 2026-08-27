import { describe, expect, it } from "vitest";
import type { AppData, AppUser, DisciplineSanction } from "../types";
import { activityTimestamp, buildActivityHistoryItems, formatActivityDateTime, isSuperAdministratorAuditLog } from "./activityHistory";

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

describe("historique temps réel du Caissier", () => {
  const cashier: AppUser = { id: "cashier-a", name: "Caissier A", email: "cashier@example.invalid", role: "cashier", schoolId: "school-a", activeSchoolYearId: "year-a", status: "active" };
  const otherCashier: AppUser = { ...cashier, id: "cashier-b", name: "Caissier B", email: "cashier-b@example.invalid" };
  const student = { id: "student-a", schoolId: "school-a", schoolYearId: "year-a", matricule: "ELV-001", nom: "MUKENDI", postnom: "KABAMBA", prenom: "Aline", sexe: "F", birthDate: "2012-01-01", address: "", phone: "", className: "2ème Humanité" } as AppData["students"][number];
  const fee = { id: "fee-a", schoolId: "school-a", schoolYearId: "year-a", name: "Frais scolaires", amount: 100 } as AppData["feeTypes"][number];
  const ownPayment = { id: "payment-a", schoolId: "school-a", schoolYearId: "year-a", studentId: student.id, feeTypeId: fee.id, amount: 40, paidAt: "2026-08-12", createdAt: "2026-08-12T12:00:00.000Z", createdBy: cashier.id, cashierName: cashier.name, receiptNumber: "REC-001" } as AppData["payments"][number];
  const ownExpense = { id: "expense-a", schoolId: "school-a", schoolYearId: "year-a", amount: 15, category: "Fournitures", description: "Craies", spentAt: "2026-08-12", createdAt: "2026-08-12T11:00:00.000Z", createdBy: cashier.id, cashierName: cashier.name } as AppData["expenses"][number];
  const otherPayment = { ...ownPayment, id: "payment-b", createdBy: otherCashier.id, cashierName: otherCashier.name, createdAt: "2026-08-12T13:00:00.000Z" };
  const scopedData = { ...data, users: [cashier, otherCashier], students: [student], feeTypes: [fee], payments: [ownPayment, otherPayment], expenses: [ownExpense] };

  it("affiche immédiatement les paiements et dépenses propres issus des listeners métier", () => {
    const items = buildActivityHistoryItems(cashier, scopedData, {
      students: [student], parents: [], users: scopedData.users, feeTypes: [fee], payments: [ownPayment, otherPayment], expenses: [ownExpense], messages: [], disciplineSanctions: [], auditLogs: [],
    }, "cashier");

    expect(items.map((item) => item.id)).toEqual(["payment-payment-a", "expense-expense-a"]);
    expect(items.map((item) => item.type)).toEqual(["payment", "expense"]);
    expect(items.some((item) => item.id === "payment-payment-b")).toBe(false);
  });

  it("remplace l'audit serveur par la ligne métier détaillée sans doublon", () => {
    const items = buildActivityHistoryItems(cashier, scopedData, {
      students: [student], parents: [], users: scopedData.users, feeTypes: [fee], payments: [ownPayment], expenses: [], messages: [], disciplineSanctions: [], auditLogs: [
        { id: "audit-payment", schoolId: "school-a", schoolYearId: "year-a", actorId: cashier.id, actorRole: "cashier", actorName: cashier.name, resourceType: "payment", resourceId: ownPayment.id, action: "Création paiement", details: "Création paiement", createdAt: "2026-08-12T12:00:00.000Z" },
      ],
    }, "cashier");

    expect(items.map((item) => item.id)).toEqual(["payment-payment-a"]);
  });

  it("conserve un audit historique lorsque la donnée métier correspondante n'est pas disponible", () => {
    const items = buildActivityHistoryItems(cashier, scopedData, {
      students: [student], parents: [], users: scopedData.users, feeTypes: [fee], payments: [], expenses: [], messages: [], disciplineSanctions: [], auditLogs: [
        { id: "legacy-payment", schoolId: "school-a", actorId: cashier.id, actorName: cashier.name, action: "Création paiement", createdAt: "2025-08-12T10:00:00.000Z" },
      ],
    }, "cashier");

    expect(items.map((item) => item.id)).toEqual(["audit-legacy-payment"]);
  });

  it("affiche les messages envoyés ou reçus par le Caissier", () => {
    const items = buildActivityHistoryItems(cashier, scopedData, {
      students: [], parents: [], users: scopedData.users, feeTypes: [], payments: [], expenses: [], disciplineSanctions: [], auditLogs: [], messages: [
        { id: "message-a", schoolId: "school-a", schoolYearId: "year-a", senderId: otherCashier.id, participantIds: [otherCashier.id, cashier.id], recipientParentId: "school", subject: "Test", body: "Test", createdAt: "2026-08-12T14:00:00.000Z" },
      ],
    }, "cashier");

    expect(items).toEqual([expect.objectContaining({ id: "message-message-a", type: "message", title: "Message reçu" })]);
  });
});

describe("compatibilité des historiques Firestore", () => {
  it("rend un audit historique sans année dont createdAt est un Timestamp Firestore", () => {
    const legacyAudit = {
      id: "legacy-audit",
      schoolId: "school-a",
      actorId: admin.id,
      actorName: admin.name,
      eventType: "Modification élève",
      createdAt: { toDate: () => new Date("2026-08-12T12:00:00.000Z") },
    } as unknown as AppData["auditLogs"][number];
    const items = buildActivityHistoryItems(admin, data, {
      students: [], parents: [], users: data.users, feeTypes: [], payments: [], expenses: [], messages: [], disciplineSanctions: [], auditLogs: [legacyAudit],
    }, "admin");

    expect(items).toEqual([expect.objectContaining({
      id: "audit-legacy-audit",
      title: "Modification élève",
      createdAt: "2026-08-12T12:00:00.000Z",
    })]);
  });

  it("trie sans exception ISO, Timestamp toMillis, Date, nombre et valeur absente", () => {
    const audits = [
      { id: "iso", createdAt: "2026-08-12T10:00:00.000Z" },
      { id: "timestamp", createdAt: { toMillis: () => Date.parse("2026-08-12T12:00:00.000Z") } },
      { id: "date", createdAt: new Date("2026-08-12T11:00:00.000Z") },
      { id: "number", createdAt: Date.parse("2026-08-12T09:00:00.000Z") },
      { id: "missing", createdAt: undefined },
      { id: "null", createdAt: null },
    ].map((item) => ({ ...item, schoolId: "school-a", actorId: admin.id, actorName: admin.name, action: `Action ${item.id}` })) as unknown as AppData["auditLogs"];
    const items = buildActivityHistoryItems(admin, data, {
      students: [], parents: [], users: data.users, feeTypes: [], payments: [], expenses: [], messages: [], disciplineSanctions: [], auditLogs: audits,
    }, "admin");

    expect(items.map((item) => item.id)).toEqual(["audit-timestamp", "audit-date", "audit-iso", "audit-number", "audit-missing", "audit-null"]);
    expect(activityTimestamp({ toDate: () => new Date("2026-08-12T08:00:00.000Z") })).toBe(Date.parse("2026-08-12T08:00:00.000Z"));
    expect(formatActivityDateTime(undefined)).toBe("Date inconnue");
  });
});

describe("historique Coordination", () => {
  it("identifie les audits Super Administrateur sans masquer les autres acteurs", () => {
    const base = { id: "audit", actorId: "actor", actorName: "Utilisateur", action: "Modification", createdAt: "2026-08-12T10:00:00.000Z" };
    expect(isSuperAdministratorAuditLog({ ...base, actorRole: "super_admin" })).toBe(true);
    expect(isSuperAdministratorAuditLog({ ...base, actorName: "Super Administrateur" })).toBe(true);
    expect(isSuperAdministratorAuditLog({ ...base, details: "Opération réalisée par le super admin" })).toBe(true);
    expect(isSuperAdministratorAuditLog({ ...base, actorRole: "coordination_admin", actorName: "Coordinateur" })).toBe(false);
    expect(isSuperAdministratorAuditLog({ ...base, actorRole: "school_admin", actorName: "Administrateur école" })).toBe(false);
  });
});
