import { describe, expect, it } from "vitest";
import type { AppNotification, AppUser, Message } from "../types";
import { sectionMessageVisible, sectionNotificationVisible } from "./sectionMessageVisibility";

const user: AppUser = { id: "actor", name: "Test", email: "test@example.test", role: "primary_admin", schoolId: "a", status: "active", sectionIds: ["Primaire"] };
const message: Message = { id: "m", schoolId: "a", schoolYearId: "y", senderId: "parent", participantIds: ["actor"], section: "Primaire", recipientParentId: "school", subject: "Test", body: "Test", createdAt: "2026-01-01" };
describe("section message cache boundary", () => {
  it("does not expose a former section through a personal notification preview", () => {
    const notification: AppNotification = { id: "n", schoolId: "a", schoolYearId: "y", recipientUserId: "actor", section: "Primaire", type: "message", title: "Test", body: "Test", read: false, createdAt: "2026-01-01" };
    expect(sectionNotificationVisible(user, notification)).toBe(true);
    for (const patch of [{ section: "Secondaire" as const }, { section: undefined }, { recipientUserId: "other" }, { schoolId: "b" }]) expect(sectionNotificationVisible(user, { ...notification, ...patch })).toBe(false);
    expect(sectionNotificationVisible({ ...user, sectionIds: ["Secondaire"] }, notification)).toBe(false);
  });
  it("shows only explicit participants in their current section/year/school", () => {
    expect(sectionMessageVisible(user, message, "a", "y")).toBe(true);
    for (const patch of [{ section: "Secondaire" as const }, { section: undefined }, { schoolId: "b" }, { schoolYearId: "old" }, { participantIds: [] }]) {
      expect(sectionMessageVisible(user, { ...message, ...patch }, "a", "y")).toBe(false);
    }
  });
  it("hides cached content immediately after reassignment or deactivation", () => {
    const changes: Partial<AppUser>[] = [{ sectionIds: ["Secondaire"] }, { sectionIds: [] }, { active: false }, { status: "inactive" }, { schoolId: "b" }];
    for (const patch of changes) {
      expect(sectionMessageVisible({ ...user, ...patch }, message, "a", "y")).toBe(false);
    }
  });
});
