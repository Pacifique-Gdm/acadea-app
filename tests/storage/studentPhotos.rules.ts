import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let environment: RulesTestEnvironment;
const uuid = "123e4567-e89b-42d3-a456-426614174000";
const path = (studentId = "child-a", schoolId = "school-a", fileName = `${uuid}.jpg`) => `schools/${schoolId}/student-photos/${studentId}/${fileName}`;
const claims: Record<string, Record<string, unknown>> = {
  "admin-a": { role: "school_admin", schoolId: "school-a" }, "secretary-a": { role: "secretary", schoolId: "school-a" },
  "cashier-a": { role: "cashier", schoolId: "school-a" }, "director-a": { role: "study_director", schoolId: "school-a" },
  "discipline-a": { role: "discipline_director", schoolId: "school-a" }, "teacher-a": { role: "teacher", schoolId: "school-a" },
  "parent-a": { role: "parent", schoolId: "school-a", parentId: "family-a" }, "parent-b": { role: "parent", schoolId: "school-a", parentId: "family-b" },
  "admin-b": { role: "school_admin", schoolId: "school-b" }, "coord-a": { role: "coordination_admin", coordinationId: "coord-a" },
};
const storage = (uid: string) => environment.authenticatedContext(uid, claims[uid]).storage();
const put = (uid: string, target = path(), options: { size?: number; type?: string; schoolId?: string; studentId?: string } = {}) =>
  storage(uid).ref(target).put(new Uint8Array(options.size ?? 1024), { contentType: options.type ?? "image/jpeg", customMetadata: { schoolId: options.schoolId ?? "school-a", studentId: options.studentId ?? "child-a" } });
const read = (uid: string, target = path()) => storage(uid).ref(target).getMetadata();

describe("photos des élèves dans Storage", () => {
  beforeAll(async () => {
    environment = await initializeTestEnvironment({ projectId: "demo-acadea-security-s1-s4", firestore: { rules: readFileSync("firestore.rules", "utf8") }, storage: { rules: readFileSync("storage.rules", "utf8") } });
  }, 30_000);
  beforeEach(async () => {
    await environment.clearFirestore(); await environment.clearStorage();
    await environment.withSecurityRulesDisabled(async (admin) => {
      const firestore = admin.firestore();
      await setDoc(doc(firestore, "schools", "school-a"), { status: "active" });
      await setDoc(doc(firestore, "schools", "school-b"), { status: "active" });
      for (const [uid, value] of Object.entries(claims)) {
        await setDoc(doc(firestore, "users", uid), { role: value.role, schoolId: value.schoolId ?? null, status: "active", active: true,
          ...(value.parentId ? { parentId: value.parentId } : {}), ...(value.coordinationId ? { coordinationId: value.coordinationId } : {}),
          ...(uid === "discipline-a" ? { sectionIds: ["Primaire"] } : {}) });
      }
      await setDoc(doc(firestore, "students", "child-a"), { schoolId: "school-a", schoolYearId: "year-a", parentId: "family-a", section: "Primaire" });
      await setDoc(doc(firestore, "students", "child-sec"), { schoolId: "school-a", schoolYearId: "year-a", parentId: "family-b", section: "Secondaire" });
      await admin.storage().ref(path()).put(new Uint8Array(10), { contentType: "image/jpeg", customMetadata: { schoolId: "school-a", studentId: "child-a" } });
      await admin.storage().ref(path("child-sec")).put(new Uint8Array(10), { contentType: "image/jpeg", customMetadata: { schoolId: "school-a", studentId: "child-sec" } });
    });
  });
  afterAll(async () => environment.cleanup(), 30_000);

  it.each(["admin-a", "secretary-a"])("%s ajoute, lit et supprime une photo de son école", async (uid) => {
    await assertSucceeds(put(uid, path("child-a", "school-a", "223e4567-e89b-42d3-a456-426614174000.jpg")));
    await assertSucceeds(read(uid));
    await assertSucceeds(storage(uid).ref(path()).delete());
  });

  it.each(["cashier-a", "director-a"])("%s lit les photos de son école mais n'en ajoute pas", async (uid) => {
    await assertSucceeds(read(uid));
    await assertFails(put(uid, path("child-a", "school-a", "323e4567-e89b-42d3-a456-426614174000.jpg")));
  });

  it("le Directeur de discipline ne lit que les photos de ses sections", async () => {
    await assertSucceeds(read("discipline-a"));
    await assertFails(read("discipline-a", path("child-sec")));
  });

  it("le parent ne lit que les photos de ses enfants", async () => {
    await assertSucceeds(read("parent-a"));
    await assertFails(read("parent-a", path("child-sec")));
    await assertFails(read("parent-b"));
    await assertFails(put("parent-a", path("child-a", "school-a", "423e4567-e89b-42d3-a456-426614174000.jpg")));
  });

  it("refuse l'enseignant, la coordination, une autre école et un visiteur non connecté", async () => {
    for (const uid of ["teacher-a", "coord-a", "admin-b"]) await assertFails(read(uid));
    await assertFails(put("admin-b", path("child-a", "school-a", "523e4567-e89b-42d3-a456-426614174000.jpg")));
    await assertFails(environment.unauthenticatedContext().storage().ref(path()).getMetadata());
  });

  it("refuse une photo trop lourde, un mauvais format, des métadonnées fausses, un nom libre et toute modification", async () => {
    const fresh = (name: string) => path("child-a", "school-a", name);
    await assertFails(put("admin-a", fresh("623e4567-e89b-42d3-a456-426614174000.jpg"), { size: 400 * 1024 + 1 }));
    await assertFails(put("admin-a", fresh("723e4567-e89b-42d3-a456-426614174000.jpg"), { type: "text/html" }));
    await assertFails(put("admin-a", fresh("823e4567-e89b-42d3-a456-426614174000.jpg"), { studentId: "child-sec" }));
    await assertFails(put("admin-a", fresh("923e4567-e89b-42d3-a456-426614174000.jpg"), { schoolId: "school-b" }));
    await assertFails(put("admin-a", fresh("photo.jpg")));
    await assertFails(put("admin-a", path()));
  });
});
