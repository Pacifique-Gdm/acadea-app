import { describe, expect, it, vi } from "vitest";
import { isOperationalNotification, resolveOperationalRecipients } from "./resolveOperationalRecipients.js";

function repository() {
  return {
    getAttendance: vi.fn(async () => ({ id: "attendance-a", schoolId: "school-a", schoolYearId: "year-a", studentId: "student-a", status: "absent" })),
    getDiscipline: vi.fn(async () => ({ id: "sanction-a", schoolId: "school-a", schoolYearId: "year-a", studentId: "student-a" })),
    getAnnouncement: vi.fn(async () => ({ id: "announcement-a", schoolId: "school-a", schoolYearId: "year-a", visibility: "all_parents" })),
    getStudent: vi.fn(async () => ({ id: "student-a", schoolId: "school-a", schoolYearId: "year-a", parentId: "parent-a", className: "1ère Primaire" })),
    getParent: vi.fn(async () => ({ id: "parent-a", schoolId: "school-a", schoolYearId: "year-a", studentIds: ["student-a"], status: "active" })),
    findParentUsers: vi.fn(async () => [{ id: "parent-user", role: "parent", parentId: "parent-a", schoolId: "school-a", activeSchoolYearId: "year-a", status: "active" }]),
    findSchoolUsers: vi.fn(async (_school: string, roles: string[]) => [
      ...roles.map((role) => ({ id: `${role}-user`, role, schoolId: "school-a", activeSchoolYearId: "year-a", status: "active" })),
      { id: "inactive", role: roles[0], schoolId: "school-a", status: "inactive" },
      { id: "super", role: "super_admin", schoolId: "school-a", status: "active" },
      { id: "foreign", role: roles[0], schoolId: "school-b", status: "active" },
    ]),
    listPushTokens: vi.fn(async (userId: string) => [
      { id: `${userId}-a`, userId, token: `${userId}-token`, active: true },
      { id: `${userId}-b`, userId, token: `${userId}-token`, active: true },
    ]),
  };
}

const attendance = { id: "notif-a", module: "attendance" as const, event: "student_absent" as const, attendanceId: "attendance-a", studentId: "student-a", parentId: "parent-a", schoolId: "school-a", schoolYearId: "year-a" };

describe("résolution des notifications opérationnelles", () => {
  it.each([["student_absent", "absent"], ["student_late", "late"]] as const)("valide %s avec le document exact", async (event, status) => {
    const repo = repository();
    repo.getAttendance.mockResolvedValue({ id: "attendance-a", schoolId: "school-a", schoolYearId: "year-a", studentId: "student-a", status });
    const result = await resolveOperationalRecipients({ ...attendance, event }, repo);
    expect(result?.event).toBe(event);
    expect(result?.recipients).toHaveLength(1);
    expect(result?.recipients[0]?.tokens).toHaveLength(1);
  });

  it("rejette les données incomplètes et les incohérences d'élève, école, année ou Parent", async () => {
    expect(isOperationalNotification({ ...attendance, attendanceId: undefined })).toBe(false);
    for (const change of [{ attendanceId: "other" }, { studentId: "other" }, { schoolId: "other" }, { schoolYearId: "other" }, { parentId: "other" }]) {
      await expect(resolveOperationalRecipients({ ...attendance, ...change }, repository())).resolves.toBeNull();
    }
  });

  it("valide la sanction exacte et la relation Parent-élève", async () => {
    const result = await resolveOperationalRecipients({ id: "notif-d", module: "discipline", event: "discipline_incident_created", disciplineSanctionId: "sanction-a", studentId: "student-a", parentId: "parent-a", schoolId: "school-a", schoolYearId: "year-a" }, repository());
    expect(result?.event).toBe("discipline_incident_created");
    const repo = repository();
    repo.getDiscipline.mockResolvedValue({ id: "other", schoolId: "school-a", schoolYearId: "year-a", studentId: "student-a" });
    await expect(resolveOperationalRecipients({ id: "notif-d", module: "discipline", event: "discipline_incident_created", disciplineSanctionId: "sanction-a", studentId: "student-a", parentId: "parent-a", schoolId: "school-a", schoolYearId: "year-a" }, repo)).resolves.toBeNull();
  });

  it.each([["parent", ["parent-user"]], ["cashier", ["cashier-user"]], ["school_admin", ["school_admin-user"]], ["discipline_director", ["discipline_director-user"]]] as const)("respecte l'audience %s", async (role, expected) => {
    const notification = { id: "notif-v", module: "announcements" as const, event: "announcement_published" as const, announcementId: "announcement-a", schoolId: "school-a", schoolYearId: "year-a", audienceRoles: [role], audienceParentIds: role === "parent" ? ["parent-a"] : [], audienceSchoolWide: false };
    const result = await resolveOperationalRecipients(notification, repository());
    expect(result?.recipients.map((item) => item.userId)).toEqual(expected);
  });

  it("étend uniquement l'audience scolaire explicitement déclarée", async () => {
    const notification = { id: "notif-v", module: "announcements" as const, event: "announcement_published" as const, announcementId: "announcement-a", schoolId: "school-a", schoolYearId: "year-a", audienceRoles: ["parent", "cashier"], audienceParentIds: [], audienceSchoolWide: true };
    const repo = repository();
    const result = await resolveOperationalRecipients(notification, repo);
    expect(repo.findSchoolUsers).toHaveBeenCalledWith("school-a", ["parent", "cashier"]);
    expect(result?.recipients.map((item) => item.userId)).toEqual(["parent-user", "cashier-user"]);
  });

  it("rejette un identifiant d'annonce incohérent, un rôle inconnu et le Super Administrateur", async () => {
    const base = { id: "notif-v", module: "announcements" as const, event: "announcement_published" as const, announcementId: "announcement-a", schoolId: "school-a", schoolYearId: "year-a", audienceRoles: ["cashier"], audienceParentIds: [], audienceSchoolWide: false };
    const repo = repository();
    repo.getAnnouncement.mockResolvedValue({ id: "other", schoolId: "school-a", schoolYearId: "year-a", visibility: "all_parents" });
    await expect(resolveOperationalRecipients(base, repo)).resolves.toBeNull();
    await expect(resolveOperationalRecipients({ ...base, audienceRoles: ["super_admin"] }, repository())).resolves.toBeNull();
  });
});
