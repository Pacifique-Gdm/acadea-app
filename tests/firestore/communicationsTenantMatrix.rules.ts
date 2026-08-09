import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, setDoc, startAfter, updateDoc, where } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const projectId = "demo-acadea-communications-matrix";
let environment: RulesTestEnvironment;
const schoolA = "school-a";
const schoolB = "school-b";
const yearA = "year-a";
const yearB = "year-b";

function auth(uid: string, role: string, schoolId = schoolA, extra: Record<string, unknown> = {}) {
  return environment.authenticatedContext(uid, { role, schoolId, ...extra }).firestore();
}

async function seed(path: string, data: Record<string, unknown>) {
  await environment.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), path), data));
}

beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync("firestore.rules", "utf8") } });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await seed(`schoolYears/${yearA}`, { id: yearA, schoolId: schoolA, status: "active" });
  await seed(`schoolYears/${yearB}`, { id: yearB, schoolId: schoolB, status: "active" });
  const shared = { schoolId: schoolA, schoolYearId: yearA };
  await seed("messages/message-a", { id: "message-a", ...shared, threadParentId: "parent-a", schoolRecipient: "admin" });
  await seed("messages/message-secretary", { id: "message-secretary", ...shared, senderId: "admin-a", recipientParentId: "school", participantIds: ["admin-a", "secretary-a"], recipientIds: ["secretary-a"], subject: "Objet", body: "Corps", createdAt: "2026-08-08T10:00:00.000Z" });
  await seed("messages/message-secretary-parent", { id: "message-secretary-parent", ...shared, senderId: "secretary-a", recipientParentId: "school", participantIds: ["secretary-a", "parent-user-a"], recipientIds: ["parent-user-a"], subject: "Objet parent", body: "Corps", createdAt: "2026-08-08T11:00:00.000Z" });
  await seed("messages/message-administrative-group", { id: "message-administrative-group", ...shared, senderId: "admin-a", recipientParentId: "school", participantIds: ["admin-a", "cashier-a", "secretary-a", "discipline-a"], recipientIds: ["cashier-a", "secretary-a", "discipline-a"], subject: "Objet groupe", body: "Corps", createdAt: "2026-08-08T12:00:00.000Z" });
  await seed("conversations/conversation-a", { id: "conversation-a", ...shared, parentId: "parent-a", threadId: "thread-a", threadParentId: "parent-a", schoolRecipient: "admin" });
  await seed("conversations/conversation-secretary", { id: "conversation-secretary", ...shared, parentId: "school", threadId: "thread-secretary", threadParentId: "school", participantIds: ["admin-a", "secretary-a"] });
  await seed("conversations/conversation-secretary-parent", { id: "conversation-secretary-parent", ...shared, parentId: "school", threadId: "thread-secretary-parent", threadParentId: "school", participantIds: ["secretary-a", "parent-user-a"] });
  await seed("notifications/notification-a", { id: "notification-a", ...shared, parentId: "parent-a", recipientRole: "school", schoolRecipient: "admin" });
  await seed("notifications/notification-admin-personal", { id: "notification-admin-personal", ...shared, recipientUserId: "admin-a", type: "message", read: false, createdAt: "2026-08-08T12:00:00.000Z" });
  await seed("notifications/notification-admin-personal-older", { id: "notification-admin-personal-older", ...shared, recipientUserId: "admin-a", type: "message", read: true, createdAt: "2026-08-08T11:00:00.000Z" });
  await seed("notifications/notification-parent-personal", { id: "notification-parent-personal", ...shared, recipientUserId: "parent-user-a", type: "message", read: false, createdAt: "2026-08-08T12:00:00.000Z" });
  await seed("disciplineSanctions/sanction-a", { id: "sanction-a", ...shared, status: "active" });
  await seed("attendance/attendance-a", { id: "attendance-a", ...shared, studentId: "student-a", status: "present" });
  await seed("messages/messages-b", { id: "messages-b", schoolId: schoolB, schoolYearId: yearB, threadParentId: "parent-b", schoolRecipient: "admin" });
  await seed("conversations/conversations-b", { id: "conversations-b", schoolId: schoolB, schoolYearId: yearB, parentId: "parent-b", threadId: "thread-b", threadParentId: "parent-b", schoolRecipient: "admin" });
  await seed("notifications/notifications-b", { id: "notifications-b", schoolId: schoolB, schoolYearId: yearB, parentId: "parent-b", recipientRole: "school", schoolRecipient: "admin" });
  await seed("disciplineSanctions/disciplineSanctions-b", { id: "disciplineSanctions-b", schoolId: schoolB, schoolYearId: yearB, status: "active" });
  await seed("attendance/attendance-b", { id: "attendance-b", schoolId: schoolB, schoolYearId: yearB, studentId: "student-b", status: "present" });
});

afterAll(async () => environment.cleanup());

describe("SEC-015 — communications, notifications et discipline", () => {
  it("isole les lectures administrateur et les requêtes de liste par école", async () => {
    const admin = auth("admin-a", "school_admin");
    for (const [name, id] of [["messages", "message-a"], ["conversations", "conversation-a"], ["notifications", "notification-a"], ["disciplineSanctions", "sanction-a"], ["attendance", "attendance-a"]]) {
      await assertSucceeds(getDoc(doc(admin, name, id)));
      const tenantQuery = name === "conversations" || name === "messages"
        ? query(collection(admin, name), where("schoolId", "==", schoolA), where("schoolRecipient", "==", "admin"))
        : query(collection(admin, name), where("schoolId", "==", schoolA));
      const result = await assertSucceeds(getDocs(tenantQuery));
      expect(result.docs.every((item) => item.data().schoolId === schoolA)).toBe(true);
      await assertFails(getDoc(doc(auth("admin-b", "school_admin", schoolB), name, id)));
    }
  });

  it("refuse les rôles inconnus et les accès non authentifiés", async () => {
    for (const [name, id] of [["messages", "message-a"], ["conversations", "conversation-a"], ["notifications", "notification-a"], ["disciplineSanctions", "sanction-a"], ["attendance", "attendance-a"]]) {
      await assertFails(getDoc(doc(auth("unknown-a", "unknown"), name, id)));
      await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), name, id)));
    }
  });

  it("limite la messagerie Secrétaire au participant exact et au même établissement", async () => {
    const secretary = auth("secretary-a", "secretary");
    await assertSucceeds(getDoc(doc(secretary, "messages", "message-secretary")));
    await assertSucceeds(getDoc(doc(secretary, "conversations", "conversation-secretary")));
    const list = await assertSucceeds(getDocs(query(collection(secretary, "messages"), where("schoolId", "==", schoolA), where("schoolYearId", "==", yearA), where("participantIds", "array-contains", "secretary-a"))));
    expect(list.docs.map((item) => item.id).sort()).toEqual([
      "message-administrative-group",
      "message-secretary",
      "message-secretary-parent",
    ]);
    await assertFails(getDoc(doc(auth("secretary-b", "secretary"), "messages", "message-secretary")));
    await assertFails(getDoc(doc(auth("secretary-other-school", "secretary", schoolB), "messages", "message-secretary")));
  });

  it("refuse la création directe du nouveau format serveur", async () => {
    const admin = auth("admin-a", "school_admin");
    await assertFails(setDoc(doc(admin, "messages", "message-forged"), { id: "message-forged", schoolId: schoolA, schoolYearId: yearA, participantIds: ["admin-a", "secretary-a"], recipientIds: ["secretary-a"] }));
    await assertFails(setDoc(doc(auth("secretary-a", "secretary"), "messages", "message-secretary-forged"), { id: "message-secretary-forged", schoolId: schoolA, schoolYearId: yearA, participantIds: ["secretary-a", "admin-a"], recipientIds: ["admin-a"] }));
  });

  it("limite un parent à ses propres messages, conversations et notifications", async () => {
    const parent = auth("parent-user-a", "parent", schoolA, { parentId: "parent-a" });
    await assertSucceeds(getDoc(doc(parent, "messages", "message-a")));
    await assertSucceeds(getDoc(doc(parent, "conversations", "conversation-a")));
    await assertSucceeds(getDoc(doc(parent, "notifications", "notification-a")));
    await assertSucceeds(getDoc(doc(parent, "messages", "message-secretary-parent")));
    await assertSucceeds(getDoc(doc(parent, "conversations", "conversation-secretary-parent")));
    await assertSucceeds(getDoc(doc(parent, "notifications", "notification-parent-personal")));
    const otherParent = auth("parent-user-x", "parent", schoolA, { parentId: "parent-x" });
    await assertFails(getDoc(doc(otherParent, "messages", "message-a")));
    await assertFails(getDoc(doc(otherParent, "conversations", "conversation-a")));
    await assertFails(getDoc(doc(otherParent, "notifications", "notification-a")));
    await assertFails(getDoc(doc(otherParent, "messages", "message-secretary-parent")));
    await assertFails(getDoc(doc(otherParent, "conversations", "conversation-secretary-parent")));
    await assertFails(getDoc(doc(otherParent, "notifications", "notification-parent-personal")));
  });

  it("isole la lecture des notifications personnelles par destinataire", async () => {
    const admin = auth("admin-a", "school_admin");
    const cashier = auth("cashier-a", "cashier");
    await assertSucceeds(getDoc(doc(admin, "notifications", "notification-admin-personal")));
    await assertSucceeds(updateDoc(doc(admin, "notifications", "notification-admin-personal"), { read: true }));
    await assertFails(getDoc(doc(cashier, "notifications", "notification-admin-personal")));
  });

  it.each([
    ["admin-a", "school_admin"],
    ["cashier-a", "cashier"],
    ["secretary-a", "secretary"],
    ["discipline-a", "discipline_director"],
  ])("autorise la query temps reel exacte au participant %s", async (uid, role) => {
    const database = auth(uid, role);
    const result = await assertSucceeds(getDocs(query(
      collection(database, "messages"),
      where("schoolId", "==", schoolA),
      where("schoolYearId", "==", yearA),
      where("participantIds", "array-contains", uid),
      orderBy("createdAt", "desc"),
      limit(30),
    )));
    expect(result.docs.some((item) => item.id === "message-administrative-group")).toBe(true);
  });

  it("autorise la query notification exacte au destinataire et isole les autres UID", async () => {
    const admin = auth("admin-a", "school_admin");
    const own = await assertSucceeds(getDocs(query(
      collection(admin, "notifications"),
      where("schoolId", "==", schoolA),
      where("schoolYearId", "==", yearA),
      where("recipientUserId", "==", "admin-a"),
      orderBy("createdAt", "desc"),
      limit(30),
    )));
    expect(own.docs.map((item) => item.id)).toContain("notification-admin-personal");
    await assertFails(getDoc(doc(auth("cashier-a", "cashier"), "notifications", "notification-admin-personal")));
  });

  it("autorise la pagination notification exacte avec startAfter", async () => {
    const admin = auth("admin-a", "school_admin");
    const base = [
      where("schoolId", "==", schoolA),
      where("schoolYearId", "==", yearA),
      where("recipientUserId", "==", "admin-a"),
      orderBy("createdAt", "desc"),
    ];
    const firstPage = await assertSucceeds(getDocs(query(collection(admin, "notifications"), ...base, limit(1))));
    expect(firstPage.docs).toHaveLength(1);
    const secondPage = await assertSucceeds(getDocs(query(
      collection(admin, "notifications"),
      ...base,
      startAfter(firstPage.docs[0]),
      limit(1),
    )));
    expect(secondPage.docs).toHaveLength(1);
    expect(secondPage.docs[0].id).not.toBe(firstPage.docs[0].id);
  });

  it("refuse les écritures discipline dans l'année d'une autre école", async () => {
    const discipline = auth("discipline-a", "discipline_director");
    await assertFails(setDoc(doc(discipline, "attendance", "attendance-wrong-year"), { id: "attendance-wrong-year", schoolId: schoolA, schoolYearId: yearB, studentId: "student-a", status: "absent" }));
    await assertFails(setDoc(doc(discipline, "disciplineSanctions", "sanction-wrong-year"), {
      id: "sanction-wrong-year", schoolId: schoolA, schoolYearId: yearB, studentId: "student-a", studentName: "Élève",
      className: "1 A", reason: "Retard", sanctionType: "Avertissement", duration: 1, startDate: "2026-08-01",
      expectedEndDate: "2026-08-02", status: "active", createdBy: "discipline-a", createdAt: "2026-08-01T08:00:00.000Z",
    }));
  });

  it("autorise les créations métier attendues et refuse le mauvais rôle", async () => {
    const admin = auth("admin-a", "school_admin");
    await assertSucceeds(setDoc(doc(admin, "messages", "message-new"), { id: "message-new", schoolId: schoolA, schoolYearId: yearA, schoolRecipient: "admin" }));
    await assertSucceeds(setDoc(doc(admin, "conversations", "conversation-new"), { id: "conversation-new", schoolId: schoolA, schoolYearId: yearA, parentId: "parent-a", threadId: "thread-new", threadParentId: "parent-a", schoolRecipient: "admin" }));
    await assertSucceeds(setDoc(doc(admin, "notifications", "notification-new"), { id: "notification-new", schoolId: schoolA, schoolYearId: yearA, recipientRole: "school", schoolRecipient: "admin" }));
    const parent = auth("parent-a", "parent", schoolA, { parentId: "parent-a" });
    await assertFails(setDoc(doc(parent, "messages", "message-parent"), { id: "message-parent", schoolId: schoolA, schoolYearId: yearA, threadParentId: "parent-a" }));
    await assertFails(setDoc(doc(admin, "messages", "message-wrong-year"), { id: "message-wrong-year", schoolId: schoolA, schoolYearId: yearB, schoolRecipient: "admin" }));
  });

  it("couvre les transitions discipline/présence et interdit les suppressions", async () => {
    const discipline = auth("discipline-a", "discipline_director");
    const sanction = {
      id: "sanction-new", schoolId: schoolA, schoolYearId: yearA, studentId: "student-a", studentName: "Élève",
      className: "1 A", reason: "Retard", sanctionType: "Avertissement", duration: 1, startDate: "2026-08-01",
      expectedEndDate: "2026-08-02", status: "active", createdBy: "discipline-a", createdAt: "2026-08-01T08:00:00.000Z",
    };
    await assertSucceeds(setDoc(doc(discipline, "disciplineSanctions", "sanction-new"), sanction));
    await assertSucceeds(updateDoc(doc(discipline, "disciplineSanctions", "sanction-new"), { status: "completed", completedBy: "discipline-a" }));
    await assertFails(deleteDoc(doc(discipline, "disciplineSanctions", "sanction-new")));
    await assertSucceeds(setDoc(doc(discipline, "attendance", "attendance-new"), { id: "attendance-new", schoolId: schoolA, schoolYearId: yearA, studentId: "student-a", status: "present" }));
    await assertSucceeds(updateDoc(doc(discipline, "attendance", "attendance-new"), { status: "absent" }));
    await assertFails(deleteDoc(doc(discipline, "attendance", "attendance-new")));
    await assertSucceeds(deleteDoc(doc(auth("admin-a", "school_admin"), "messages", "message-a")));
    await assertFails(deleteDoc(doc(auth("admin-a", "school_admin"), "conversations", "conversation-a")));
    await assertFails(deleteDoc(doc(auth("admin-a", "school_admin"), "notifications", "notification-a")));
  });
});
