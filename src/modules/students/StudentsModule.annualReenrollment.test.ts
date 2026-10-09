import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StudentsModule } from "./StudentsModule";
import { emptyStudent } from "../../utils/studentUtils";
import type { AppData, AppUser, School, SchoolYear, Student } from "../../types";

const source = readFileSync(new URL("./StudentsModule.tsx", import.meta.url), "utf8");
const drawer = readFileSync(new URL("../../components/students/ArchivedStudentsImportDrawer.tsx", import.meta.url), "utf8");
const provisioning = readFileSync(new URL("../../services/provisioning.ts", import.meta.url), "utf8");

describe("décisions annuelles terminales dans les archives", () => {
  it("n'affiche les deux actions que dans la véritable année précédente archivée", () => {
    const school: School = { id: "school", name: "École", address: "", email: "", phone: "", activeSchoolYearId: "current", status: "active", subscriptionPlan: "Starter", subscriptionAmount: 0 };
    const current: SchoolYear = { id: "current", schoolId: school.id, name: "2026-2027", startsAt: "2026-09-01", endsAt: "2027-07-01", status: "active" };
    const previous: SchoolYear = { ...current, id: "previous", name: "2025-2026", status: "archived" };
    const older: SchoolYear = { ...current, id: "older", name: "2024-2025", status: "archived" };
    const student = (year: SchoolYear, className: Student["className"]): Student => ({ ...emptyStudent(school.id, year.id), id: `student-${year.id}`, schoolYearId: year.id, matricule: `MAT-${year.id}`, nom: "NOM", prenom: "Élève", className });
    const render = (year: SchoolYear, role: AppUser["role"] = "school_admin", className: Student["className"] = "4ème Humanité", decision?: Student["terminalDecision"]) => {
      const pupil = { ...student(year, className), ...(decision ? { terminalDecision: decision } : {}) };
      const user: AppUser = { id: "admin", name: "Admin", email: "admin@example.invalid", role, schoolId: school.id, status: "active" };
      const data: AppData = { users: [user], schools: [school], schoolYears: [current, previous, older], students: [pupil], parents: [], feeTypes: [], payments: [], expenses: [], messages: [], notifications: [], auditLogs: [], valves: [], disciplineSanctions: [], attendance: [], attendanceSettings: [], biometricTerminals: [] };
      return renderToStaticMarkup(createElement(StudentsModule, { user, data, school, year, yearData: { students: [pupil], parents: [] }, updateData: () => undefined, onOpenStudent: () => undefined, uid: () => "unused", formatArchiveDate: () => "" }));
    };
    for (const role of ["school_admin", "secretary"] as const) {
      const markup = render(previous, role);
      expect(markup).toContain('aria-label="Confirmer la fin de scolarité"');
      expect(markup).toContain('aria-label="Réinscrire en 4ème Humanité"');
      expect(markup).toContain("En attente de décision");
    }
    for (const markup of [render(current), render(older), render({ ...previous, status: "draft" }), render(previous, "teacher"), render(previous, "school_admin", "3ème Humanité")]) {
      expect(markup).not.toContain('aria-label="Confirmer la fin de scolarité"');
      expect(markup).not.toContain('aria-label="Réinscrire en 4ème Humanité"');
    }
    const completed = render(previous, "school_admin", "4ème Humanité", { type: "completed", decidedBy: "admin", decidedAt: "2026-08-01", sourceSchoolYearId: "previous" });
    expect(completed).toContain("Fin de scolarité confirmée");
    expect(completed).not.toContain('aria-label="Réinscrire en 4ème Humanité"');
  });
  it("réserve les actions aux rôles Administrateur et Secrétaire de l'année précédente archivée", () => {
    expect(source).toContain("isImmediatelyPreviousArchivedYear(year, activeTargetYear)");
    expect(source).toContain('["school_admin", "secretary"].includes(user.role)');
    expect(source).toContain('canonicalAnnualClassName(student.className) !== "4ème Humanité"');
    expect(source).toContain("isEligibleForAnnualTransition(student)");
  });
  it("exige une année active et masque un élève déjà réinscrit ou décidé", () => {
    expect(source).toContain("activeTargetYear");
    expect(source).toContain("item.importedFromStudentId === student.id");
    expect(source).toContain("studentImportKey(item) === studentImportKey(student)");
    expect(source).toContain("student.terminalDecision || terminalDecisions[student.id]");
  });
  it("affiche deux icônes accessibles et une confirmation manuelle du résultat officiel", () => {
    expect(source).toContain('aria-label="Confirmer la fin de scolarité"');
    expect(source).toContain('aria-label="Réinscrire en 4ème Humanité"');
    expect(source).toContain("<GraduationCap");
    expect(source).toContain("<RefreshCw");
    expect(source).toContain("terminalExamConfirmed");
    expect(source).toContain('"CONFIRMER LA FIN DE SCOLARITE"');
    expect(source).toContain('"REINSCRIRE CET ELEVE"');
  });
  it("réutilise la réinscription serveur et ajoute la décision de fin de scolarité", () => {
    expect(provisioning).toContain('action: "reenroll-terminal-student"');
    expect(provisioning).toContain('action: "complete-terminal-student"');
    expect(source).toContain("requestTerminalStudentReenrollment");
    expect(source).toContain("requestTerminalStudentCompletion");
  });
});

describe("feedback de la transition annuelle", () => {
  it("distingue promotions, fins de cycle et élèves non réimportés", () => {
    for (const field of ["promotedCount", "terminalExitCount", "schoolCycleExitCount", "skippedCount"]) expect(drawer).toContain(field);
    expect(drawer).toContain("Transition terminée");
  });
  it("affiche les compteurs cumulés des données annuelles reconduites", () => {
    for (const field of ["studentMedicalRecords", "feeTypes", "pedagogicalAssignments", "timetableEntries"]) expect(drawer).toContain(field);
    for (const label of ["fiches médicales", "types de frais", "affectations", "créneaux d’horaire"]) expect(drawer).toContain(label);
  });
  it("déclare explicitement les historiques jamais copiés", () => {
    for (const label of ["Paiements", "présences", "notes", "cotes", "sanctions", "messages"]) expect(drawer).toContain(label);
  });
});
