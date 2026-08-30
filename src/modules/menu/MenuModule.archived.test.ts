import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MenuModule } from "./MenuModule";
import type { AppData, AppUser, School, SchoolYear } from "../../types";

describe("consultation du menu d'une année archivée", () => {
  it.each([false, true])("conserve les rubriques de lecture, coordination=%s", (coordinated) => {
    const year: SchoolYear = { id: "old-year", schoolId: "school-a", name: "2025-2026", startsAt: "2025-09-01", endsAt: "2026-07-01", status: "archived" };
    const school: School = { id: "school-a", name: "École de test", address: "", email: "", phone: "", activeSchoolYearId: "new-year", status: "active", subscriptionPlan: "Starter", subscriptionAmount: 0, ...(coordinated ? { activeCoordinationId: "coordination-a" } : {}) };
    const user: AppUser = { id: "admin-a", name: "Admin test", email: "admin@example.invalid", role: "school_admin", schoolId: school.id, status: "active" };
    const data: AppData = { users: [user], schools: [school], schoolYears: [year], students: [], parents: [], feeTypes: [], payments: [], expenses: [], messages: [], notifications: [], auditLogs: [], valves: [], disciplineSanctions: [], attendance: [], attendanceSettings: [], biometricTerminals: [] };
    const markup = renderToStaticMarkup(createElement(MenuModule, {
      user, data, school, years: [year], selectedYear: year, yearData: data,
      onYearChange: vi.fn(), updateData: vi.fn(), onLogout: vi.fn(), valvesUploadsEnabled: true,
      onCreateParentFromDirectory: vi.fn(), onEditParentFromDirectory: vi.fn(), createId: () => "test-id",
      nextSchoolYearDefaults: () => ({ name: "2027-2028", startsAt: "", endsAt: "" }), schoolEducationLevelChoices: [],
      feeTargetHasOption: () => false, formatFeeTargetLabel: () => "Classe test", renderFinancialReport: () => null,
      renderActivityHistory: () => null, maxValveDocumentBytes: 1000, onOpenBiometrics: vi.fn(),
    }));
    for (const title of ["Valves", "Fiches médicales", "Parents / Tuteurs", "Types de frais", "Rapport financier", "Personnels", "Années scolaires", "Historique"]) {
      expect(markup, title).toContain(title);
    }
    expect(markup).not.toContain("Créer un utilisateur");
  });
});
