import { readFileSync } from "node:fs";
import { initializeApp, deleteApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { listPlatformRecipients, resolveReplyTarget, sendCoordinationReply, sendPlatformMessage, sendPlatformReply } from "../../api/_lib/platformMessaging.js";
import { allowedRecipientRoles } from "../../api/_lib/messageRecipients.js";
import { sendMessage as sendCoordinationRequest } from "../../api/coordination-message-recipients.js";
import { canReplyToMessage } from "../../src/utils/messageReplies";

// Lot 23 — circuit de la messagerie sur l'émulateur Firestore réel (vraies règles, vrai code serveur).
const projectId = "demo-acadea-messaging-circuit";
let app: App, db: Firestore, environment: RulesTestEnvironment;
const STAFF = ["school_admin", "secretary", "cashier", "discipline_director", "study_director", "teacher"] as const;
const user = (id: string, role: string, extra: Record<string, unknown> = {}) => ({ id, role, name: `Nom ${id}`, status: "active", active: true, ...extra });
const superAdmin = { uid: "sa", role: "super_admin", profile: user("sa", "super_admin", { name: "Super Admin Fictif" }) };
const coord = { uid: "coord", role: "coordination_admin", coordinationId: "c1", profile: user("coord", "coordination_admin", { coordinationId: "c1", name: "Coordinateur Fictif" }) };
const staff = (role: string, schoolId = "school-a") => ({ uid: `${role}-${schoolId}`, role, schoolId, profile: user(`${role}-${schoolId}`, role, { schoolId, name: `${role} ${schoolId}` }) });
const client = (uid: string, claims: Record<string, unknown>) => environment.authenticatedContext(uid, claims).firestore();
const response = () => { const res = { statusCode: 0, body: undefined as unknown, headers: {} as Record<string, string>, setHeader(k: string, v: string) { this.headers[k] = v; }, end(text: string) { this.body = JSON.parse(text); } }; return res; };
const coordinationSend = async (body: Record<string, unknown>, key = crypto.randomUUID()) => { const res = response(); await sendCoordinationRequest({ headers: { "x-idempotency-key": key }, body } as never, res as never, db as never, coord as never); return res.body as Record<string, unknown>; };

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST?.match(/^(127\.0\.0\.1|localhost):\d+$/)) throw new Error("Ce test exige exclusivement un Emulator Firestore local.");
  environment = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync("firestore.rules", "utf8") } });
  app = initializeApp({ projectId }, "messaging-circuit-tests"); db = getFirestore(app);
}, 180_000);
beforeEach(async () => {
  await environment.clearFirestore();
  const batch = db.batch();
  const records: Record<string, Record<string, unknown>> = {
    "schools/school-a": { id: "school-a", status: "active", activeSchoolYearId: "year-a", activeCoordinationId: "c1" },
    "schools/school-b": { id: "school-b", status: "active", activeSchoolYearId: "year-b" },
    "schoolYears/year-a": { id: "year-a", schoolId: "school-a", status: "active" },
    "schoolYears/year-b": { id: "year-b", schoolId: "school-b", status: "active" },
    "coordinations/c1": { id: "c1", status: "active", active: true, principalCoordinatorUserId: "coord" },
    "coordinationSchools/c1__school-a": { id: "c1__school-a", coordinationId: "c1", schoolId: "school-a", active: true, status: "active" },
    "users/sa": superAdmin.profile, "users/coord": coord.profile,
    "users/parent-school-a": user("parent-school-a", "parent", { schoolId: "school-a", parentId: "p1", name: "Parent Fictif" }),
    "parents/p1": { id: "p1", schoolId: "school-a", fullName: "Parent Fictif", studentIds: ["s1"] },
    "students/s1": { id: "s1", schoolId: "school-a", schoolYearId: "year-a", parentId: "p1", section: "Primaire" },
  };
  for (const role of STAFF) { records[`users/${role}-school-a`] = staff(role).profile; records[`users/${role}-school-b`] = staff(role, "school-b").profile; }
  for (let index = 0; index < 250; index += 1) records[`users/parent-bulk-${index}`] = user(`parent-bulk-${index}`, "parent", { schoolId: "school-a", parentId: `pb${index}` });
  for (const [path, value] of Object.entries(records)) batch.set(db.doc(path), value);
  await batch.commit();
});
afterAll(async () => { await environment?.cleanup(); if (app) await deleteApp(app); });

describe("chemins autorisés (aller)", () => {
  it("chaque personnel écrit aux autres personnels et aux parents ; l'Administrateur aussi à la Coordination", () => {
    for (const role of STAFF) {
      const allowed = allowedRecipientRoles(role);
      for (const other of STAFF.filter((item) => item !== role)) expect(allowed.has(other)).toBe(true);
      expect(allowed.has("parent")).toBe(true);
      expect(allowed.has("coordination_admin")).toBe(role === "school_admin");
    }
    expect([...allowedRecipientRoles("parent")].sort()).toEqual([...STAFF].sort());
  });
});

describe("Super administrateur → coordinations, sous-coordinations, administrateurs (et retour)", () => {
  it("liste uniquement les destinataires prévus", async () => {
    const roles = new Set((await listPlatformRecipients(db)).map((item) => item.role));
    expect([...roles].sort()).toEqual(["coordination_admin", "school_admin"]);
  });

  it("arrive chez le bon destinataire seulement, en-tête nom + rôle, badge (notification non lue) puis lu", async () => {
    const { messageIds } = await sendPlatformMessage(db, superAdmin, { recipientIds: ["coord", "school_admin-school-a"], subject: "Réunion", body: "Bonjour", idempotencyKey: "sa-key-1" });
    expect(messageIds).toHaveLength(2);
    // Coordination : lecture du message et de la notification de plateforme.
    const coordClient = client("coord", { role: "coordination_admin", coordinationId: "c1" });
    const coordNotifications = await assertSucceeds(getDocs(query(collection(coordClient, "notifications"), where("recipientUserId", "==", "coord"), where("platformMessage", "==", true), where("read", "==", false))));
    expect(coordNotifications.size).toBe(1);
    const message = (await assertSucceeds(getDoc(doc(coordClient, "messages", coordNotifications.docs[0].data().messageId)))).data();
    // Lot 25 (décision du propriétaire) : le Super administrateur apparaît comme « Équipe ACADÉA ».
    expect(message).toMatchObject({ senderName: "Équipe ACADÉA", senderRole: "super_admin", recipientLabel: "Coordinateur Fictif (Coordinateur)" });
    expect(coordNotifications.docs[0].data().title).toBe("Nouveau message de l'Équipe ACADÉA");
    await assertSucceeds(updateDoc(doc(coordClient, "notifications", coordNotifications.docs[0].id), { read: true }));
    // Administrateur : requête habituelle de l'application (école + année).
    const adminClient = client("school_admin-school-a", { role: "school_admin", schoolId: "school-a" });
    const adminUnread = await assertSucceeds(getDocs(query(collection(adminClient, "notifications"), where("schoolId", "==", "school-a"), where("schoolYearId", "==", "year-a"), where("recipientUserId", "==", "school_admin-school-a"), where("read", "==", false))));
    expect(adminUnread.size).toBe(1);
    // Isolation : un autre administrateur et un caissier ne voient rien.
    const otherAdmin = client("school_admin-school-b", { role: "school_admin", schoolId: "school-b" });
    for (const id of messageIds) await assertFails(getDoc(doc(otherAdmin, "messages", id)));
    const cashier = client("cashier-school-a", { role: "cashier", schoolId: "school-a" });
    await assertFails(getDoc(doc(cashier, "messages", messageIds[0])));
  });

  it("refuse un destinataire hors périmètre (caissier, parent) et ne double jamais un envoi rejoué", async () => {
    await expect(sendPlatformMessage(db, superAdmin, { recipientIds: ["cashier-school-a"], subject: "x", body: "y", idempotencyKey: "k" })).rejects.toMatchObject({ code: "invalid-recipient" });
    await expect(sendPlatformMessage(db, superAdmin, { recipientIds: ["parent-school-a"], subject: "x", body: "y", idempotencyKey: "k2" })).rejects.toMatchObject({ code: "invalid-recipient" });
    const first = await sendPlatformMessage(db, superAdmin, { recipientIds: ["coord"], subject: "x", body: "y", idempotencyKey: "same" });
    const again = await sendPlatformMessage(db, superAdmin, { recipientIds: ["coord"], subject: "x", body: "y", idempotencyKey: "same" });
    expect(again).toMatchObject({ idempotent: true, messageIds: first.messageIds });
  });

  it("la Coordination et l'Administrateur répondent au Super administrateur", async () => {
    const { messageIds } = await sendPlatformMessage(db, superAdmin, { recipientIds: ["coord", "school_admin-school-a"], subject: "Question", body: "?", idempotencyKey: "sa-key-2" });
    const coordReply = await sendPlatformReply(db, coord, { replyToMessageId: messageIds[0], body: "Réponse coordination", idempotencyKey: "r1" });
    const adminReply = await sendPlatformReply(db, staff("school_admin"), { replyToMessageId: messageIds[1], body: "Réponse admin", idempotencyKey: "r2" });
    const saClient = client("sa", { role: "super_admin" });
    const unread = await assertSucceeds(getDocs(query(collection(saClient, "notifications"), where("recipientUserId", "==", "sa"), where("read", "==", false))));
    expect(unread.docs.map((item) => item.data().messageId).sort()).toEqual([coordReply.message.id, adminReply.message.id].sort());
    expect(unread.docs.map((item) => item.data().title).sort()).toEqual(["Réponse de Coordinateur Fictif (Coordinateur)", "Réponse de school_admin school-a (Administrateur)"]);
    // Lot 25 : la réponse de l'Administrateur figure dans SA PROPRE messagerie (requête habituelle de l'école).
    const adminClient = client("school_admin-school-a", { role: "school_admin", schoolId: "school-a" });
    const adminSent = await assertSucceeds(getDocs(query(collection(adminClient, "messages"), where("schoolId", "==", "school-a"), where("schoolYearId", "==", "year-a"), where("participantIds", "array-contains", "school_admin-school-a"))));
    expect(adminSent.docs.map((item) => item.id)).toContain(adminReply.message.id);
    expect(adminReply.message).toMatchObject({ recipientLabel: "Équipe ACADÉA" });
    // Un message du Super administrateur n'est pas « répondable » par quelqu'un qui n'en est pas destinataire.
    await expect(resolveReplyTarget(db, staff("school_admin", "school-b"), messageIds[1])).rejects.toMatchObject({ code: "invalid-recipient" });
  });
});

describe("Coordination → école, réponse du personnel (pas des parents)", () => {
  it("le personnel répond ; la réponse arrive chez le Coordinateur avec nom et rôle ; un parent est refusé", async () => {
    const sent = await coordinationSend({ recipientIds: [...STAFF.map((role) => `${role}-school-a`), "parent-school-a"], subject: "Info", body: "Texte" });
    const ids = sent.messageIds as string[];
    expect(ids).toHaveLength(7);
    const messages = await Promise.all(ids.map(async (id) => (await db.doc(`messages/${id}`).get()).data()!));
    expect(messages[0]).toMatchObject({ senderName: "Coordinateur Fictif", senderRole: "coordination_admin" });
    for (const message of messages) {
      const recipientId = message.recipientIds[0] as string;
      const role = recipientId.startsWith("parent") ? "parent" : recipientId.replace(/-school-a$/, "");
      expect(canReplyToMessage({ ...message, id: message.id } as never, { id: recipientId, role } as never)).toBe(role !== "parent");
      if (role === "parent") { await expect(sendCoordinationReply(db, { uid: recipientId, role, schoolId: "school-a", profile: { name: "Parent Fictif" } }, { replyToMessageId: message.id, body: "x", idempotencyKey: "p" })).rejects.toMatchObject({ code: "invalid-recipient" }); continue; }
      await sendCoordinationReply(db, staff(role), { replyToMessageId: message.id, body: `Réponse ${role}`, idempotencyKey: `reply-${role}`, schoolYearId: "year-a" });
    }
    const coordClient = client("coord", { role: "coordination_admin", coordinationId: "c1" });
    const unread = await assertSucceeds(getDocs(query(collection(coordClient, "notifications"), where("schoolId", "==", "school-a"), where("schoolYearId", "==", "year-a"), where("recipientUserId", "==", "coord"), where("read", "==", false))));
    expect(unread.size).toBe(6);
    expect(unread.docs.map((item) => item.data().title)).toContain("Réponse de teacher school-a (Enseignant)");
    const reply = (await assertSucceeds(getDoc(doc(coordClient, "messages", unread.docs[0].data().messageId)))).data();
    expect(reply?.senderRole).not.toBe("parent");
  });
});

describe("Administrateur → Coordination, puis réponse de la Coordination (régression du staging)", () => {
  it("la Coordination répond à l'Administrateur avec la référence du message d'origine", async () => {
    await db.doc("messages/admin-to-coord").set({ id: "admin-to-coord", schoolId: "school-a", schoolYearId: "year-a", senderId: "school_admin-school-a", senderName: "Admin", senderRole: "school_admin", recipientIds: ["coord"], participantIds: ["school_admin-school-a", "coord"], subject: "Question", body: "?", createdAt: new Date().toISOString() });
    const reply = await coordinationSend({ recipientIds: ["school_admin-school-a"], subject: "Re : Question", body: "Réponse", replyToMessageId: "admin-to-coord" });
    expect((reply.messageIds as string[])).toHaveLength(1);
    const message = (await db.doc(`messages/${(reply.messageIds as string[])[0]}`).get()).data();
    expect(message).toMatchObject({ senderRole: "coordination_admin", recipientIds: ["school_admin-school-a"], schoolId: "school-a" });
  });
});

describe("Coordination : envoi « Tous les … »", () => {
  it("envoie une seule fois à chaque parent de l'école (251), sans doublon, au-delà de 200, sans fuite vers une autre école", async () => {
    const sent = await coordinationSend({ audience: { role: "parent", schoolId: "school-a" }, subject: "Annonce", body: "À tous" }, "audience-key");
    expect(sent.recipientCount).toBe(251);
    const notifications = await db.collection("notifications").where("coordinationId", "==", "c1").get();
    const recipients = notifications.docs.map((item) => item.data().recipientUserId);
    expect(new Set(recipients).size).toBe(251);
    expect(recipients.every((id: string) => id.startsWith("parent"))).toBe(true);
    // Lot 25 : une seule copie chez l'expéditeur, « À : 251 parents » ; les destinataires ne le voient pas comme participant.
    const copies = await db.collection("messages").where("senderCopy", "==", true).get();
    expect(copies.size).toBe(1);
    expect(copies.docs[0].data()).toMatchObject({ participantIds: ["coord"], recipientLabel: "251 parents", recipientCount: 251 });
    const perRecipient = await db.collection("messages").where("groupId", "==", copies.docs[0].data().groupId).get();
    expect(perRecipient.docs.filter((item) => item.data().participantIds.includes("coord"))).toHaveLength(1);
    // Rejouer le même envoi ne crée rien de plus.
    await coordinationSend({ audience: { role: "parent", schoolId: "school-a" }, subject: "Annonce", body: "À tous" }, "audience-key");
    expect((await db.collection("notifications").where("coordinationId", "==", "c1").get()).size).toBe(251);
  }, 60_000);

  it("refuse une école hors de la Coordination", async () => {
    const res = response();
    await expect(sendCoordinationRequest({ headers: { "x-idempotency-key": "k" }, body: { audience: { role: "parent", schoolId: "school-b" }, subject: "x", body: "y" } } as never, res as never, db as never, coord as never)).rejects.toMatchObject({ code: "school-outside-coordination" });
  });
});
