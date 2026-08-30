import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StudentsModule } from "./StudentsModule";
import { emptyStudent } from "../../utils/studentUtils";
import type { AppData, AppUser, School, SchoolYear } from "../../types";

describe.each([false, true])("élèves de l'année sélectionnée — coordination=%s", (coordinated) => {
  it.each(["school_admin", "secretary"] as const)("conserve la lecture et interdit les mutations du rôle %s dans l'archive", (role) => {
    const school: School = { id: "s", name: "École test", address: "", email: "", phone: "", activeSchoolYearId: "active", status: "active", subscriptionPlan: "Starter", subscriptionAmount: 0, ...(coordinated ? { activeCoordinationId: "coord" } : {}) };
    const user: AppUser = { id: role, name: "Test", email: "test@example.invalid", role, schoolId: school.id, status: "active" };
    const active: SchoolYear = { id: "active", schoolId: school.id, name: "2027-2028", status: "active", startsAt: "2027-09-01", endsAt: "2028-07-01" };
    const archived: SchoolYear = { ...active, id: "archived", name: "2026-2027", status: "archived" };
    const data: AppData = { users: [user], schools: [school], schoolYears: [active, archived],
      students: [active, archived].map((year) => ({ ...emptyStudent(school.id, year.id), id: `student-${year.id}`, nom: `NOM-${year.id}`, prenom: "Élève", matricule: `MAT-${year.id}` })),
      parents: [], feeTypes: [], payments: [], expenses: [], messages: [], notifications: [], auditLogs: [], valves: [], disciplineSanctions: [], attendance: [], attendanceSettings: [], biometricTerminals: [] };
    // Explicit Secretary capabilities must not override the archived-year lock.
    const capabilities = { canCreate: true, canEdit: true, canArchive: true, canReactivate: true, canCreateParent: true, canManageOptions: true };
    for (const year of [active, archived, active, archived]) {
      const markup = renderToStaticMarkup(createElement(StudentsModule, { user, data, school, year,
        yearData: { students: data.students.filter((student) => student.schoolYearId === year.id), parents: [] },
        updateData: vi.fn(), onOpenStudent: vi.fn(), uid: () => "unused", formatArchiveDate: () => "", capabilities }));
      expect(markup).toContain(`NOM-${year.id}`);
      expect(markup).not.toContain(`NOM-${year.id === "active" ? "archived" : "active"}`);
      expect(markup).toContain("Exporter PDF");
      if (year.status === "archived") {
        expect(markup).not.toContain("Ajouter un élève");
        expect(markup).not.toContain('title="Modifier"');
        expect(markup).not.toContain('title="Archiver"');
      } else expect(markup).toContain("Ajouter un élève");
    }
  });
});
