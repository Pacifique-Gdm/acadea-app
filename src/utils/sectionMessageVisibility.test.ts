import { describe, expect, it } from "vitest";
import type { AppUser, Message } from "../types";
import { sectionMessageVisible } from "./sectionMessageVisibility";

const user: AppUser = { id: "actor", name: "Test", email: "test@example.test", role: "primary_admin", schoolId: "a", status: "active", sectionIds: ["Primaire"] };
const message: Message = { id: "m", schoolId: "a", schoolYearId: "y", senderId: "parent", participantIds: ["actor"], section: "Primaire", recipientParentId: "school", subject: "Test", body: "Test", createdAt: "2026-01-01" };
describe("section message cache boundary", () => {
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
