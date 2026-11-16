import { describe, expect, it, vi } from "vitest";
import { sendOperationalToDevices } from "./sendOperationalToDevices.js";

// Lot 25 : école, élève (avec motif qui ne doit jamais sortir), sanction et annonce fictives.
function fakeDatabase(remove = vi.fn()) {
  const docs: Record<string, Record<string, unknown>> = {
    "schools/school-a": { name: "C.S Fictif" },
    "students/student-a": { nom: "KABILA", postnom: "MUJINGA", prenom: "Grâce", sexe: "F" },
    "disciplineSanctions/sanction-a": { studentId: "student-a", manualReason: "motif confidentiel" },
    "valves/announcement-a": { title: "Rentrée du lundi", body: "description complète" },
  };
  return { doc: vi.fn((path: string) => ({ delete: remove, get: async () => ({ exists: Boolean(docs[path]), data: () => docs[path] }) })) };
}

describe("payloads opérationnels", () => {
  it.each([
    ["attendance", "student_absent", "C.S Fictif — Absence", "Grâce a été notée absente aujourd'hui."],
    ["attendance", "student_late", "C.S Fictif — Retard", "Grâce est arrivée en retard aujourd'hui."],
    ["discipline", "discipline_incident_created", "C.S Fictif — Information discipline", "Une information concernant Grâce est disponible."],
    ["announcements", "announcement_published", "C.S Fictif — Nouvelle annonce", "Rentrée du lundi"],
  ] as const)("envoie %s/%s sans contenu sensible", async (module, event, title, body) => {
    const sendEachForMulticast = vi.fn(async (input: Record<string, unknown>) => {
      void input;
      return { successCount: 1, failureCount: 0, responses: [{ success: true }] };
    });
    await sendOperationalToDevices({ sendEachForMulticast } as never, fakeDatabase() as never, { id: "notif", module, event, schoolId: "school-a", schoolYearId: "year-a", parentId: "parent-a", studentId: "student-a", attendanceId: module === "attendance" ? "attendance-a" : undefined, disciplineSanctionId: module === "discipline" ? "sanction-a" : undefined, announcementId: module === "announcements" ? "announcement-a" : undefined }, { module, event, recipients: [{ userId: "user-a", tokens: [{ id: "token", token: "token", userId: "user-a", active: true }] }] });
    const payload = sendEachForMulticast.mock.calls[0]?.[0] as { notification: { title: string }; data: { destination: string } };
    expect(payload?.notification).toEqual({ title, body });
    expect(payload?.data.destination).toBe("/dashboard");
    expect(JSON.stringify(payload)).not.toContain("manualReason");
    expect(JSON.stringify(payload)).not.toContain("description");
  });

  it("nettoie un token invalide et remonte un échec temporaire", async () => {
    const remove = vi.fn();
    const database = fakeDatabase(remove);
    const notification = { id: "notif", module: "attendance" as const, event: "student_absent" as const, schoolId: "school-a", schoolYearId: "year-a", attendanceId: "attendance-a", studentId: "student-a", parentId: "parent-a" };
    const dispatch = { module: "attendance" as const, event: "student_absent" as const, recipients: [{ userId: "user-a", tokens: [{ id: "token", token: "token", userId: "user-a", active: true }] }] };
    await sendOperationalToDevices({ sendEachForMulticast: vi.fn(async () => ({ successCount: 0, failureCount: 1, responses: [{ success: false, error: { code: "messaging/registration-token-not-registered" } }] })) } as never, database as never, notification, dispatch);
    expect(remove).toHaveBeenCalledTimes(1);
    await expect(sendOperationalToDevices({ sendEachForMulticast: vi.fn(async () => ({ successCount: 0, failureCount: 1, responses: [{ success: false, error: { code: "messaging/internal-error" } }] })) } as never, database as never, notification, dispatch)).rejects.toThrow("Échec FCM temporaire");
  });
});
