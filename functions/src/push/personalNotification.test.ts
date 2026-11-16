import { describe, expect, it, vi } from "vitest";
import { handlePersonalNotification, personalEvent, personalText, recipientAllowed } from "./personalNotification.js";
import { isMessageNotification } from "./resolveMessageRecipients.js";

// Base Firestore en mémoire : documents, requêtes d'égalité, comptage et transactions.
function memoryDatabase(seed: Record<string, Record<string, unknown>>) {
  const records = new Map(Object.entries(seed));
  const docRef = (path: string) => ({
    path, id: path.split("/").at(-1)!,
    get: async () => ({ exists: records.has(path), id: path.split("/").at(-1), data: () => records.get(path) }),
    set: async (value: Record<string, unknown>, options?: { merge?: boolean }) => { records.set(path, options?.merge ? { ...records.get(path), ...value } : value); },
    delete: async () => { records.delete(path); },
  });
  const queryOf = (collection: string, filters: Array<[string, unknown]>) => ({
    where: (field: string, _op: string, value: unknown) => queryOf(collection, [...filters, [field, value]]),
    get: async () => {
      const docs = [...records.entries()].filter(([path]) => path.startsWith(`${collection}/`) && path.split("/").length === collection.split("/").length + 1)
        .filter(([, value]) => filters.every(([field, expected]) => value[field] === expected))
        .map(([path, value]) => ({ id: path.split("/").at(-1), data: () => value, ref: docRef(path) }));
      return { docs, size: docs.length };
    },
    count: () => ({ get: async () => { const size = (await queryOf(collection, filters).get()).size; return { data: () => ({ count: size }) }; } }),
  });
  return {
    records,
    doc: docRef,
    collection: (name: string) => queryOf(name, []),
    runTransaction: async <T>(run: (transaction: { get: (ref: ReturnType<typeof docRef>) => Promise<unknown>; set: (ref: ReturnType<typeof docRef>, value: Record<string, unknown>, options?: { merge?: boolean }) => void }) => Promise<T>) => {
      const writes: Array<() => Promise<void>> = [];
      const result = await run({ get: (ref) => ref.get(), set: (ref, value, options) => { writes.push(() => ref.set(value, options)); } });
      for (const write of writes) await write();
      return result;
    },
  };
}

const seed = () => ({
  "users/parent-a": { role: "parent", schoolId: "school-a", status: "active" },
  "users/parent-a/pushTokens/phone": { userId: "parent-a", token: "token-phone", active: true },
  "users/parent-a/pushTokens/tablet": { userId: "parent-a", token: "token-tablet", active: true },
  "users/parent-a/pushTokens/old": { userId: "parent-a", token: "token-old", active: false },
  "users/cashier-b": { role: "cashier", schoolId: "school-b", status: "active" },
  "users/cashier-b/pushTokens/phone": { userId: "cashier-b", token: "token-b", active: true },
  "users/coord": { role: "coordination_admin", coordinationId: "c1", status: "active" },
  "users/coord/pushTokens/phone": { userId: "coord", token: "token-coord", active: true },
  "users/gone": { role: "teacher", schoolId: "school-a", status: "inactive" },
  "users/gone/pushTokens/phone": { userId: "gone", token: "token-gone", active: true },
  "messages/m1": { senderName: "Marie Kabila", senderRole: "secretary", subject: "Réunion des parents" },
  "messages/m2": { senderName: "Coordinateur Fictif", senderRole: "coordination_admin", replyToMessageId: "m0" },
  "notifications/n-unread": { recipientUserId: "parent-a", read: false },
});
const messaging = (responses?: Array<{ success: boolean; error?: { code: string } }>) => ({
  sendEachForMulticast: vi.fn(async (input: { tokens: string[] }) => ({ successCount: input.tokens.length, failureCount: 0, responses: responses ?? input.tokens.map(() => ({ success: true })) })),
});
const message = { type: "message", recipientUserId: "parent-a", schoolId: "school-a", schoolYearId: "y", messageId: "m1" };

describe("lot 24 : push personnels", () => {
  it("envoie au seul destinataire, sur tous ses appareils actifs, avec nom et rôle de l'expéditeur et le badge", async () => {
    const db = memoryDatabase(seed()), fcm = messaging();
    expect(await handlePersonalNotification("n1", message, db as never, fcm as never)).toMatchObject({ status: "completed", successCount: 2 });
    const payload = fcm.sendEachForMulticast.mock.calls[0]![0] as unknown as { tokens: string[]; notification: { title: string; body: string }; data: Record<string, string>; webpush: { headers: Record<string, string> } };
    expect(payload.tokens.sort()).toEqual(["token-phone", "token-tablet"]);
    expect(payload.notification).toEqual({ title: "Nouveau message — Marie Kabila", body: "Objet : Réunion des parents" });
    expect(payload.data).toMatchObject({ module: "personal", event: "message_received", destination: "/dashboard", messageId: "m1", badge: "1" });
    expect(Number(payload.webpush.headers.TTL)).toBeGreaterThanOrEqual(7 * 24 * 3600);
  });

  it("n'envoie jamais deux fois la même notification", async () => {
    const db = memoryDatabase(seed()), fcm = messaging();
    await handlePersonalNotification("n1", message, db as never, fcm as never);
    expect(await handlePersonalNotification("n1", message, db as never, fcm as never)).toMatchObject({ status: "duplicate" });
    expect(fcm.sendEachForMulticast).toHaveBeenCalledTimes(1);
  });

  it("supprime un jeton invalide", async () => {
    const db = memoryDatabase(seed()), fcm = messaging([{ success: true }, { success: false, error: { code: "messaging/registration-token-not-registered" } }]);
    await handlePersonalNotification("n2", message, db as never, fcm as never);
    expect([...db.records.keys()].filter((key) => key.startsWith("users/parent-a/pushTokens/"))).toHaveLength(2);
  });

  it("respecte la séparation entre écoles et retire les jetons d'un compte désactivé", async () => {
    const db = memoryDatabase(seed()), fcm = messaging();
    expect(await handlePersonalNotification("n3", { ...message, recipientUserId: "cashier-b" }, db as never, fcm as never)).toMatchObject({ status: "ignored" });
    expect(await handlePersonalNotification("n4", { ...message, recipientUserId: "gone" }, db as never, fcm as never)).toMatchObject({ status: "ignored" });
    expect(db.records.has("users/gone/pushTokens/phone")).toBe(false);
    expect(fcm.sendEachForMulticast).not.toHaveBeenCalled();
  });

  it("la Coordination reçoit la réponse d'une école qu'elle supervise", async () => {
    const db = memoryDatabase(seed()), fcm = messaging();
    await handlePersonalNotification("n5", { type: "message", recipientUserId: "coord", schoolId: "school-a", coordinationId: "c1", messageId: "m2" }, db as never, fcm as never);
    expect((fcm.sendEachForMulticast.mock.calls[0]![0] as unknown as { notification: { title: string } }).notification.title).toBe("Nouveau message — Coordinateur Fictif");
    expect(recipientAllowed({ id: "coord", role: "coordination_admin", coordinationId: "c2" }, { schoolId: "school-a", coordinationId: "c1" })).toBe(false);
  });

  it("textes sans montant ni motif sur l'écran verrouillé ; événements couverts", () => {
    expect(personalEvent({ recipientUserId: "u", type: "financial_correction", event: "payment_corrected" })).toBe("payment_corrected");
    expect(personalEvent({ recipientUserId: "u", type: "financial_correction", event: "payment_cancelled" })).toBe("payment_cancelled");
    expect(personalEvent({ recipientUserId: "u", type: "grade_publication" })).toBe("grades_published");
    expect(personalEvent({ recipientUserId: "u", type: "message", messageId: "m", module: "discipline" })).toBeNull();
    expect(personalEvent({ type: "message", messageId: "m" })).toBeNull();
    for (const event of ["payment_corrected", "payment_cancelled", "grades_published"] as const) expect(JSON.stringify(personalText(event))).not.toMatch(/\d|USD|FC|motif/i);
    // Plus de double envoi : l'ancienne fonction ignore les notifications adressées à une personne.
    expect(isMessageNotification({ type: "message", recipientRole: "school", schoolId: "s", schoolYearId: "y", messageId: "m", recipientUserId: "u" })).toBe(false);
  });
});

describe("lot 25 : Équipe ACADÉA", () => {
  it("un message du Super administrateur s'annonce « Nouveau message — Équipe ACADÉA »", () => {
    expect(personalText("message_received", { senderName: "Équipe ACADÉA", senderRole: "super_admin" }).title).toBe("Nouveau message — Équipe ACADÉA");
  });
});
