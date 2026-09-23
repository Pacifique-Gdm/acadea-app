import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const projectId = "demo-inactive-role-authorization";
const roles = ["super_admin", "school_admin", "secretary", "study_director", "discipline_director", "cashier", "teacher", "parent", "coordination_admin", "sub_coordination_admin"] as const;
let environment: RulesTestEnvironment;

const seed = (path: string, data: Record<string, unknown>) => environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), path), data));
const database = (role: string) => environment.authenticatedContext(`user-${role}`, {
  role, schoolId: "school-a", ...(role === "parent" ? { parentId: "family-a" } : {}),
  ...(["coordination_admin", "sub_coordination_admin"].includes(role) ? { coordinationId: "coord-a" } : {}),
  ...(role === "sub_coordination_admin" ? { subCoordinationId: "sub-a" } : {}),
}).firestore();

beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync("firestore.rules", "utf8") } });
}, 30_000);

beforeEach(async () => {
  await environment.clearFirestore();
  await seed("schools/school-a", { id: "school-a", status: "active", activeSchoolYearId: "year-a" });
  await seed("schoolYears/year-a", { id: "year-a", schoolId: "school-a", status: "active" });
  await seed("students/child-a", { id: "child-a", schoolId: "school-a", schoolYearId: "year-a", section: "Primaire", parentId: "family-a", status: "ACTIVE" });
  await seed("teachers/teacher-a", { id: "teacher-a", userId: "user-teacher", schoolId: "school-a", schoolYearId: "year-a" });
  await seed("coordinations/coord-a", { id: "coord-a", status: "active", principalCoordinatorUserId: "user-coordination_admin" });
  await seed("coordinationSchools/coord-a__school-a", { coordinationId: "coord-a", schoolId: "school-a", active: true });
  await seed("subCoordinations/sub-a", { id: "sub-a", coordinationId: "coord-a", coordinatorUserId: "user-sub_coordination_admin", status: "active", active: true });
  await seed("subCoordinationSchools/sub-a__school-a", { coordinationId: "coord-a", subCoordinationId: "sub-a", schoolId: "school-a", active: true });
  await seed("platformSettings/billingControls", { valvesUploadsEnabled: true });
  for (const role of roles) {
    await seed(`users/user-${role}`, {
      id: `user-${role}`, role, schoolId: "school-a", parentId: role === "parent" ? "family-a" : null,
      ...(["coordination_admin", "sub_coordination_admin"].includes(role) ? { coordinationId: "coord-a" } : {}),
      ...(role === "sub_coordination_admin" ? { subCoordinationId: "sub-a" } : {}),
      sectionIds: role === "study_director" || role === "discipline_director" ? ["Primaire"] : [],
      status: "active", active: true,
    });
  }
});

afterAll(() => environment.cleanup(), 30_000);

describe("profil désactivé avec ancien claim de rôle", () => {
  it("préserve les profils historiques actifs sans champ active ou status", async () => {
    const caller = database("school_admin");
    await seed("users/user-school_admin", { id: "user-school_admin", role: "school_admin", schoolId: "school-a", status: "active" });
    await assertSucceeds(getDoc(doc(caller, "students", "child-a")));
    await seed("users/user-school_admin", { id: "user-school_admin", role: "school_admin", schoolId: "school-a", active: true });
    await assertSucceeds(getDoc(doc(caller, "students", "child-a")));
  });

  it("refuse un ancien token si le profil utilisateur a été supprimé", async () => {
    const caller = database("school_admin");
    await assertSucceeds(getDoc(doc(caller, "students", "child-a")));
    await environment.withSecurityRulesDisabled((context) => deleteDoc(doc(context.firestore(), "users", "user-school_admin")));
    await assertFails(getDoc(doc(caller, "students", "child-a")));
  });

  for (const role of roles) {
    it(`${role}: préserve la lecture active et refuse la lecture après désactivation`, async () => {
      const target = role === "super_admin" || role === "coordination_admin" || role === "sub_coordination_admin"
        ? "schools/school-a" : role === "teacher" ? "teachers/teacher-a" : "students/child-a";
      const caller = database(role);
      await assertSucceeds(getDoc(doc(caller, target)));
      await seed(`users/user-${role}`, {
        id: `user-${role}`, role, schoolId: "school-a", parentId: role === "parent" ? "family-a" : null,
        ...(["coordination_admin", "sub_coordination_admin"].includes(role) ? { coordinationId: "coord-a" } : {}),
        ...(role === "sub_coordination_admin" ? { subCoordinationId: "sub-a" } : {}),
        sectionIds: role === "study_director" || role === "discipline_director" ? ["Primaire"] : [],
        status: "inactive", active: false,
      });
      await assertFails(getDoc(doc(caller, target)));
    });
  }

  it("refuse aussi une écriture Administrateur avec le token encore valide", async () => {
    const caller = database("school_admin");
    await assertSucceeds(updateDoc(doc(caller, "students", "child-a"), { status: "INACTIVE" }));
    await seed("users/user-school_admin", { id: "user-school_admin", role: "school_admin", schoolId: "school-a", status: "inactive", active: false });
    await assertFails(updateDoc(doc(caller, "students", "child-a"), { status: "ACTIVE" }));
  });

  it("refuse à un Administrateur inactif la lecture directe d'un autre profil", async () => {
    const caller = database("school_admin");
    await assertSucceeds(getDoc(doc(caller, "users", "user-teacher")));
    await seed("users/user-school_admin", { id: "user-school_admin", role: "school_admin", schoolId: "school-a", status: "inactive", active: false });
    await assertFails(getDoc(doc(caller, "users", "user-teacher")));
  });

  it("refuse à un Directeur inactif la création d'un nouveau brouillon d'horaire", async () => {
    const caller = database("study_director");
    const draft = (id: string) => ({ id, schoolId: "school-a", schoolYearId: "year-a", version: 1, status: "DRAFT", activeDraft: false, persistenceState: "PENDING", createdBy: "user-study_director", createdAt: "2026-09-23T00:00:00.000Z", updatedAt: "2026-09-23T00:00:00.000Z" });
    await assertSucceeds(setDoc(doc(caller, "timetables", "draft-active"), draft("draft-active")));
    await seed("users/user-study_director", { id: "user-study_director", role: "study_director", schoolId: "school-a", status: "inactive", active: false });
    await assertFails(setDoc(doc(caller, "timetables", "draft-inactive"), draft("draft-inactive")));
  });

  it("refuse à un Directeur inactif la création d'une période", async () => {
    const caller = database("study_director");
    const period = (id: string) => ({
      id, schoolId: "school-a", schoolYearId: "year-a", label: "Période 1", startTime: "08:00", endTime: "09:00",
      order: 1, type: "course", active: true, createdBy: "user-study_director",
    });
    await assertSucceeds(setDoc(doc(caller, "schedulePeriods", "period-active"), period("period-active")));
    await seed("users/user-study_director", { id: "user-study_director", role: "study_director", schoolId: "school-a", status: "inactive", active: false });
    await assertFails(setDoc(doc(caller, "schedulePeriods", "period-inactive"), period("period-inactive")));
  });

  it("refuse les lectures signedIn() directes avec un ancien token", async () => {
    const caller = database("school_admin");
    await assertSucceeds(getDoc(doc(caller, "platformSettings", "billingControls")));
    await seed("users/user-school_admin", { id: "user-school_admin", role: "school_admin", schoolId: "school-a", status: "inactive", active: false });
    await assertFails(getDoc(doc(caller, "platformSettings", "billingControls")));
    await assertFails(getDoc(doc(caller, "users", "user-school_admin")));
  });
});
