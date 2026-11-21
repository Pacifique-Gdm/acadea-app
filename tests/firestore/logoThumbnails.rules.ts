import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, deleteField, doc, getDoc, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

// Lot 1 du Super administrateur : vignette des logos (logoThumbUrl) et logo des
// coordinations rangé à part (coordinationLogos).
let environment: RulesTestEnvironment;
const schoolA = "thumb-school-a";
const schoolB = "thumb-school-b";
const coordinationId = "thumb-coord-a";
const LOGO = "data:image/png;base64,QUFBQQ==";
const THUMB = `data:image/webp;base64,${"A".repeat(4000)}`;

const schoolDb = (uid: string, role: string, schoolId = schoolA) => environment.authenticatedContext(uid, { role, schoolId }).firestore();
const coordinationDb = (uid: string, coordination = coordinationId, extra: Record<string, string> = {}) => environment.authenticatedContext(uid, { role: extra.subCoordinationId ? "sub_coordination_admin" : "coordination_admin", coordinationId: coordination, ...extra }).firestore();
const superDb = () => environment.authenticatedContext("super-a", { role: "super_admin" }).firestore();
const seed = (path: string, data: Record<string, unknown>) => environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), path), data));
const logoDoc = (logoVersion: string) => ({ schoolId: schoolA, logoUrl: LOGO, logoVersion, updatedAt: "2026-11-21T00:00:00.000Z", updatedBy: "admin-a" });

beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId: "demo-logo-thumbnails", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
}, 30000);

beforeEach(async () => {
  await environment.clearFirestore();
  await seed("users/admin-a", { id: "admin-a", role: "school_admin", schoolId: schoolA, status: "active", active: true });
  await seed("users/admin-b", { id: "admin-b", role: "school_admin", schoolId: schoolB, status: "active", active: true });
  await seed("users/super-a", { id: "super-a", role: "super_admin", status: "active" });
  await seed("users/coord-user", { id: "coord-user", role: "coordination_admin", coordinationId, active: true });
  await seed("users/sub-user", { id: "sub-user", role: "sub_coordination_admin", coordinationId, subCoordinationId: "sub-a", active: true });
  await seed("users/coord-foreign", { id: "coord-foreign", role: "coordination_admin", coordinationId: "coord-other", active: true });
  await seed(`schools/${schoolA}`, { id: schoolA, schoolId: schoolA, name: "École A", status: "active", logoVersion: "v1", activeCoordinationId: coordinationId });
  await seed(`schools/${schoolB}`, { id: schoolB, schoolId: schoolB, name: "École B", status: "active" });
  await seed(`schoolLogos/${schoolA}`, logoDoc("v1"));
  await seed(`coordinations/${coordinationId}`, { id: coordinationId, status: "active", name: "Coordination A", logoVersion: "c1", logoThumbUrl: THUMB });
  await seed("coordinations/coord-other", { id: "coord-other", status: "active", name: "Autre" });
  await seed(`coordinationSchools/${coordinationId}__${schoolA}`, { id: `${coordinationId}__${schoolA}`, coordinationId, schoolId: schoolA, active: true });
  await seed("subCoordinations/sub-a", { id: "sub-a", coordinationId, coordinatorUserId: "sub-user", status: "active", active: true });
  await seed(`coordinationLogos/${coordinationId}`, { coordinationId, logoUrl: LOGO, logoVersion: "c1", updatedAt: "2026-11-21T00:00:00.000Z", updatedBy: "coord-user" });
});

afterAll(async () => environment?.cleanup(), 30000);

describe("vignette du logo de l'école (logoThumbUrl)", () => {
  it("l'administrateur enregistre le logo et sa vignette ensemble", async () => {
    const db = schoolDb("admin-a", "school_admin");
    const batch = writeBatch(db);
    batch.set(doc(db, "schoolLogos", schoolA), logoDoc("v2"));
    batch.update(doc(db, "schools", schoolA), { logoUrl: deleteField(), logoVersion: "v2", logoThumbUrl: THUMB });
    await assertSucceeds(batch.commit());
  });

  it("l'administrateur peut retirer la vignette avec le logo", async () => {
    await seed(`schools/${schoolA}`, { id: schoolA, schoolId: schoolA, name: "École A", status: "active", logoVersion: "v1", logoThumbUrl: THUMB });
    const db = schoolDb("admin-a", "school_admin");
    const batch = writeBatch(db);
    batch.delete(doc(db, "schoolLogos", schoolA));
    batch.update(doc(db, "schools", schoolA), { logoVersion: "", logoThumbUrl: deleteField() });
    await assertSucceeds(batch.commit());
  });

  it("refuse une vignette trop lourde ou qui n'est pas une image", async () => {
    const db = schoolDb("admin-a", "school_admin");
    await assertFails(updateDoc(doc(db, "schools", schoolA), { logoThumbUrl: `data:image/webp;base64,${"A".repeat(8001)}` }));
    await assertFails(updateDoc(doc(db, "schools", schoolA), { logoThumbUrl: "https://exemple.test/logo.png" }));
    await assertFails(updateDoc(doc(db, "schools", schoolA), { logoThumbUrl: "" }));
    await assertFails(updateDoc(doc(db, "schools", schoolA), { logoThumbUrl: 42 }));
  });

  it("refuse la vignette posée par une autre école ou un autre rôle", async () => {
    await assertFails(updateDoc(doc(schoolDb("admin-b", "school_admin", schoolB), "schools", schoolA), { logoThumbUrl: THUMB }));
    await seed("users/secretary-a", { id: "secretary-a", role: "secretary", schoolId: schoolA, status: "active", active: true });
    await assertFails(updateDoc(doc(schoolDb("secretary-a", "secretary"), "schools", schoolA), { logoThumbUrl: THUMB }));
  });
});

describe("logo de la coordination rangé à part (coordinationLogos)", () => {
  it("se lit par les mêmes comptes que la coordination", async () => {
    await assertSucceeds(getDoc(doc(superDb(), "coordinationLogos", coordinationId)));
    await assertSucceeds(getDoc(doc(coordinationDb("coord-user"), "coordinationLogos", coordinationId)));
    await assertSucceeds(getDoc(doc(coordinationDb("sub-user", coordinationId, { subCoordinationId: "sub-a" }), "coordinationLogos", coordinationId)));
    await assertSucceeds(getDoc(doc(schoolDb("admin-a", "school_admin"), "coordinationLogos", coordinationId)));
  });

  it("refuse la lecture par un compte sans droit sur la coordination", async () => {
    await assertFails(getDoc(doc(coordinationDb("coord-foreign", "coord-other"), "coordinationLogos", coordinationId)));
    await assertFails(getDoc(doc(schoolDb("admin-b", "school_admin", schoolB), "coordinationLogos", coordinationId)));
    await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), "coordinationLogos", coordinationId)));
  });

  it("refuse toute écriture depuis un navigateur, même du Super administrateur", async () => {
    const record = { coordinationId, logoUrl: LOGO, logoVersion: "c2", updatedAt: "2026-11-21T00:00:00.000Z", updatedBy: "x" };
    await assertFails(setDoc(doc(coordinationDb("coord-user"), "coordinationLogos", coordinationId), record));
    await assertFails(setDoc(doc(superDb(), "coordinationLogos", coordinationId), record));
    await assertFails(setDoc(doc(superDb(), "coordinationLogos", "nouvelle"), record));
    await assertFails(deleteDoc(doc(superDb(), "coordinationLogos", coordinationId)));
    await assertFails(deleteDoc(doc(coordinationDb("coord-user"), "coordinationLogos", coordinationId)));
  });
});
