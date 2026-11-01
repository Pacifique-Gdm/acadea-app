import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, query, where, getDocs, deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let environment: RulesTestEnvironment;
const actor = (uid: string, role: string, schoolId = "school-a") => environment.authenticatedContext(uid, { role, schoolId }).firestore();

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId: "demo-acadea-section-admin-release-gate",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
}, 30_000);

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (admin) => {
    const db = admin.firestore();
    await Promise.all([
      setDoc(doc(db, "schools", "school-a"), { status: "active" }),
      setDoc(doc(db, "users", "section-a"), { role: "primary_admin", schoolId: "school-a", status: "active", sectionIds: ["Primaire"] }),
      setDoc(doc(db, "users", "admin-a"), { role: "school_admin", schoolId: "school-a", status: "active" }),
      setDoc(doc(db, "students", "student-a"), { schoolId: "school-a", schoolYearId: "year-a", section: "Primaire", nom: "Fictif" }),
      setDoc(doc(db, "payments", "payment-a"), { schoolId: "school-a", schoolYearId: "year-a", studentId: "student-a", amount: 10 }),
      setDoc(doc(db, "messages", "message-a"), { schoolId: "school-a", schoolYearId: "year-a", section: "Primaire", participantIds: ["section-a"] }),
    ]);
  });
});
afterAll(async () => environment?.cleanup(), 30_000);

describe("autorisations normales des profils administratifs de section", () => {
  it.each(["kindergarten_admin", "primary_admin", "studies_prefect"])("autorise les échanges bornés de %s, réserve les dossiers aux API", async (role) => {
    await environment.withSecurityRulesDisabled(async (admin) => {
      await updateDoc(doc(admin.firestore(), "users", "section-a"), { role });
    });
    const db = actor("section-a", role);
    await assertFails(getDoc(doc(db, "students", "student-a")));
    await assertFails(getDoc(doc(db, "payments", "payment-a")));
    await assertSucceeds(getDoc(doc(db, "messages", "message-a")));
    await assertSucceeds(getDoc(doc(db, "schools", "school-a")));
    await assertSucceeds(getDocs(query(collection(db, "messages"), where("schoolId", "==", "school-a"), where("section", "in", ["Primaire"]), where("participantIds", "array-contains", "section-a"))));
    await assertFails(getDocs(query(collection(db, "messages"), where("schoolId", "==", "school-a"))));
  });

  it.each([{ section: "Secondaire" }, { schoolId: "school-b" }, { participantIds: ["other"] }, { section: null }])("refuse l'échange hors périmètre %j", async patch => {
    await environment.withSecurityRulesDisabled(async admin => updateDoc(doc(admin.firestore(), "messages", "message-a"), patch));
    await assertFails(getDoc(doc(actor("section-a", "primary_admin"), "messages", "message-a")));
  });

  it.each([{ status: "inactive" }, { active: false }, { sectionIds: [] }, { sectionIds: ["unknown"] }, { deletedAt: "now" }])("révoque la lecture immédiatement pour %j", async patch => {
    await environment.withSecurityRulesDisabled(async admin => updateDoc(doc(admin.firestore(), "users", "section-a"), patch));
    await assertFails(getDoc(doc(actor("section-a", "primary_admin"), "messages", "message-a")));
  });

  it("isole les notifications et conserve leurs mutations côté serveur", async () => {
    await environment.withSecurityRulesDisabled(async admin => {
      const db = admin.firestore();
      await setDoc(doc(db, "notifications", "own"), { schoolId: "school-a", schoolYearId: "year-a", section: "Primaire", recipientUserId: "section-a", read: false });
      await setDoc(doc(db, "notifications", "other"), { schoolId: "school-a", schoolYearId: "year-a", section: "Primaire", recipientUserId: "other", read: false });
    });
    const db = actor("section-a", "primary_admin");
    await assertSucceeds(getDoc(doc(db, "notifications", "own")));
    await assertFails(getDoc(doc(db, "notifications", "other")));
    await assertFails(updateDoc(doc(db, "notifications", "own"), { read: true }));
  });

  it("refuse une ancienne claim school_admin contre un profil de section", async () => {
    await assertFails(getDoc(doc(actor("section-a", "school_admin"), "students", "student-a")));
    await assertFails(updateDoc(doc(actor("section-a", "school_admin"), "students", "student-a"), { phone: "000" }));
  });

  it("préserve la lecture historique de l'administrateur principal", async () => {
    await assertSucceeds(getDoc(doc(actor("admin-a", "school_admin"), "students", "student-a")));
  });

  it.each(["kindergarten_admin", "primary_admin", "studies_prefect"])("refuse les mutations directes interdites à %s", async (role) => {
    await environment.withSecurityRulesDisabled(async (admin) => {
      await updateDoc(doc(admin.firestore(), "users", "section-a"), { role });
      for (const collection of ["parents", "expenses", "cashInflows", "personnelPayments"]) {
        await setDoc(doc(admin.firestore(), collection, "fixture-a"), { schoolId: "school-a", schoolYearId: "year-a", amount: 10 });
      }
    });
    const db = actor("section-a", role);
    for (const patch of [{ name: "Compte modifié" }, { role: "school_admin" }, { sectionIds: ["Secondaire"] }, { active: true }]) {
      await assertFails(updateDoc(doc(db, "users", "section-a"), patch));
    }
    await assertFails(deleteDoc(doc(db, "users", "section-a")));
    await assertFails(setDoc(doc(db, "users", "new-parent"), { schoolId: "school-a", role: "parent" }));
    await assertFails(deleteDoc(doc(db, "students", "student-a")));
    await assertFails(updateDoc(doc(db, "students", "student-a"), { section: "Secondaire" }));
    await assertFails(deleteDoc(doc(db, "payments", "payment-a")));
    await assertFails(updateDoc(doc(db, "payments", "payment-a"), { status: "cancelled", amount: 0 }));
    for (const collection of ["parents", "expenses", "cashInflows", "personnelPayments"]) {
      await assertFails(setDoc(doc(db, collection, "created-a"), { schoolId: "school-a", schoolYearId: "year-a", amount: 1 }));
      await assertFails(updateDoc(doc(db, collection, "fixture-a"), { amount: 0, status: "cancelled" }));
      await assertFails(deleteDoc(doc(db, collection, "fixture-a")));
    }
  });
});
