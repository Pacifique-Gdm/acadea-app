import { describe, expect, it } from "vitest";
import { isPaymentRecordedNotification, resolvePaymentRecipient } from "./resolvePaymentRecipient.js";
import type { PaymentRecipientRepository } from "./resolvePaymentRecipient.js";
import type { PaymentRecordedNotification } from "./types.js";

const notification: PaymentRecordedNotification = {
  id: "notification-a",
  module: "payments",
  event: "payment_recorded",
  destination: "/dashboard",
  recipientRole: "parent",
  type: "payment",
  schoolId: "school-a",
  schoolYearId: "year-a",
  parentId: "parent-a",
  studentId: "student-a",
};

function createRepository(overrides: Partial<PaymentRecipientRepository> = {}): PaymentRecipientRepository {
  return {
    getParent: async () => ({ id: "parent-a", schoolId: "school-a", schoolYearId: "year-a", studentIds: ["student-a"], status: "active" }),
    getStudent: async () => ({ id: "student-a", schoolId: "school-a", schoolYearId: "year-a", parentId: "parent-a" }),
    findParentUsers: async () => [
      { id: "user-a", role: "parent", schoolId: "school-a", activeSchoolYearId: "year-a", parentId: "parent-a", status: "active" },
    ],
    listPushTokens: async () => [
      { id: "device-a", userId: "user-a", token: "token-a", active: true },
      { id: "device-b", userId: "user-a", token: "token-a", active: true },
      { id: "device-c", userId: "user-a", token: "token-c", active: false },
    ],
    ...overrides,
  };
}

describe("payment_recorded", () => {
  it("reconnaît uniquement l'événement structuré", () => {
    expect(isPaymentRecordedNotification(notification)).toBe(true);
    expect(isPaymentRecordedNotification({ ...notification, event: "payment_warning" })).toBe(false);
    expect(isPaymentRecordedNotification({ ...notification, destination: "/platform" })).toBe(false);
  });

  it("résout le parent actif et déduplique ses appareils", async () => {
    await expect(resolvePaymentRecipient(notification, createRepository())).resolves.toEqual([
      { userId: "user-a", tokens: [{ id: "device-a", userId: "user-a", token: "token-a", active: true }] },
    ]);
  });

  it.each([
    ["parent absent", { getParent: async () => null }],
    ["école parent incorrecte", { getParent: async () => ({ id: "parent-a", schoolId: "school-b", schoolYearId: "year-a", studentIds: ["student-a"] }) }],
    ["année parent incorrecte", { getParent: async () => ({ id: "parent-a", schoolId: "school-a", schoolYearId: "year-b", studentIds: ["student-a"] }) }],
    ["élève non lié", { getStudent: async () => ({ id: "student-a", schoolId: "school-a", schoolYearId: "year-a", parentId: "parent-b" }), getParent: async () => ({ id: "parent-a", schoolId: "school-a", schoolYearId: "year-a", studentIds: [] }) }],
    ["compte inactif", { findParentUsers: async () => [{ id: "user-a", role: "parent", schoolId: "school-a", parentId: "parent-a", status: "inactive" }] }],
    ["rôle non parent", { findParentUsers: async () => [{ id: "user-a", role: "school_admin", schoolId: "school-a", parentId: "parent-a", status: "active" }] }],
    ["autre école", { findParentUsers: async () => [{ id: "user-a", role: "parent", schoolId: "school-b", parentId: "parent-a", status: "active" }] }],
  ])("refuse %s", async (_label, overrides) => {
    await expect(resolvePaymentRecipient(notification, createRepository(overrides))).resolves.toEqual([]);
  });
});
