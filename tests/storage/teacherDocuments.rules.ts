import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let environment: RulesTestEnvironment;
const school = "school-a", year = "year-a", uid = "teacher-user-a", teacher = "teacher-a", assignment = "assignment-a";
const file = "123e4567-e89b-12d3-a456-426614174000.pdf";
const path = (assignmentId = assignment, yearId = year, teacherId = teacher) => `teacher-documents/${school}/${yearId}/${uid}/${teacherId}/${assignmentId}/document-a/${file}`;
const context = (id = uid, role = "teacher", tenant = school) => environment.authenticatedContext(id, { role, schoolId: tenant });
const upload = (session = context(), assignmentId = assignment, type = "application/pdf", size = 1024) => session.storage().ref(path(assignmentId)).put(new Uint8Array(size), {
  contentType: type,
  customMetadata: { schoolId: school, schoolYearId: year, ownerId: uid, teacherId: teacher, assignmentId, documentId: "document-a", originalName: "fiche.pdf" },
});
const grant = (schoolId = school, yearId = year, teacherId = teacher, assignmentId = assignment) => `${schoolId}/${yearId}/${teacherId}/${assignmentId}`;
async function seedUser(grants: string[] | null = [grant()], fields: Record<string, unknown> = {}) {
  await environment.withSecurityRulesDisabled(async (admin) => {
    await setDoc(doc(admin.firestore(), `users/${uid}`), { id: uid, schoolId: school, role: "teacher", status: "active", active: true, ...(grants !== null ? { storageAssignmentKeys: grants } : {}), ...fields });
  });
}
async function seedTeacher(fields: Record<string, unknown> = {}) {
  await environment.withSecurityRulesDisabled(async (admin) => {
    await setDoc(doc(admin.firestore(), `teachers/${teacher}`), { userId: uid, schoolId: school, schoolYearId: year, status: "active", storageAssignmentIds: [assignment], ...fields });
  });
}
async function schoolStatus(status: string) {
  await environment.withSecurityRulesDisabled(async (admin) => setDoc(doc(admin.firestore(), `schools/${school}`), { status, activeSchoolYearId: year }));
}

describe("documents pédagogiques Storage", () => {
  beforeAll(async () => { environment = await initializeTestEnvironment({ projectId: "acadea-staging", firestore: { rules: readFileSync("firestore.rules", "utf8") }, storage: { rules: readFileSync("storage.rules", "utf8") } }); }, 30_000);
  beforeEach(async () => {
    await environment.clearFirestore(); await environment.clearStorage();
    await schoolStatus("active"); await seedUser(); await seedTeacher();
  });
  afterAll(() => environment.cleanup());

  it("autorise upload et lecture protégée au propriétaire actif", async () => {
    const session = context();
    await assertSucceeds(upload(session));
    await assertSucceeds(session.storage().ref(path()).getMetadata());
  });
  it("refuse autre UID, rôle, école, affectation et MIME", async () => {
    await assertFails(upload(context("other")));
    await assertFails(upload(context(uid, "secretary")));
    await assertFails(upload(context(uid, "teacher", "school-b")));
    await assertFails(upload(context(), "assignment-other"));
    await assertFails(upload(context(), assignment, "text/html"));
  });
  it("refuse un user sans champ, sans grant ou inactif même si teachers reste actif", async () => {
    await seedUser(null); await assertFails(upload());
    await seedUser([]); await assertFails(upload());
    await seedUser([grant()], { status: "inactive" });
    await assertFails(upload());
    await seedUser([grant()], { active: false });
    await assertFails(upload());
    await environment.withSecurityRulesDisabled(async (admin) => setDoc(doc(admin.firestore(), `users/${uid}`), { id: uid, schoolId: school, role: "teacher", storageAssignmentKeys: [grant()] }));
    await assertFails(upload());
  });
  it("bloque une ancienne session immédiatement après suspension et restaure l'accès après réactivation", async () => {
    const session = context();
    await assertSucceeds(upload(session));
    await schoolStatus("suspended");
    await assertFails(upload(session));
    await assertFails(session.storage().ref(path()).getMetadata());
    await schoolStatus("active");
    await assertSucceeds(session.storage().ref(path()).getMetadata());
  });
  it("refuse l'ancienne année dès que l'école active une autre année, même avec un grant restant", async () => {
    const session = context();
    await assertSucceeds(upload(session));
    await environment.withSecurityRulesDisabled(async (admin) => setDoc(doc(admin.firestore(), `schools/${school}`), { status: "active", activeSchoolYearId: "year-b" }));
    await assertFails(upload(session));
    await assertFails(session.storage().ref(path()).getMetadata());
  });
  it("refuse un fichier vide ou supérieur à 10 Mo", async () => {
    await assertFails(upload(context(), assignment, "application/pdf", 0));
    await assertFails(upload(context(), assignment, "application/pdf", 10 * 1024 * 1024 + 1));
  });
  it("refuse users absent, autre rôle et école divergente", async () => {
    await environment.clearFirestore(); await schoolStatus("active"); await seedTeacher();
    await assertFails(upload());
    await seedUser([grant()], { role: "secretary" }); await assertFails(upload());
    await seedUser([grant()], { schoolId: "school-b" }); await assertFails(upload());
  });
  it("refuse autre année, autre profil, grant partiel et profil sans userId", async () => {
    await assertFails(context().storage().ref(path(assignment, "year-b")).put(new Uint8Array(1024), { contentType: "application/pdf", customMetadata: { schoolId: school, schoolYearId: "year-b", ownerId: uid, teacherId: teacher, assignmentId: assignment, documentId: "document-a", originalName: "fiche.pdf" } }));
    await seedUser([grant(school, year, "teacher-b")]); await assertFails(upload());
    await seedUser([`${school}/${year}/${teacher}/assignment`]); await assertFails(upload());
    await seedTeacher({ userId: null }); await seedUser([]); await assertFails(upload());
  });
});

describe("budget de lectures Firestore", () => {
  it("utilise seulement l'école et users", () => {
    const rules = readFileSync("storage.rules", "utf8");
    const teacherRule = rules.slice(rules.indexOf("match /teacher-documents"));
    expect(teacherRule).toContain("documents/schools/$(schoolId)");
    expect(teacherRule).toContain("documents/users/$(ownerId)");
    expect(teacherRule).not.toContain("documents/teachers/");
    expect(teacherRule).not.toContain("documents/pedagogicalAssignments/$(assignmentId)");
  });
});
