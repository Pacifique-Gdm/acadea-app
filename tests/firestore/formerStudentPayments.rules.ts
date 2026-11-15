import { readFileSync } from "node:fs";
import { initializeApp, deleteApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc } from "firebase/firestore";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { executeFinancialOperation, listFormerStudentDebts, searchFormerStudents } from "../../api/_lib/financialTransactions.js";
import { studentForPersistence } from "../../src/utils/studentYearTransition.js";

// Lot 21 — « Paiement anciens élèves » sur l'émulateur Firestore réel.
const projectId = "demo-acadea-former-students";
let app: App, db: Firestore, environment: RulesTestEnvironment;
const cashier = { uid: "cashier-a", role: "cashier", schoolId: "school-a", email: "caisse@example.invalid" };
const student = (id: string, changes: Record<string, unknown> = {}) => studentForPersistence({ id, schoolId: "school-a", schoolYearId: "y1", matricule: `M-${id}`, nom: "Kabila", postnom: "Mbuyi", prenom: id, sexe: "F", birthDate: "2012-01-01", address: "", phone: "", className: "1ère Primaire", parentId: "parent-a", status: "ACTIVE", ...changes });
const pay = (changes: Record<string, unknown> = {}, caller = cashier) => executeFinancialOperation({ db, caller, body: { action: "create-payment", schoolYearId: "y2", formerStudentId: "former", feeTypeId: "fee-y1", debtSchoolYearId: "y1", amount: 50, clientRequestId: `former-request-${Math.random().toString(36).slice(2, 14)}`, ...changes } });

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST?.match(/^(127\.0\.0\.1|localhost):\d+$/)) throw new Error("Ce test exige exclusivement un Emulator Firestore local.");
  environment = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync("firestore.rules", "utf8") } });
  app = initializeApp({ projectId }, "former-students-tests"); db = getFirestore(app);
}, 120_000);
beforeEach(async () => {
  await environment.clearFirestore();
  const batch = db.batch();
  for (const [path, value] of Object.entries({
    "schools/school-a": { id: "school-a", status: "active", activeSchoolYearId: "y2", currency: "USD" },
    "schools/school-b": { id: "school-b", status: "active", activeSchoolYearId: "b2", currency: "USD" },
    "schoolYears/y1": { id: "y1", schoolId: "school-a", name: "2025-2026", startsAt: "2025-09-01", endsAt: "2026-07-31", status: "archived", currency: "USD" },
    "schoolYears/y2": { id: "y2", schoolId: "school-a", name: "2026-2027", startsAt: "2026-09-01", endsAt: "2027-07-31", status: "active", currency: "USD" },
    "schoolYears/b1": { id: "b1", schoolId: "school-b", name: "2025-2026", startsAt: "2025-09-01", endsAt: "2026-07-31", status: "archived", currency: "USD" },
    "users/cashier-a": { ...cashier, status: "active", name: "Caissier A" },
    "users/parent-user": { id: "parent-user", role: "parent", schoolId: "school-a", parentId: "parent-a", status: "active" },
    "parents/parent-a": { id: "parent-a", schoolId: "school-a", schoolYearId: "y1", userId: "parent-user", studentIds: ["former"] },
    "feeTypes/fee-y1": { id: "fee-y1", schoolId: "school-a", schoolYearId: "y1", name: "Minerval", amount: 100, className: "1ère Primaire" },
    "payments/old-payment": { id: "old-payment", schoolId: "school-a", schoolYearId: "y1", studentId: "former", feeTypeId: "fee-y1", amount: 30, currency: "USD", paidAt: "2026-01-10", receiptNumber: "REC-2025-0001", cashierName: "Caissier A" },
    "students/former": student("former", { status: "TRANSFERRED", deletedAt: "2026-08-20T00:00:00.000Z", exitReason: "Autre", exitReasonDetails: "Non réinscrit à la rentrée 2026-2027" }),
    "students/kept-old": student("kept-old", { prenom: "Reste", matricule: "M-kept" }),
    "students/kept-new": student("kept-new", { schoolYearId: "y2", prenom: "Reste", matricule: "M-kept", className: "2ème Primaire", importedFromStudentId: "kept-old" }),
    "feeTypes/fee-b1": { id: "fee-b1", schoolId: "school-b", schoolYearId: "b1", name: "Minerval", amount: 100, className: "1ère Primaire" },
    "students/foreign": { ...student("foreign", { schoolId: "school-b", schoolYearId: "b1", status: "TRANSFERRED", deletedAt: "2026-08-20T00:00:00.000Z" }) },
  })) batch.set(db.doc(path), value);
  await batch.commit();
});
afterAll(async () => { await environment?.cleanup(); if (app) await deleteApp(app); });

describe("lot 21 : paiement anciens élèves", () => {
  it("la recherche ne propose que les élèves archivés ayant une dette, frais par frais et année par année", async () => {
    const found = await searchFormerStudents({ db, caller: cashier, body: { action: "search-former-students", schoolYearId: "y2", query: "kabila" } });
    expect(found.students.map((item: { id: string }) => item.id)).toEqual(["former"]);
    expect(found.students[0].debts).toEqual([expect.objectContaining({ schoolYearId: "y1", yearName: "2025-2026", feeTypeId: "fee-y1", feeName: "Minerval", expected: 100, paid: 30, remaining: 70, currency: "USD" })]);
    const byMatricule = await searchFormerStudents({ db, caller: cashier, body: { action: "search-former-students", schoolYearId: "y2", query: "M-former" } });
    expect(byMatricule.students).toHaveLength(1);
  });

  it("encaisse dans la caisse de l'année active, diminue la dette de l'ancienne année, reçu normal et audit", async () => {
    const { payment } = await pay();
    expect(payment).toMatchObject({ schoolId: "school-a", schoolYearId: "y1", studentId: "former", collectionSchoolYearId: "y2", formerStudent: true, formerStudentId: "former", amount: 50, currency: "USD", parentId: "parent-a", receiptNumber: "REC-2026-0001", debtSchoolYearName: "2025-2026" });
    expect(payment).not.toHaveProperty("currentStudentId");
    const after = await listFormerStudentDebts({ db, caller: cashier, body: { action: "list-former-debts", schoolYearId: "y2", formerStudentId: "former" } });
    expect(after.debts).toEqual([expect.objectContaining({ paid: 80, remaining: 20 })]);
    const audits = await db.collection("auditLogs").where("resourceId", "==", payment.id).get();
    expect(audits.docs[0].data()).toMatchObject({ schoolYearId: "y2", metadata: expect.objectContaining({ formerStudent: true, debtSchoolYearId: "y1" }) });
    // L'ancienne fiche n'est pas modifiée : elle reste archivée avec son motif.
    expect((await db.doc("students/former").get()).data()).toMatchObject({ status: "TRANSFERRED", exitReasonDetails: "Non réinscrit à la rentrée 2026-2027" });
  });

  it("refuse un montant supérieur à la dette", async () => {
    await expect(pay({ amount: 70.01 })).rejects.toThrow("dépasse");
    expect((await db.collection("payments").where("formerStudent", "==", true).get()).size).toBe(0);
  });

  it("refuse un élève non archivé", async () => {
    await expect(pay({ formerStudentId: "kept-new" })).rejects.toThrow("n'est pas archivé");
    await expect(pay({ formerStudentId: "kept-old" })).rejects.toThrow("n'est pas archivé");
  });

  it("refuse l'élève d'une autre école", async () => {
    await expect(pay({ formerStudentId: "foreign" })).rejects.toMatchObject({ code: "not-found" });
    const found = await searchFormerStudents({ db, caller: cashier, body: { action: "search-former-students", schoolYearId: "y2", query: "foreign" } });
    expect(found.students).toEqual([]);
  });

  it("pas de double paiement : même demande rejouée, puis deux paiements simultanés", async () => {
    const first = await pay({ clientRequestId: "former-same-request-01" });
    const replay = await pay({ clientRequestId: "former-same-request-01" });
    expect(replay.payment.id).toBe(first.payment.id);
    expect((await db.collection("payments").where("formerStudent", "==", true).get()).size).toBe(1);
    const results = await Promise.allSettled([pay({ amount: 20 }), pay({ amount: 20 })]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    const total = (await db.collection("payments").where("studentId", "==", "former").get()).docs.reduce((sum, item) => sum + Number(item.data().amount), 0);
    expect(total).toBe(100);
  }, 60_000);

  it("le parent garde l'accès au paiement de son enfant parti", async () => {
    const { payment } = await pay();
    const parent = environment.authenticatedContext("parent-user", { role: "parent", schoolId: "school-a", parentId: "parent-a" }).firestore();
    expect((await assertSucceeds(getDoc(doc(parent, "payments", payment.id)))).data()).toMatchObject({ formerStudent: true, amount: 50 });
  });

  it("un ancien élève revenu cette année passe par le paiement normal", async () => {
    await db.doc("students/back").set(student("back", { schoolYearId: "y2", prenom: "former", matricule: "M-former", className: "2ème Primaire" }));
    await expect(pay()).rejects.toThrow("inscrit cette année");
    const found = await searchFormerStudents({ db, caller: cashier, body: { action: "search-former-students", schoolYearId: "y2", query: "kabila" } });
    expect(found.students).toEqual([]);
  });

  it("réservé au Caissier pour l'encaissement", async () => {
    await expect(pay({}, { ...cashier, role: "parent" })).rejects.toMatchObject({ code: "permission-denied" });
  });
});
