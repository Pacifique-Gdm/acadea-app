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

  it("isole les compteurs annuels et les parents liés aux élèves de l'année", () => {
    const data = dataWithUsers([
      user("admin-a", "school_admin", { activeSchoolYearId: "year-a" }),
      user("admin-b", "school_admin", { activeSchoolYearId: "year-b" }),
      user("parent-a", "parent", { activeSchoolYearId: "year-a", parentId: "parent-a" }),
      user("parent-b", "parent", { activeSchoolYearId: "year-b", parentId: "parent-b" }),
    ]);
    data.students = [
      { id: "student-a", schoolId: "school-a", schoolYearId: "year-a", matricule: "a", nom: "A", postnom: "", prenom: "A", sexe: "F", birthDate: "", address: "", phone: "", className: "1ère Primaire", parentId: "parent-a" },
      { id: "student-b", schoolId: "school-a", schoolYearId: "year-b", matricule: "b", nom: "B", postnom: "", prenom: "B", sexe: "F", birthDate: "", address: "", phone: "", className: "1ère Primaire", parentId: "parent-b" },
    ];
    data.parents = [
      { id: "parent-a", schoolId: "school-a", schoolYearId: "year-a", userId: "parent-a", fullName: "A", phone: "", email: "", address: "", studentIds: ["student-a"], status: "active" },
      { id: "parent-b", schoolId: "school-a", schoolYearId: "year-b", userId: "parent-b", fullName: "B", phone: "", email: "", address: "", studentIds: ["student-b"], status: "active" },
    ];
    expect(getPlatformSchoolStats("school-a", data, "year-a")).toMatchObject({ students: 1, parents: 1, admins: 1, users: 2 });
    expect(getPlatformSchoolStats("school-a", data, "year-b")).toMatchObject({ students: 1, parents: 1, admins: 1, users: 2 });
  });

  it("exclut les comptes retirés, Super Administrateurs et autres écoles", () => {
    const stats = getPlatformSchoolStats("school-a", dataWithUsers([
      user("removed", "school_admin", { removedAt: "2026-01-01" }), user("super", "super_admin"), user("foreign", "cashier", { schoolId: "school-b" }),
    ]));
    expect(stats.users).toBe(0);
  });
});
