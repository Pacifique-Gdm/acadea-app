import { describe, expect, it, vi } from "vitest";
vi.mock("../firebase", () => ({ db: undefined }));
import { fetchSchoolMessageRecipients, forgetSchoolMessageRecipients, peekSchoolMessageRecipients, recipientFingerprint, recipientsMemoryKey } from "./useSchoolMessageRecipients";
import { schoolMessageRecipientCategories } from "../modules/messages/administrativeRecipientSelection";

describe("Messages : destinataires gardés en mémoire, sans actualisation en boucle", () => {
  it("un seul appel pour plusieurs ouvertures simultanées, puis affichage immédiat depuis la mémoire", async () => {
    forgetSchoolMessageRecipients();
    const load = vi.fn(async () => [{ uid: "c1", name: "Coordinateur fictif", role: "coordination_admin" as const }]);
    const key = recipientsMemoryKey("admin", "s", "y");
    const [a, b] = await Promise.all([fetchSchoolMessageRecipients(key, "y", load), fetchSchoolMessageRecipients(key, "y", load)]);
    expect(load).toHaveBeenCalledTimes(1); expect(a).toBe(b);
    expect(peekSchoolMessageRecipients(key)).toEqual(a);
    forgetSchoolMessageRecipients();
    expect(peekSchoolMessageRecipients(key)).toBeNull();
  });
  it("une écriture sans rapport (date de mise à jour, compteur…) ne change pas l'empreinte : pas de rechargement", () => {
    const base = { name: "Coord", role: "coordination_admin", active: true, status: "active", coordinationId: "c" };
    expect(recipientFingerprint({ ...base, updatedAt: "2026-11-19", lastLoginAt: "x", counters: 3 })).toBe(recipientFingerprint(base));
    expect(recipientFingerprint({ ...base, active: false })).not.toBe(recipientFingerprint(base));
    expect(recipientFingerprint({ ...base, name: "Autre" })).not.toBe(recipientFingerprint(base));
  });
  it("« Coordinateur » s'affiche tout de suite pour une école rattachée, avant même la liste", () => {
    const waiting = schoolMessageRecipientCategories([], true, true, false).map((c) => c.value);
    expect(waiting).toContain("coordination");
    expect(schoolMessageRecipientCategories([], true, false, false).map((c) => c.value)).not.toContain("coordination");
    // Liste arrivée sans coordinateur : la catégorie n'est pas proposée.
    expect(schoolMessageRecipientCategories([], true, true, true).map((c) => c.value)).not.toContain("coordination");
    expect(schoolMessageRecipientCategories([], false, true, false).map((c) => c.value)).not.toContain("coordination");
  });
});
