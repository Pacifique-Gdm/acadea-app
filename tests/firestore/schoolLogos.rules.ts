import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, deleteField, doc, getDoc, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let environment: RulesTestEnvironment;
const schoolA = "school-logo-a";
const schoolB = "school-logo-b";
const LOGO = "data:image/png;base64,QUFBQQ==";

const database = (uid: string, role: string, schoolId = schoolA) => environment.authenticatedContext(uid, { role, schoolId }).firestore();
const seed = (path: string, data: Record<string, unknown>) => environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), path), data));
const logoDoc = (schoolId: string, logoVersion: string, extra: Record<string, unknown> = {}) => ({ schoolId, logoUrl: LOGO, logoVersion, updatedAt: "2026-11-18T00:00:00.000Z", updatedBy: "admin-a", ...extra });

beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId: "demo-school-logos", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
}, 30000);

beforeEach(async () => {
  await environment.clearFirestore();
  await seed("users/admin-a", { id: "admin-a", role: "school_admin", schoolId: schoolA, status: "active" });
  await seed("users/admin-b", { id: "admin-b", role: "school_admin", schoolId: schoolB, status: "active" });
  await seed("users/secretary-a", { id: "secretary-a", role: "secretary", schoolId: schoolA, status: "active" });
  await seed("users/super-a", { id: "super-a", role: "super_admin", status: "active" });
  await seed(`schools/${schoolA}`, { id: schoolA, schoolId: schoolA, name: "École A", status: "active", logoUrl: LOGO, logoVersion: "v1" });
  await seed(`schools/${schoolB}`, { id: schoolB, schoolId: schoolB, name: "École B", status: "active", logoVersion: "vb" });
  await seed(`schoolLogos/${schoolA}`, logoDoc(schoolA, "v1"));
  await seed(`schoolLogos/${schoolB}`, logoDoc(schoolB, "vb"));
});

afterAll(async () => environment?.cleanup(), 30000);

describe("logo de l'école rangé à part", () => {
  it("se lit par les mêmes personnes que l'école, jamais par une autre école", async () => {
    await assertSucceeds(getDoc(doc(database("admin-a", "school_admin"), "schoolLogos", schoolA)));
    await assertSucceeds(getDoc(doc(database("secretary-a", "secretary"), "schoolLogos", schoolA)));
    await assertSucceeds(getDoc(doc(database("super-a", "super_admin", ""), "schoolLogos", schoolB)));
    await assertFails(getDoc(doc(database("admin-b", "school_admin", schoolB), "schoolLogos", schoolA)));
    await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), "schoolLogos", schoolA)));
  });

  it("l'administrateur change le logo de son école avec le même repère sur l'école", async () => {
    const db = database("admin-a", "school_admin");
    const batch = writeBatch(db);
    batch.set(doc(db, "schoolLogos", schoolA), logoDoc(schoolA, "v2"));
    batch.update(doc(db, "schools", schoolA), { logoUrl: deleteField(), logoVersion: "v2" });
    await assertSucceeds(batch.commit());
  });

  it("refuse un logo dont le repère ne correspond pas à l'école", async () => {
    const db = database("admin-a", "school_admin");
    await assertFails(setDoc(doc(db, "schoolLogos", schoolA), logoDoc(schoolA, "v3")));
  });

  it("refuse l'écriture par une autre école, un autre rôle ou un contenu invalide", async () => {
    await assertFails(setDoc(doc(database("admin-b", "school_admin", schoolB), "schoolLogos", schoolA), logoDoc(schoolA, "v1")));
    await assertFails(setDoc(doc(database("secretary-a", "secretary"), "schoolLogos", schoolA), logoDoc(schoolA, "v1")));
    const admin = database("admin-a", "school_admin");
    await assertFails(setDoc(doc(admin, "schoolLogos", schoolA), logoDoc(schoolA, "v1", { autre: true })));
    await assertFails(setDoc(doc(admin, "schoolLogos", schoolA), logoDoc(schoolA, "v1", { logoUrl: "javascript:alert(1)" })));
    await assertFails(setDoc(doc(admin, "schoolLogos", schoolA), logoDoc(schoolB, "v1")));
    await assertFails(setDoc(doc(admin, "schoolLogos", schoolA), logoDoc(schoolA, "v1", { logoUrl: `data:image/png;base64,${"A".repeat(300_001)}` })));
  });

  it("l'administrateur peut retirer le logo de son école, pas celui d'une autre", async () => {
    const admin = database("admin-a", "school_admin");
    await assertFails(deleteDoc(doc(admin, "schoolLogos", schoolB)));
    const batch = writeBatch(admin);
    batch.delete(doc(admin, "schoolLogos", schoolA));
    batch.update(doc(admin, "schools", schoolA), { logoUrl: deleteField(), logoVersion: "" });
    await assertSucceeds(batch.commit());
  });

  it("le Super Administrateur peut écrire le logo d'une école", async () => {
    const db = database("super-a", "super_admin", "");
    const batch = writeBatch(db);
    batch.set(doc(db, "schoolLogos", schoolB), logoDoc(schoolB, "vb2"));
    batch.update(doc(db, "schools", schoolB), { logoVersion: "vb2" });
    await assertSucceeds(batch.commit());
  });

  it("la secrétaire ne peut toujours pas toucher au repère du logo de l'école", async () => {
    await assertFails(updateDoc(doc(database("secretary-a", "secretary"), "schools", schoolA), { logoVersion: "x" }));
  });
});
