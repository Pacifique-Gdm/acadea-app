import { initializeApp, deleteApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";

// Lot 23 — régression trouvée sur le staging : une réponse entre membres d'une même école,
// envoyée avec la référence du message d'origine (replyToMessageId), était refusée (400).
// Test du VRAI point d'entrée /api/send-school-message sur l'émulateur.
const state = vi.hoisted(() => ({ db: undefined as unknown, claims: {} as Record<string, unknown> }));
vi.mock("../../api/_lib/firebaseAdmin.js", () => ({
  initAdmin: () => ({ db: state.db, auth: { verifyIdToken: async () => state.claims }, bucket: { file: () => ({ delete: async () => undefined }) } }),
}));
import handler from "../../api/send-school-message.js";

const projectId = "demo-acadea-school-replies";
let app: App, db: Firestore;
const STAFF = ["school_admin", "secretary", "cashier", "discipline_director", "study_director", "teacher"];
const call = async (uid: string, role: string, body: Record<string, unknown>) => {
  state.claims = { uid, role, schoolId: "school-a" };
  const res = { statusCode: 0, payload: undefined as unknown, setHeader() {}, end(text: string) { this.payload = JSON.parse(text); } };
  await handler({ method: "POST", headers: { authorization: "Bearer jeton-de-test", "x-idempotency-key": crypto.randomUUID() }, body } as never, res as never);
  return res as { statusCode: number; payload: { message?: Record<string, unknown>; message_?: string; error?: string } };
};

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST?.match(/^(127\.0\.0\.1|localhost):\d+$/)) throw new Error("Ce test exige exclusivement un Emulator Firestore local.");
  app = initializeApp({ projectId }, "school-replies-tests"); db = getFirestore(app); state.db = db;
}, 180_000);
beforeEach(async () => {
  const existing = await Promise.all(["users", "schools", "schoolYears", "messages", "notifications", "conversations", "_rateLimits"].map((name) => db.collection(name).get()));
  const cleanup = db.batch(); existing.flatMap((snapshot) => snapshot.docs).forEach((item) => cleanup.delete(item.ref)); await cleanup.commit();
  const batch = db.batch();
  batch.set(db.doc("schools/school-a"), { id: "school-a", status: "active", activeSchoolYearId: "year-a" });
  batch.set(db.doc("schoolYears/year-a"), { id: "year-a", schoolId: "school-a", status: "active" });
  for (const role of STAFF) batch.set(db.doc(`users/${role}`), { id: role, role, schoolId: "school-a", status: "active", active: true, name: `Nom ${role}` });
  await batch.commit();
});
afterAll(async () => { if (app) await deleteApp(app); });

describe("réponses entre membres d'une même école", () => {
  it.each(STAFF.flatMap((from) => STAFF.filter((to) => to !== from).map((to) => [from, to])))("%s écrit à %s, qui lui répond avec la référence du message", async (from, to) => {
    const sent = await call(from, from, { schoolYearId: "year-a", recipientIds: [to], recipientRoles: [to], subject: "Question", body: "Bonjour", draftId: crypto.randomUUID(), attachments: [] });
    expect(sent.statusCode).toBe(200);
    const reply = await call(to, to, { schoolYearId: "year-a", recipientIds: [from], recipientRoles: [from], subject: "Re : Question", body: "Réponse", draftId: crypto.randomUUID(), attachments: [], replyToMessageId: sent.payload.message?.id });
    expect(reply.statusCode).toBe(200);
    expect(reply.payload.message).toMatchObject({ senderId: to, senderRole: to, senderName: `Nom ${to}`, recipientIds: [from] });
    const notifications = await db.collection("notifications").where("recipientUserId", "==", from).where("messageId", "==", reply.payload.message?.id).get();
    expect(notifications.size).toBe(1);
  }, 60_000);
});
