import { deleteApp, initializeApp } from "firebase-admin/app";
import { randomUUID } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { executeGradePublication } from "../../api/_lib/gradePublication.js";

const projectId = `demo-publication-${randomUUID().slice(0, 8)}`;
const app = initializeApp({ projectId }, "grade-publication-emulator-tests");
const db = getFirestore(app);
const director = { uid: "director", role: "study_director", schoolId: "school" };
const parent = { uid: "parent-user", role: "parent", schoolId: "school" };
const scope = { schoolId: "school", schoolYearId: "year" };
const publish = { action: "grades-publish", ...scope, classId: "class", slot: "period_1", requestId: "emulator-request-00001" };

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST?.match(/^(127\.0\.0\.1|localhost):\d+$/)) throw new Error("Émulateur Firestore local requis.");
}, 30000);
const paths = ["schools", "schoolYears", "users", "classes", "students", "subjects", "pedagogicalAssignments", "courseGradingConfigs", "gradeEntries", "parents", "gradePublicationRuns", "publishedGradeResults", "notifications", "feeTypes", "payments"];
async function cleanup() {
  if (!projectId.startsWith("demo-publication-") || !process.env.FIRESTORE_EMULATOR_HOST?.match(/^(127\.0\.0\.1|localhost):\d+$/)) throw new Error("Nettoyage non local refusé");
  for (const name of paths) {
    const snapshot = await db.collection(name).get();
    const batch = db.batch();
    snapshot.docs.forEach((item) => batch.delete(item.ref));
    await batch.commit();
    expect((await db.collection(name).get()).empty).toBe(true);
  }
}
beforeEach(async () => {
  await cleanup();
  const seed = db.batch();
  for (const [path, value] of Object.entries({
    "schools/school": { status: "active", activeSchoolYearId: "year", currency: "CDF" },
    "schoolYears/year": { schoolId: "school", name: "2027-2028", status: "active", currency: "CDF" },
    "users/director": { role: "study_director", schoolId: "school", active: true },
    "users/parent-user": { role: "parent", schoolId: "school", parentId: "parent", active: true },
    "users/other-parent": { role: "parent", schoolId: "school", parentId: "other", active: true },
    "classes/class": { schoolId: "school", schoolYearId: "year", name: "Classe fictive", active: true },
    "students/student": { schoolId: "school", schoolYearId: "year", classId: "class", className: "Classe fictive", status: "ACTIVE", nom: "Test", prenom: "Aline" },
    "subjects/math": { schoolId: "school", schoolYearId: "year", name: "Mathématiques" },
    "pedagogicalAssignments/assignment": { schoolId: "school", schoolYearId: "year", classId: "class", subjectId: "math", teacherId: "teacher", active: true },
    "courseGradingConfigs/config": { schoolId: "school", schoolYearId: "year", classId: "class", subjectId: "math", gradingSlot: "period_1", maxScore: 20 },
    "gradeEntries/grade": { schoolId: "school", schoolYearId: "year", classId: "class", subjectId: "math", studentId: "student", gradingSlot: "period_1", status: "graded", score: 12, maxScoreSnapshot: 20 },
    "parents/parent": { schoolId: "school", schoolYearId: "year", status: "active", studentIds: ["student"] },
    "parents/other": { schoolId: "school", schoolYearId: "year", status: "active", studentIds: [] },
    "feeTypes/fee": { ...scope, name: "Frais fictifs" },
    "payments/payment": { ...scope, studentId: "student", feeTypeId: "fee", amount: 100, currency: "CDF", status: "validated" },
  })) seed.set(db.doc(path), value);
  await seed.commit();
}, 30000);
afterAll(async () => { await cleanup(); await deleteApp(app); }, 30000);

describe("publication réelle sur l'émulateur Firestore", () => {
  it("publie une seule période atomiquement et reste idempotente en double appel", async () => {
    const attempts = await Promise.allSettled([
      executeGradePublication({ db, caller: director, body: publish }),
      executeGradePublication({ db, caller: director, body: publish }),
    ]);
    for (const attempt of attempts) {
      if (attempt.status === "rejected") expect(attempt.reason).toMatchObject({ status: 409, code: "publication-conflict" });
    }
    // Pessimistic lock contention may reject both attempts. The API deliberately
    // asks the client to retry instead of silently recalculating a publication.
    const recovered = await executeGradePublication({ db, caller: director, body: publish });
    expect(recovered).toMatchObject({ ok: true, publishedCount: 1 });
    // A response lost on the network is retried with the same request ID.
    expect(await executeGradePublication({ db, caller: director, body: publish })).toMatchObject({ repeated: true });
    expect((await db.collection("gradePublicationRuns").get()).size).toBe(1);
    expect((await db.collection("publishedGradeResults").get()).size).toBe(1);
    expect((await db.collection("notifications").get()).size).toBe(1);
    const result = await executeGradePublication({ db, caller: parent, body: { action: "grades-parent-read", ...scope, studentId: "student", slot: "period_1" } });
    expect(result.result.result).toMatchObject({ percentage: 60, rank: 1 });
    await expect(executeGradePublication({ db, caller: parent, body: { action: "grades-parent-read", ...scope, studentId: "student", slot: "period_2" } })).rejects.toMatchObject({ status: 404 });
    await expect(executeGradePublication({ db, caller: { uid: "other-parent", role: "parent", schoolId: "school" }, body: { action: "grades-parent-read", ...scope, studentId: "student", slot: "period_1" } })).rejects.toMatchObject({ status: 403 });
    await db.doc("parents/parent").update({ studentIds: [] });
    await expect(executeGradePublication({ db, caller: parent, body: { action: "grades-parent-read", ...scope, studentId: "student", slot: "period_1" } })).rejects.toMatchObject({ status: 403 });
  }, 30000);

  it("bloque l'année archivée sans toucher aux résultats existants", async () => {
    await db.doc("schoolYears/year").update({ status: "archived" });
    await expect(executeGradePublication({ db, caller: director, body: publish })).rejects.toMatchObject({ status: 403 });
    expect((await db.collection("gradePublicationRuns").get()).empty).toBe(true);
  });

  const changes = [
    { name: "cote modifiée", collection: "gradeEntries", path: "gradeEntries/grade", data: { score: 4 }, expected: 20, count: 0 },
    { name: "maximum modifié (cote historique sans instantané)", collection: "courseGradingConfigs", path: "courseGradingConfigs/config", data: { maxScore: 40 }, expected: 30, count: 0 },
    { name: "paiement ajouté", collection: "payments", path: "payments/added", data: { ...scope, studentId: "student", feeTypeId: "fee", amount: 100, currency: "CDF", status: "validated" }, expected: 60, count: 1 },
    { name: "paiement annulé", collection: "payments", path: "payments/payment", data: { status: "cancelled" }, expected: 60, count: 0 },
    { name: "paiement remboursé", collection: "payments", path: "payments/payment", data: { status: "refunded" }, expected: 60, count: 0 },
  ];
  for (const change of changes) {
    it(`utilise l'état courant à l'entrée de la transaction : ${change.name}`, async () => {
      if (change.collection === "courseGradingConfigs") await db.doc("gradeEntries/grade").set({ ...scope, classId: "class", subjectId: "math", studentId: "student", gradingSlot: "period_1", status: "graded", score: 12 });
      if (change.name === "paiement ajouté") await db.doc("payments/payment").delete();
      const source = {
        doc: db.doc.bind(db), collection: db.collection.bind(db),
        runTransaction: async (callback: Parameters<typeof db.runTransaction>[0], options: Parameters<typeof db.runTransaction>[1]) => {
          await db.doc(change.path).set(change.data, { merge: true });
          return db.runTransaction(callback, options);
        },
      };
      const result = await executeGradePublication({ db: source, caller: director, body: { ...publish, percentage: { operator: "gte", value: 50 }, fee: { feeTypeId: "fee", operator: "gte", amountMinor: 10000 } } });
      expect(result.publishedCount).toBe(change.count);
      if (change.count) expect((await db.collection("publishedGradeResults").get()).docs[0].data().result.percentage).toBe(change.expected);
    }, 30000);

    it(`sérialise ou refuse une écriture réellement concurrente : ${change.name}`, async () => {
      if (change.name === "paiement ajouté") await db.doc("payments/payment").delete();
      const query = change.collection === "payments"
        ? db.collection("payments").where("schoolId", "==", "school").where("schoolYearId", "==", "year").where("studentId", "==", "student").where("feeTypeId", "==", "fee").limit(2001)
        : db.collection(change.collection).where("schoolId", "==", "school").where("schoolYearId", "==", "year").where("classId", "in", ["class"]).limit(2001);
      let concurrent: ReturnType<ReturnType<typeof db.doc>["set"]> | undefined;
      const source = {
        doc: db.doc.bind(db), collection: db.collection.bind(db),
        runTransaction: (callback: (tx: unknown) => Promise<unknown>, options: Parameters<typeof db.runTransaction>[1]) => db.runTransaction((tx) => callback({
          get: async (ref: Parameters<typeof tx.get>[0]) => {
            const result = await tx.get(ref);
            if (!concurrent && "isEqual" in ref && ref.isEqual(query as never)) {
              concurrent = db.doc(change.path).set(change.data, { merge: true });
              // Observe rejection immediately; inspect the result below.
              void concurrent.catch(() => undefined);
            }
            return result;
          },
          create: tx.create.bind(tx), set: tx.set.bind(tx), update: tx.update.bind(tx),
        }), options),
      };
      let published: Awaited<ReturnType<typeof executeGradePublication>> | undefined;
      try {
        published = await executeGradePublication({ db: source, caller: director, body: { ...publish, fee: { feeTypeId: "fee", operator: "gte", amountMinor: 10000 } } });
      } catch (error) {
        expect(error).toMatchObject({ status: 409, code: "publication-conflict" });
      }
      expect(concurrent, "La mutation concurrente doit réellement avoir été déclenchée").toBeDefined();
      const changed = await concurrent!;
      if (published) {
        const run = await db.doc(`gradePublicationRuns/${published.publicationId}`).get();
        expect(run.updateTime!.toMillis()).toBeLessThanOrEqual(changed.writeTime.toMillis());
      } else {
        expect((await db.collection("gradePublicationRuns").get()).empty).toBe(true);
        expect((await db.collection("notifications").get()).empty).toBe(true);
      }
    }, 30000);
  }
});
