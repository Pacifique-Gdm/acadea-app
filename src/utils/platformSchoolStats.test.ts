import { describe, expect, it } from "vitest";
import { getPlatformSchoolStats } from "./platformSchoolStats";
import type { AppData, AppUser } from "../types";

function dataWithUsers(users: AppUser[]): AppData {
  return { users, schools: [], schoolYears: [], students: [], parents: [], feeTypes: [], payments: [], expenses: [], messages: [], notifications: [], auditLogs: [], valves: [], disciplineSanctions: [], attendance: [], attendanceSettings: [], biometricTerminals: [] };
}

const user = (id: string, role: AppUser["role"], overrides: Partial<AppUser> = {}): AppUser => ({ id, name: id, email: `${id}@test.local`, role, schoolId: "school-a", status: "active", ...overrides });

describe("total des utilisateurs d'une école", () => {
  it("additionne Administrateurs, Parents, Caissiers et Directeurs de Discipline", () => {
    const stats = getPlatformSchoolStats("school-a", dataWithUsers([
      user("admin", "school_admin"), user("parent", "parent"), user("cashier", "cashier"), user("discipline", "discipline_director"),
    ]));
    expect(stats).toMatchObject({ admins: 1, users: 4 });
  });

  it("exclut les comptes retirés, Super Administrateurs et autres écoles", () => {
    const stats = getPlatformSchoolStats("school-a", dataWithUsers([
      user("removed", "school_admin", { removedAt: "2026-01-01" }), user("super", "super_admin"), user("foreign", "cashier", { schoolId: "school-b" }),
    ]));
    expect(stats.users).toBe(0);
  });
});
