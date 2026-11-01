import { describe, expect, it, vi } from "vitest";
import { markSectionNotificationsRead } from "./sectionMessageRead.js";
const caller = { uid: "actor", role: "primary_admin", schoolId: "a" };
function fixture(patch = {}) {
  const rows: Record<string, Record<string, unknown>> = {
    "users/actor": { ...caller, status: "active", sectionIds: ["Primaire"] },
    "schools/a": { status: "active" }, "schoolYears/y": { schoolId: "a" },
    "notifications/n": { schoolId: "a", schoolYearId: "y", recipientUserId: "actor", section: "Primaire", read: false, ...patch },
  };
  const update = vi.fn();
  const db = { doc: (path: string) => ({ path }), runTransaction: async (run: (tx: unknown) => Promise<unknown>) => run({
    get: async ({ path }: { path: string }) => ({ id: path.split("/").at(-1), exists: !!rows[path], data: () => rows[path] }), update,
  }) };
  return { db, update, rows };
}
describe("marqueurs personnels des profils de section", () => {
  it("ne met à jour que le champ lu de la notification personnelle", async () => {
    const { db, update } = fixture();
    expect(await markSectionNotificationsRead(db, caller, { schoolYearId: "y", notificationId: "n" })).toEqual({ count: 1, hasMore: false });
    expect(update).toHaveBeenCalledExactlyOnceWith({ path: "notifications/n" }, { read: true });
  });
  it.each([{ recipientUserId: "other" }, { schoolId: "b" }, { schoolYearId: "other" }, { section: "Secondaire" }, { section: undefined }])("refuse une notification étrangère", async (patch) => {
    const { db, update } = fixture(patch);
    await expect(markSectionNotificationsRead(db, caller, { schoolYearId: "y", notificationId: "n" })).rejects.toMatchObject({ statusCode: 403 });
    expect(update).not.toHaveBeenCalled();
  });
  it("refuse la modification des compteurs ou d'un profil désactivé", async () => {
    const { db, rows, update } = fixture();
    await expect(markSectionNotificationsRead(db, caller, { schoolYearId: "y", notificationId: "n", recipientUserId: "other" })).rejects.toThrow();
    rows["users/actor"].active = false;
    await expect(markSectionNotificationsRead(db, caller, { schoolYearId: "y", notificationId: "n" })).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
  });
});
