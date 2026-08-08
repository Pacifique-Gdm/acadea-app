import { describe, expect, it, vi } from "vitest";
import { isMessageNotification, resolveMessageRecipients } from "./resolveMessageRecipients.js";
import type { MessageNotificationRecord } from "./types.js";

const parentNotification: MessageNotificationRecord = {
  id: "notif-1", type: "message", recipientRole: "parent", schoolId: "school-a", schoolYearId: "year-a", parentId: "parent-a", messageId: "message-a",
};

function repository(direction: "parent" | "school" = "parent") {
  const message = direction === "parent"
    ? { id: "message-a", schoolId: "school-a", schoolYearId: "year-a", senderId: "admin-a", recipientParentId: "parent-a", threadParentId: "parent-a", threadId: "thread-a", schoolRecipient: "admin" as const }
    : { id: "message-a", schoolId: "school-a", schoolYearId: "year-a", senderId: "parent-user", recipientParentId: "school", threadParentId: "parent-a", threadId: "thread-a", schoolRecipient: "admin" as const };
  return {
    getMessage: vi.fn(async () => message),
    getParent: vi.fn(async () => ({ id: "parent-a", schoolId: "school-a", schoolYearId: "year-a", status: "active" })),
    getUser: vi.fn(async (id: string) => id === "parent-user"
      ? { id, role: "parent", parentId: "parent-a", schoolId: "school-a", activeSchoolYearId: "year-a", status: "active" }
      : { id, role: "school_admin", schoolId: "school-a", activeSchoolYearId: "year-a", status: "active" }),
    findParentUsers: vi.fn(async () => [
      { id: "parent-user", role: "parent", parentId: "parent-a", schoolId: "school-a", activeSchoolYearId: "year-a", status: "active" },
      { id: "other-parent", role: "parent", parentId: "parent-b", schoolId: "school-a", status: "active" },
    ]),
    findSchoolUsers: vi.fn(async (_schoolId: string, roles: string[]) => [
      ...roles.map((role) => ({ id: `${role}-user`, role, schoolId: "school-a", activeSchoolYearId: "year-a", status: "active" })),
      { id: "super", role: "super_admin", schoolId: "school-a", status: "active" },
      { id: "inactive", role: roles[0], schoolId: "school-a", status: "inactive" },
      { id: "other-school", role: roles[0], schoolId: "school-b", status: "active" },
    ]),
    listPushTokens: vi.fn(async (userId: string) => [
      { id: `${userId}-1`, userId, token: `${userId}-token`, active: true },
      { id: `${userId}-duplicate`, userId, token: `${userId}-token`, active: true },
      { id: `${userId}-foreign`, userId: "foreign", token: "foreign-token", active: true },
    ]),
  };
}

describe("notifications de messagerie", () => {
  it("reconnaît strictement les deux directions", () => {
    expect(isMessageNotification(parentNotification)).toBe(true);
    expect(isMessageNotification({ ...parentNotification, recipientRole: "school", parentId: undefined, schoolRecipient: "cashier" })).toBe(true);
    expect(isMessageNotification({ ...parentNotification, type: "payment" })).toBe(false);
    expect(isMessageNotification({ ...parentNotification, messageId: undefined })).toBe(false);
    expect(isMessageNotification({ ...parentNotification, module: "discipline", disciplineSanctionId: "sanction-a" })).toBe(false);
    expect(isMessageNotification({ ...parentNotification, disciplineSanctionId: "sanction-a" })).toBe(false);
  });

  it("cible uniquement le compte du Parent exact et déduplique ses tokens", async () => {
    const result = await resolveMessageRecipients(parentNotification, repository());
    expect(result?.event).toBe("school_message_received");
    expect(result?.recipients).toEqual([{ userId: "parent-user", tokens: [{ id: "parent-user-1", userId: "parent-user", token: "parent-user-token", active: true }] }]);
  });

  it.each([
    ["école", { schoolId: "school-b" }],
    ["année", { schoolYearId: "year-b" }],
    ["parent", { parentId: "parent-b" }],
  ])("rejette une incohérence de %s", async (_label, change) => {
    await expect(resolveMessageRecipients({ ...parentNotification, ...change }, repository())).resolves.toBeNull();
  });

  it("rejette les données anciennes incomplètes et les comptes inactifs", async () => {
    const missingThread = repository();
    missingThread.getMessage.mockResolvedValue({ ...await missingThread.getMessage(), threadId: undefined } as never);
    await expect(resolveMessageRecipients(parentNotification, missingThread)).resolves.toBeNull();
    const inactive = repository();
    inactive.getParent.mockResolvedValue({ id: "parent-a", schoolId: "school-a", schoolYearId: "year-a", status: "inactive" });
    await expect(resolveMessageRecipients(parentNotification, inactive)).resolves.toBeNull();
  });

  it.each([
    ["admin", ["school_admin"]],
    ["cashier", ["cashier"]],
    ["discipline", ["discipline_director"]],
    ["both", ["school_admin", "cashier"]],
  ] as const)("applique exactement le mapping %s", async (schoolRecipient, expectedRoles) => {
    const repo = repository("school");
    repo.getMessage.mockResolvedValue({ ...await repo.getMessage(), schoolRecipient } as never);
    const notification = { ...parentNotification, recipientRole: "school" as const, parentId: undefined, schoolRecipient };
    const result = await resolveMessageRecipients(notification, repo);
    expect(repo.findSchoolUsers).toHaveBeenCalledWith("school-a", [...expectedRoles]);
    expect(result?.recipients.map((item) => item.userId)).toEqual(expectedRoles.map((role) => `${role}-user`));
    expect(result?.recipients.map((item) => item.userId)).not.toContain("super");
  });
  it("cible uniquement l'utilisateur explicitement selectionne par le Parent", async () => {
    const repo = repository("school");
    repo.getMessage.mockResolvedValue({ ...await repo.getMessage(), recipientIds: ["school_admin-user"] } as never);
    const notification = { ...parentNotification, recipientRole: "school" as const, parentId: undefined, recipientUserId: "school_admin-user" };
    const result = await resolveMessageRecipients(notification, repo);
    expect(repo.findSchoolUsers).not.toHaveBeenCalled();
    expect(result?.recipients.map((item) => item.userId)).toEqual(["school_admin-user"]);
  });
});
