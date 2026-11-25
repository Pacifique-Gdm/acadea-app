import { describe, expect, it, vi } from "vitest";
import { handlePersonalNotification, personalEvent, personalText } from "./personalNotification.js";
import { isPaymentRecordedNotification } from "./resolvePaymentRecipient.js";

// Alerte sur l'écran du téléphone pour le personnel dont l'enfant est pris en charge :
// paiement enregistré et nouvelle prise en charge. Base en mémoire recopiée de personalNotification.test.ts.
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

const messaging = (responses?: Array<{ success: boolean; error?: { code: string } }>) => ({
  sendEachForMulticast: vi.fn(async (input: { tokens: string[] }) => ({ successCount: input.tokens.length, failureCount: 0, responses: responses ?? input.tokens.map(() => ({ success: true })) })),
});
const seed = () => ({
  "schools/school-a": { name: "École Fictive" },
  "students/st": { prenom: "Grâce", schoolId: "school-a" },
  "users/teacher-a": { role: "teacher", schoolId: "school-a", status: "active" },
  "users/teacher-a/pushTokens/phone": { userId: "teacher-a", token: "token-teacher", active: true },
});
const staffPayment = { id: "n1", schoolId: "school-a", schoolYearId: "y", recipientUserId: "teacher-a", studentId: "st", type: "payment", module: "payments", event: "payment_recorded", destination: "/dashboard", title: "Paiement enregistré", body: "Élève : …", read: false };
const staffSupport = { ...staffPayment, id: "n2", event: "support_recorded", title: "Prise en charge enregistrée" };

describe("alerte téléphone du personnel (enfant pris en charge)", () => {
  it("paiement enregistré : alerte au seul membre du personnel, sans montant", async () => {
    const db = memoryDatabase(seed()), fcm = messaging();
    expect(await handlePersonalNotification("n1", staffPayment, db as never, fcm as never)).toMatchObject({ status: "completed", successCount: 1 });
    const sent = fcm.sendEachForMulticast.mock.calls[0]![0] as unknown as { tokens: string[]; notification: { title: string; body: string }; data: Record<string, string> };
    expect(sent.tokens).toEqual(["token-teacher"]);
    expect(sent.notification).toEqual({ title: "École Fictive — Paiement reçu", body: "Un paiement a été enregistré pour Grâce. Touchez pour voir le reçu." });
    expect(sent.data).toMatchObject({ module: "personal", event: "payment_recorded", destination: "/dashboard" });
  });

  it("nouvelle prise en charge : alerte « Prise en charge », sans montant ni motif", async () => {
    const db = memoryDatabase(seed()), fcm = messaging();
    await handlePersonalNotification("n2", staffSupport, db as never, fcm as never);
    const sent = fcm.sendEachForMulticast.mock.calls[0]![0] as unknown as { notification: { title: string; body: string } };
    expect(sent.notification).toEqual({ title: "École Fictive — Prise en charge", body: "Une prise en charge a été enregistrée pour Grâce. Touchez pour voir le détail." });
    expect(JSON.stringify(personalText("support_recorded"))).not.toMatch(/\d|USD|FC|motif/i);
  });

  it("un seul envoi par notification, et le parent garde sa propre fonction (pas de double alerte)", async () => {
    const db = memoryDatabase(seed()), fcm = messaging();
    await handlePersonalNotification("n1", staffPayment, db as never, fcm as never);
    expect(await handlePersonalNotification("n1", staffPayment, db as never, fcm as never)).toMatchObject({ status: "duplicate" });
    expect(fcm.sendEachForMulticast).toHaveBeenCalledTimes(1);
    const parentPayment = { schoolId: "school-a", schoolYearId: "y", parentId: "p1", studentId: "st", recipientRole: "parent", type: "payment", module: "payments", event: "payment_recorded", destination: "/dashboard" };
    expect(personalEvent(parentPayment)).toBeNull();
    expect(isPaymentRecordedNotification(staffPayment)).toBe(false);
  });

  it("aucune alerte pour un compte d'une autre école", async () => {
    const db = memoryDatabase({ ...seed(), "users/teacher-a": { role: "teacher", schoolId: "school-b", status: "active" } }), fcm = messaging();
    expect(await handlePersonalNotification("n1", staffPayment, db as never, fcm as never)).toMatchObject({ status: "ignored" });
    expect(fcm.sendEachForMulticast).not.toHaveBeenCalled();
  });
});
