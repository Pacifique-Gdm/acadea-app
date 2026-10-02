import { readFileSync } from "node:fs";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { saveStudyAssignments, setStudyAssignmentActive } from "../../api/_lib/studyAssignmentGrants.js";

const projectId = "acadea-staging";
const schoolId = "school-a", schoolYearId = "year-a", teacherId = "teacher-a", ownerId = "owner-a";
const subjectId = "subject-a", classId = "class-a";
const assignmentId = `${schoolId}__${schoolYearId}__${teacherId}__${subjectId}__${classId}`;
const path = `teacher-documents/${schoolId}/${schoolYearId}/${ownerId}/${teacherId}/${assignmentId}/document-a/123e4567-e89b-12d3-a456-426614174000.pdf`;
const caller = { uid: "director-a", role: "study_director", schoolId };
let app: App, db: Firestore, environment: RulesTestEnvironment;
const upload = () => environment.authenticatedContext(ownerId, { role: "teacher", schoolId }).storage().ref(path).put(new Uint8Array(128), {
  contentType: "application/pdf", customMetadata: { schoolId, schoolYearId, ownerId, teacherId, assignmentId, documentId: "document-a", originalName: "fiche.pdf" },
});

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST?.match(/^(127\.0\.0\.1|localhost):\d+$/) || !process.env.FIREBASE_STORAGE_EMULATOR_HOST?.match(/^(127\.0\.0\.1|localhost):\d+$/)) throw new Error("Émulateurs Firestore et Storage locaux requis.");
  environment = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync("firestore.rules", "utf8") }, storage: { rules: readFileSync("storage.rules", "utf8") } });
  app = initializeApp({ projectId }, "study-storage-grant-tests"); db = getFirestore(app);
}, 30_000);
beforeEach(async () => {
  await environment.clearFirestore(); await environment.clearStorage();
  const batch = db.batch();
  for (const [key, value] of Object.entries({
    [`schools/${schoolId}`]: { status: "active", activeSchoolYearId: schoolYearId },
    [`schoolYears/${schoolYearId}`]: { schoolId, status: "active" },
    "users/director-a": { id: "director-a", role: "study_director", schoolId, status: "active", active: true },
    [`users/${ownerId}`]: { id: ownerId, role: "teacher", schoolId, status: "active", active: true },
    [`teachers/${teacherId}`]: { id: teacherId, userId: ownerId, schoolId, schoolYearId, status: "active", active: true },
    [`subjects/${subjectId}`]: { id: subjectId, schoolId, schoolYearId, active: true },
    [`classes/${classId}`]: { id: classId, schoolId, schoolYearId, name: "Classe A", active: true },
  })) batch.set(db.doc(key), value);
  await batch.commit();
});
afterAll(async () => { await environment.cleanup(); await deleteApp(app); }, 30_000);

describe("transaction serveur affectation + grant Storage", () => {
  it("autorise l'upload après création puis le refuse dès désactivation", async () => {
    await assertFails(upload());
    await saveStudyAssignments({ db, caller, body: { schoolId, schoolYearId, teacherId, subjectIds: [subjectId], classSelections: [{ classId }], weeklyPeriods: 2, active: true } });
    expect((await db.doc(`users/${ownerId}`).get()).data()?.storageAssignmentKeys).toEqual([`${schoolId}/${schoolYearId}/${teacherId}/${assignmentId}`]);
    await assertSucceeds(upload());
    await setStudyAssignmentActive({ db, caller, body: { schoolId, schoolYearId, assignmentId, active: false } });
    expect((await db.doc(`users/${ownerId}`).get()).data()?.storageAssignmentKeys).toEqual([]);
    await assertFails(upload());
  });
  it("un profil legacy sans userId conserve l'affectation mais aucun grant", async () => {
    await db.doc(`teachers/${teacherId}`).update({ userId: null });
    await saveStudyAssignments({ db, caller, body: { schoolId, schoolYearId, teacherId, subjectIds: [subjectId], classSelections: [{ classId }], weeklyPeriods: 2, active: true } });
    expect((await db.doc(`pedagogicalAssignments/${assignmentId}`).get()).data()?.active).toBe(true);
    expect((await db.doc(`users/${ownerId}`).get()).data()?.storageAssignmentKeys).toBeUndefined();
    await assertFails(upload());
  });
  it("accepte une option portée par une sous-classe dont l'ID diffère de la clé métier", async () => {
    const optionId = `${classId}::litteraire`;
    await db.doc("classes/subclass-a").set({ id: "subclass-a", schoolId, schoolYearId, parentClassId: classId, classOptionKey: optionId, subClassLabel: "A", name: "Classe Littéraire A", active: true });
    await saveStudyAssignments({ db, caller, body: { schoolId, schoolYearId, teacherId, subjectIds: [subjectId], classSelections: [{ classId, courseScope: "option", targetOptionIds: [optionId] }], titularClassIds: ["subclass-a"], weeklyPeriods: 2, active: true } });
    const scopedAssignmentId = `${assignmentId}__option--${encodeURIComponent(optionId)}`;
    expect((await db.doc(`pedagogicalAssignments/${scopedAssignmentId}`).get()).data()?.titularClassId).toBe("subclass-a");
    expect((await db.doc(`users/${ownerId}`).get()).data()?.storageAssignmentKeys).toEqual([`${schoolId}/${schoolYearId}/${teacherId}/${scopedAssignmentId}`]);
  });
});
