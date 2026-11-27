import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

// Lots 10 et 11 : conseillers. Règles AJOUTÉES : profil, école, années, calendrier (lecture),
// ses notifications, ses messages, ses jetons de notification. Rien d'autre : ni argent, ni élèves,
// ni cotes, ni fiches de visite, ni notes de suivi (tout cela passe par le serveur).
let environment: RulesTestEnvironment;
const as = (uid: string, role: string, schoolId = "school-a") => environment.authenticatedContext(uid, { role, schoolId }).firestore();
const advisorRoles = ["pedagogical_advisor", "orientation_advisor"] as const;

beforeAll(async () => { environment = await initializeTestEnvironment({ projectId: "demo-advisors", firestore: { rules: readFileSync("firestore.rules", "utf8") } }); }, 60000);
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "schools/school-a"), { status: "active", schoolType: "Mixte" });
    await setDoc(doc(db, "schools/school-b"), { status: "active" });
    await setDoc(doc(db, "schoolYears/year-a"), { schoolId: "school-a", status: "active", name: "2026-2027" });
    await setDoc(doc(db, "schoolYears/year-b"), { schoolId: "school-b", status: "active", name: "2026-2027" });
    for (const role of advisorRoles) await setDoc(doc(db, `users/${role}`), { role, schoolId: "school-a", status: "active", active: true, name: role });
    await setDoc(doc(db, "users/inactive"), { role: "pedagogical_advisor", schoolId: "school-a", status: "inactive", active: false });
    await setDoc(doc(db, "users/admin"), { role: "school_admin", schoolId: "school-a", status: "active", active: true });
    await setDoc(doc(db, "users/teacher"), { role: "teacher", schoolId: "school-a", status: "active", active: true });
    await setDoc(doc(db, "schoolCalendars/year-a"), { schoolId: "school-a", schoolYearId: "year-a", status: "validated", updatedAt: "v1", updatedBy: "seed" });
    await setDoc(doc(db, "schoolCalendars/year-a/events/e1"), { schoolId: "school-a", schoolYearId: "year-a", title: "Congé" });
    await setDoc(doc(db, "notifications/mine"), { schoolId: "school-a", recipientUserId: "pedagogical_advisor", type: "message" });
    await setDoc(doc(db, "notifications/other"), { schoolId: "school-a", recipientUserId: "teacher", type: "message" });
    await setDoc(doc(db, "messages/mine"), { schoolId: "school-a", participantIds: ["pedagogical_advisor", "admin"] });
    await setDoc(doc(db, "messages/other"), { schoolId: "school-a", participantIds: ["admin", "teacher"] });
    await setDoc(doc(db, "students/s1"), { schoolId: "school-a", schoolYearId: "year-a", section: "Primaire" });
    await setDoc(doc(db, "payments/p1"), { schoolId: "school-a", schoolYearId: "year-a", amount: 10 });
    await setDoc(doc(db, "gradeEntries/g1"), { schoolId: "school-a", schoolYearId: "year-a", classId: "c1" });
    await setDoc(doc(db, "classVisits/v1"), { schoolId: "school-a", schoolYearId: "year-a", authorId: "pedagogical_advisor" });
    await setDoc(doc(db, "orientationNotes/n1"), { schoolId: "school-a", schoolYearId: "year-a", authorId: "orientation_advisor" });
  });
});
afterAll(async () => environment?.cleanup(), 30000);

describe("conseillers : ce qui est permis", () => {
  for (const role of advisorRoles) {
    it(`${role} lit son profil, son école, ses années et le calendrier`, async () => {
      const db = as(role, role);
      await assertSucceeds(getDoc(doc(db, `users/${role}`)));
      await assertSucceeds(getDoc(doc(db, "schools/school-a")));
      await assertSucceeds(getDocs(query(collection(db, "schoolYears"), where("schoolId", "==", "school-a"))));
      await assertSucceeds(getDoc(doc(db, "schoolCalendars/year-a")));
      await assertSucceeds(getDocs(collection(db, "schoolCalendars/year-a/events")));
    });
  }
  it("le conseiller lit ses notifications et ses messages, et gère ses jetons de notification", async () => {
    const db = as("pedagogical_advisor", "pedagogical_advisor");
    await assertSucceeds(getDocs(query(collection(db, "notifications"), where("schoolId", "==", "school-a"), where("recipientUserId", "==", "pedagogical_advisor"))));
    await assertSucceeds(getDocs(query(collection(db, "messages"), where("schoolId", "==", "school-a"), where("participantIds", "array-contains", "pedagogical_advisor"))));
    const token = { userId: "pedagogical_advisor", deviceId: "d1", token: "t", platform: "web", active: true, createdAt: "x", updatedAt: "x" };
    await assertSucceeds(setDoc(doc(db, "users/pedagogical_advisor/pushTokens/d1"), token));
    await assertSucceeds(deleteDoc(doc(db, "users/pedagogical_advisor/pushTokens/d1")));
  });
  it("l'administrateur voit les comptes conseillers de son école", async () => {
    await assertSucceeds(getDoc(doc(as("admin", "school_admin"), "users/pedagogical_advisor")));
    await assertSucceeds(getDoc(doc(as("admin", "school_admin"), "users/orientation_advisor")));
    await assertSucceeds(getDocs(query(collection(as("admin", "school_admin"), "users"), where("schoolId", "==", "school-a"), where("role", "in", ["pedagogical_advisor", "orientation_advisor"]))));
    await assertFails(getDocs(query(collection(as("teacher", "teacher"), "users"), where("schoolId", "==", "school-a"), where("role", "in", ["pedagogical_advisor"]))));
  });
});

describe("conseillers : ce qui est refusé", () => {
  it("aucun accès à l'argent, aux élèves, aux cotes, aux fiches ni aux notes de suivi", async () => {
    for (const role of advisorRoles) {
      const db = as(role, role);
      await assertFails(getDoc(doc(db, "payments/p1")));
      await assertFails(getDocs(query(collection(db, "payments"), where("schoolId", "==", "school-a"))));
      await assertFails(getDoc(doc(db, "students/s1")));
      await assertFails(getDoc(doc(db, "gradeEntries/g1")));
      await assertFails(getDoc(doc(db, "classVisits/v1")));
      await assertFails(getDoc(doc(db, "orientationNotes/n1")));
      await assertFails(setDoc(doc(db, "classVisits/new"), { schoolId: "school-a", authorId: role }));
      await assertFails(setDoc(doc(db, "orientationNotes/new"), { schoolId: "school-a", authorId: role }));
    }
  });
  it("les fiches et notes restent fermées aux enseignants et à l'administrateur côté navigateur", async () => {
    await assertFails(getDoc(doc(as("teacher", "teacher"), "classVisits/v1")));
    await assertFails(getDoc(doc(as("teacher", "teacher"), "orientationNotes/n1")));
    await assertFails(getDoc(doc(as("admin", "school_admin"), "orientationNotes/n1")));
  });
  it("ni les notifications ni les messages des autres, ni le profil des autres", async () => {
    const db = as("pedagogical_advisor", "pedagogical_advisor");
    await assertFails(getDoc(doc(db, "notifications/other")));
    await assertFails(getDoc(doc(db, "messages/other")));
    await assertFails(getDoc(doc(db, "users/teacher")));
    await assertFails(getDoc(doc(db, "users/orientation_advisor")));
  });
  it("aucune écriture : calendrier, profil, école", async () => {
    const db = as("pedagogical_advisor", "pedagogical_advisor");
    await assertFails(setDoc(doc(db, "schoolCalendars/year-a/events/e2"), { schoolId: "school-a", schoolYearId: "year-a", title: "x" }));
    await assertFails(updateDoc(doc(db, "users/pedagogical_advisor"), { role: "school_admin" }));
    await assertFails(updateDoc(doc(db, "schools/school-a"), { name: "x" }));
  });
  it("une autre école, un compte inactif ou un jeton qui ne correspond pas au profil : refus", async () => {
    await assertFails(getDoc(doc(as("pedagogical_advisor", "pedagogical_advisor", "school-b"), "schools/school-b")));
    await assertFails(getDoc(doc(as("inactive", "pedagogical_advisor"), "schools/school-a")));
    await assertFails(getDoc(doc(as("pedagogical_advisor", "orientation_advisor"), "schools/school-a")));
    await assertFails(getDoc(doc(as("pedagogical_advisor", "pedagogical_advisor"), "schoolYears/year-b")));
  });
});
