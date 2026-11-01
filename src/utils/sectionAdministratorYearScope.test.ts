import { describe, expect, it } from "vitest";
import type { AppData, AppUser } from "../types";
import { isSectionAdministratorRole, sectionAdministratorQuerySections, sectionAdministratorYearScope } from "./sectionAdministratorYearScope";

const actor = { id: "primary-a", role: "primary_admin", schoolId: "school-a", status: "active", active: true, sectionIds: ["Primaire"] } as AppUser;
const student = (id: string, section?: string, schoolId = "school-a") => ({ id, schoolId, schoolYearId: "year-a", section });
const data = {
  users: [{ id: "primary-a", schoolId: "school-a" }, { id: "other", schoolId: "school-a" }],
  students: [student("primary", "Primaire"), student("secondary", "Secondaire"), student("unknown"), student("other-school", "Primaire", "school-b")],
  parents: [
    { id: "own", schoolId: "school-a", schoolYearId: "year-a", studentIds: ["primary"] },
    { id: "mixed", schoolId: "school-a", schoolYearId: "year-a", studentIds: ["primary", "secondary"] },
    { id: "unattributed", schoolId: "school-a", schoolYearId: "year-a", studentIds: [] },
  ],
  payments: ["primary", "secondary", "unknown", "other-school"].map((studentId) => ({ id: studentId, schoolId: "school-a", schoolYearId: "year-a", studentId })),
  expenses: [{ id: "expense", schoolId: "school-a", schoolYearId: "year-a" }],
  cashInflows: [{ id: "inflow", schoolId: "school-a", schoolYearId: "year-a" }],
  feeTypes: [{ id: "fee", schoolId: "school-a", schoolYearId: "year-a" }],
  auditLogs: [{ id: "log", schoolId: "school-a" }],
  messages: [{ id: "message", schoolId: "school-a", schoolYearId: "year-a" }],
  valves: ["Primaire", "Secondaire", "all_parents"].map((visibility) => ({ id: visibility, schoolId: "school-a", schoolYearId: "year-a", visibility })),
  disciplineSanctions: ["primary", "secondary"].map((studentId) => ({ id: studentId, schoolId: "school-a", schoolYearId: "year-a", studentId })),
  attendance: ["primary", "secondary"].map((studentId) => ({ id: studentId, schoolId: "school-a", schoolYearId: "year-a", studentId })),
  attendanceSettings: [{ id: "settings", schoolId: "school-a", schoolYearId: "year-a" }],
  notifications: [
    { id: "own", schoolId: "school-a", schoolYearId: "year-a", studentId: "primary" },
    { id: "other", schoolId: "school-a", schoolYearId: "year-a", studentId: "secondary" },
    { id: "message", schoolId: "school-a", schoolYearId: "year-a", studentId: "primary", messageId: "message" },
  ],
} as unknown as AppData;

describe("section administrator display boundary", () => {
  it("conserve les arriérés seulement si les deux dossiers élèves sont dans le périmètre", () => {
    const old = { ...data.students[0], id: "old", schoolYearId: "previous" };
    const payment = { ...data.payments[0], id: "arrears", schoolYearId: "previous", collectionSchoolYearId: "year-a", studentId: "old", currentStudentId: "primary" };
    const source = { ...data, students: [...data.students, old], payments: [payment] };
    expect(sectionAdministratorYearScope(source, actor, "school-a", "year-a").payments).toEqual([payment]);
    expect(sectionAdministratorYearScope(source, actor, "school-a", "year-a").students.map((item) => item.id)).toEqual(["primary"]);
    for (const section of [undefined, "Secondaire"] as const) {
      expect(sectionAdministratorYearScope({ ...source, students: [...data.students, { ...old, section }] }, actor, "school-a", "year-a").payments).toEqual([]);
    }
    expect(sectionAdministratorYearScope({ ...source, payments: [{ ...payment, currentStudentId: "secondary" }] }, actor, "school-a", "year-a").payments).toEqual([]);
  });
  it.each(["kindergarten_admin", "primary_admin", "studies_prefect"] as const)("identifies %s without treating school_admin as scoped", (role) => {
    expect(isSectionAdministratorRole(role)).toBe(true);
    expect(isSectionAdministratorRole("school_admin")).toBe(false);
  });
  it("excludes other schools, sections and unattributed records across all displayed collections", () => {
    const scoped = sectionAdministratorYearScope(data, actor, "school-a", "year-a");
    expect(scoped.students.map((item) => item.id)).toEqual(["primary"]);
    expect(scoped.parents).toEqual([]);
    expect(scoped.users.map((item) => item.id)).toEqual(["primary-a"]);
    expect(scoped.payments.map((item) => item.id)).toEqual(["primary"]);
    expect(scoped.valves.map((item) => item.id)).toEqual(["Primaire"]);
    expect(scoped.disciplineSanctions.map((item) => item.id)).toEqual(["primary"]);
    expect(scoped.attendance.map((item) => item.id)).toEqual(["primary"]);
    expect(scoped.notifications.map((item) => item.id)).toEqual(["own"]);
    expect(scoped.feeTypes.map((item) => item.id)).toEqual(["fee"]);
    for (const key of ["expenses", "cashInflows", "auditLogs", "messages", "attendanceSettings"] as const) expect(scoped[key]).toEqual([]);
  });
  it("accepts a second explicitly assigned section but never an unknown or foreign school", () => {
    const multi = sectionAdministratorYearScope(data, { ...actor, sectionIds: ["Primaire", "Secondaire"] }, "school-a", "year-a");
    expect(multi.students.map((item) => item.id)).toEqual(["primary", "secondary"]);
    for (const user of [{ ...actor, sectionIds: [] }, { ...actor, sectionIds: ["Primaire", "wrong"] }, { ...actor, schoolId: "school-b" }, { ...actor, status: "inactive" }]) {
      const denied = sectionAdministratorYearScope(data, user as AppUser, "school-a", "year-a");
      expect(denied.students).toEqual([]);
      expect(denied.payments).toEqual([]);
    }
  });
  it("refuse une requête de messagerie avec compte révoqué, école étrangère ou section invalide", () => {
    expect(sectionAdministratorQuerySections(actor, "school-a")).toEqual(["Primaire"]);
    expect(sectionAdministratorQuerySections({ ...actor, sectionIds: ["Primaire", "CTEB", "Primaire"] }, "school-a")).toEqual(["Primaire", "CTEB"]);
    for (const user of [{ ...actor, active: false }, { ...actor, status: "inactive" }, { ...actor, sectionIds: [] },
      { ...actor, sectionIds: ["inconnue"] }, { ...actor, schoolId: "school-b" }]) {
      expect(() => sectionAdministratorQuerySections(user as AppUser, "school-a")).toThrow();
    }
  });
});
