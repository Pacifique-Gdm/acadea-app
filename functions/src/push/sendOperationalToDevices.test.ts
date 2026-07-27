import { describe, expect, it, vi } from "vitest";
import { sendOperationalToDevices } from "./sendOperationalToDevices.js";

describe("payloads opérationnels", () => {
  it.each([
    ["attendance", "student_absent", "Absence signalée"], ["attendance", "student_late", "Retard signalé"], ["discipline", "discipline_incident_created", "Nouvelle information disciplinaire"], ["announcements", "announcement_published", "Nouvelle annonce Acadéa"],
  ] as const)("envoie %s/%s sans contenu sensible", async (module, event, title) => {
    const sendEachForMulticast = vi.fn(async (input: Record<string, unknown>) => {
      void input;
      return { successCount: 1, failureCount: 0, responses: [{ success: true }] };
    });
    await sendOperationalToDevices({ sendEachForMulticast } as never, {} as never, { id: "notif", module, event, schoolId: "school-a", schoolYearId: "year-a", parentId: "parent-a", studentId: "student-a", attendanceId: module === "attendance" ? "attendance-a" : undefined, disciplineSanctionId: module === "discipline" ? "sanction-a" : undefined, announcementId: module === "announcements" ? "announcement-a" : undefined }, { module, event, recipients: [{ userId: "user-a", tokens: [{ id: "token", token: "token", userId: "user-a", active: true }] }] });
    const payload = sendEachForMulticast.mock.calls[0]?.[0] as { notification: { title: string }; data: { destination: string } };
    expect(payload?.notification.title).toBe(title);
    expect(payload?.data.destination).toBe("/dashboard");
    expect(JSON.stringify(payload)).not.toContain("manualReason");
    expect(JSON.stringify(payload)).not.toContain("description");
  });

  it("nettoie un token invalide et remonte un échec temporaire", async () => {
    const remove = vi.fn();
    const database = { doc: vi.fn(() => ({ delete: remove })) };
    const notification = { id: "notif", module: "attendance" as const, event: "student_absent" as const, schoolId: "school-a", schoolYearId: "year-a", attendanceId: "attendance-a", studentId: "student-a", parentId: "parent-a" };
    const dispatch = { module: "attendance" as const, event: "student_absent" as const, recipients: [{ userId: "user-a", tokens: [{ id: "token", token: "token", userId: "user-a", active: true }] }] };
    await sendOperationalToDevices({ sendEachForMulticast: vi.fn(async () => ({ successCount: 0, failureCount: 1, responses: [{ success: false, error: { code: "messaging/registration-token-not-registered" } }] })) } as never, database as never, notification, dispatch);
    expect(remove).toHaveBeenCalledTimes(1);
    await expect(sendOperationalToDevices({ sendEachForMulticast: vi.fn(async () => ({ successCount: 0, failureCount: 1, responses: [{ success: false, error: { code: "messaging/internal-error" } }] })) } as never, database as never, notification, dispatch)).rejects.toThrow("Échec FCM temporaire");
  });
});
