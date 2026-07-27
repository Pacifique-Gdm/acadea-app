import { describe, expect, it } from "vitest";
import type { AppUser } from "../types";
import { canOpenMessageDeepLink, canOpenOperationalDeepLink, resolveMessagePushDestination, resolveOperationalPushDestination, resolvePaymentRecordedDestination } from "./pushNotificationRoutes";

const parent: AppUser = {
  id: "user-parent-a",
  name: "Parent A",
  email: "parent@example.test",
  role: "parent",
  schoolId: "school-a",
  activeSchoolYearId: "year-a",
  parentId: "parent-a",
  studentIds: ["student-a"],
  status: "active",
};

const payload = {
  module: "payments" as const,
  event: "payment_recorded" as const,
  destination: "/dashboard" as const,
  notificationId: "notification-a",
  schoolId: "school-a",
  schoolYearId: "year-a",
  parentId: "parent-a",
  studentId: "student-a",
};

describe("resolvePaymentRecordedDestination", () => {
  it("autorise uniquement le parent concerné", () => {
    expect(resolvePaymentRecordedDestination(parent, payload)).toBe("/dashboard");
  });

  it.each([
    [{ ...parent, role: "cashier" as const }, payload],
    [{ ...parent, status: "inactive" as const }, payload],
    [parent, { ...payload, schoolId: "school-b" }],
    [parent, { ...payload, schoolYearId: "year-b" }],
    [parent, { ...payload, parentId: "parent-b" }],
    [parent, { ...payload, studentId: "student-b" }],
    [parent, { ...payload, event: "unknown" }],
  ])("refuse une identité ou une destination non autorisée", (user, pushData) => {
    expect(resolvePaymentRecordedDestination(user, pushData)).toBeNull();
  });
});

describe("routes opérationnelles", () => {
  const parent = { id: "parent-user", name: "Parent", email: "p@test", role: "parent" as const, schoolId: "school-a", activeSchoolYearId: "year-a", parentId: "parent-a", status: "active" as const };
  const common = { destination: "/dashboard", notificationId: "notif", schoolId: "school-a", schoolYearId: "year-a", studentId: "student-a", parentId: "parent-a" };

  it.each([
    [{ ...common, module: "attendance", event: "student_absent", attendanceId: "attendance-a" }, "/dashboard?push=attendance&attendanceId=attendance-a"],
    [{ ...common, module: "attendance", event: "student_late", attendanceId: "attendance-a" }, "/dashboard?push=attendance&attendanceId=attendance-a"],
    [{ ...common, module: "discipline", event: "discipline_incident_created", disciplineSanctionId: "sanction-a" }, "/dashboard?push=discipline&disciplineSanctionId=sanction-a"],
    [{ ...common, module: "announcements", event: "announcement_published", announcementId: "announcement-a" }, "/dashboard?push=announcement&announcementId=announcement-a"],
  ])("accepte uniquement la destination fixe", (payload, route) => {
    expect(resolveOperationalPushDestination(parent, payload)).toBe(route);
    expect(resolveOperationalPushDestination(parent, { ...payload, destination: "https://evil.test" })).toBeNull();
  });

  it("valide la ressource et renvoie implicitement au dashboard lorsqu'elle est inaccessible", () => {
    const notification = { id: "notif", schoolId: "school-a", schoolYearId: "year-a", parentId: "parent-a", studentId: "student-a", attendanceId: "attendance-a", module: "attendance" as const, event: "student_absent" as const, type: "attendance" as const, title: "", body: "", createdAt: "", read: false };
    const attendance = { id: "attendance-a", schoolId: "school-a", schoolYearId: "year-a", studentId: "student-a", attendanceDate: "2026-01-01", status: "absent" as const, recordedAt: "", recordedBy: "", source: "manual" as const };
    const student = { id: "student-a", schoolId: "school-a", schoolYearId: "year-a", parentId: "parent-a" } as never;
    expect(canOpenOperationalDeepLink(parent, notification, attendance, student)).toBe(true);
    expect(canOpenOperationalDeepLink({ ...parent, parentId: "parent-b" }, notification, attendance, student)).toBe(false);
  });
});

describe("resolveMessagePushDestination", () => {
  const message = { id: "message-a", schoolId: "school-a", schoolYearId: "year-a", senderId: "admin-a", recipientParentId: "parent-a", threadParentId: "parent-a", threadId: "thread-a", schoolRecipient: "admin" as const, subject: "Sujet", body: "Secret", createdAt: "2026-01-01" };
  const payload = { module: "messages", event: "school_message_received", destination: "/dashboard", notificationId: "notif-a", messageId: "message-a", schoolId: "school-a", schoolYearId: "year-a", parentId: "parent-a" };
  const parent = { id: "parent-user", name: "Parent", email: "p@test", role: "parent" as const, schoolId: "school-a", activeSchoolYearId: "year-a", parentId: "parent-a", status: "active" as const };
  const admin = { id: "admin-a", name: "Admin", email: "a@test", role: "school_admin" as const, schoolId: "school-a", activeSchoolYearId: "year-a", status: "active" as const };

  it("accepte le message exact du Parent", () => {
    expect(resolveMessagePushDestination(parent, payload, message, admin)).toBe("/dashboard?push=message&messageId=message-a");
    expect(canOpenMessageDeepLink(parent, message, admin)).toBe(true);
  });

  it("rejette une destination arbitraire et un message interdit", () => {
    expect(resolveMessagePushDestination(parent, { ...payload, destination: "https://evil.test" }, message)).toBeNull();
    expect(resolveMessagePushDestination(parent, payload, { ...message, threadParentId: "parent-b" }, admin)).toBeNull();
  });

  it.each([
    ["admin", "school_admin", true], ["cashier", "cashier", true], ["discipline", "discipline_director", true], ["both", "school_admin", true], ["both", "cashier", true], ["both", "discipline_director", false], ["admin", "super_admin", false],
  ] as const)("valide %s pour %s", (schoolRecipient, role, allowed) => {
    const schoolMessage = { ...message, senderId: "parent-user", recipientParentId: "school", schoolRecipient };
    const schoolUser = { ...parent, id: `${role}-user`, role, parentId: undefined };
    const schoolPayload = { ...payload, event: "parent_message_received", schoolRecipient };
    expect(Boolean(resolveMessagePushDestination(schoolUser, schoolPayload, schoolMessage, parent))).toBe(allowed);
  });
});
