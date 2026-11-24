import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

// Valves : la Visibilité du formulaire est respectée par les règles, pas seulement à l'écran.
const projectId = "demo-acadea-valves-audience";
const year = "year-a";
let environment: RulesTestEnvironment;

const seed = (path: string, data: Record<string, unknown>) => environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), path), data));
const parent = (uid: string, schoolId: string, parentId: string) => environment.authenticatedContext(uid, { role: "parent", schoolId, parentId }).firestore();
const staff = (uid: string, role: string, schoolId = "school-a") => environment.authenticatedContext(uid, { role, schoolId }).firestore();
const valve = (id: string, schoolId: string, extra: Record<string, unknown>) => ({ id, schoolId, schoolYearId: schoolId === "school-a" ? year : "year-b", title: "Information", kind: "communique", body: "Texte", authorId: "admin-a", authorName: "Admin", createdAt: "2026-11-24", ...extra });

beforeAll(async () => { environment = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync("firestore.rules", "utf8") } }); }, 30_000);
beforeEach(async () => {
  await environment.clearFirestore();
  await seed(`schoolYears/${year}`, { id: year, schoolId: "school-a", status: "active" });
  await seed("users/admin-a", { id: "admin-a", role: "school_admin", schoolId: "school-a", status: "active", active: true });
  await seed("users/secretary-a", { id: "secretary-a", role: "secretary", schoolId: "school-a", status: "active", active: true });
  await seed("users/cashier-a", { id: "cashier-a", role: "cashier", schoolId: "school-a", status: "active", active: true });
  for (const [uid, schoolId, parentId] of [["parent-a", "school-a", "family-a"], ["parent-b", "school-a", "family-b"], ["parent-c", "school-b", "family-c"]]) {
    await seed(`users/${uid}`, { id: uid, role: "parent", schoolId, parentId, status: "active", active: true });
    await seed(`parents/${parentId}`, { id: parentId, schoolId, studentIds: [] });
  }
  await seed("valves/tous-a", valve("tous-a", "school-a", { visibility: "all_parents", audienceAll: true, audienceParentIds: [] }));
  await seed("valves/classe-a", valve("classe-a", "school-a", { visibility: "class", targetClassKey: "1ère Primaire", audienceAll: false, audienceParentIds: ["family-a"] }));
  await seed("valves/section-b", valve("section-b", "school-a", { visibility: "Secondaire", audienceAll: false, audienceParentIds: ["family-b"] }));
  await seed("valves/tous-autre-ecole", valve("tous-autre-ecole", "school-b", { visibility: "all_parents", audienceAll: true, audienceParentIds: [] }));
  await seed("valves/ancienne-sans-public", valve("ancienne-sans-public", "school-a", { visibility: "all_parents" }));
});
afterAll(async () => environment.cleanup(), 30_000);

describe("Valves : un parent ne lit que ce qui le concerne", () => {
  it("bonne classe : le parent de l'enfant visé lit la publication", async () => {
    await assertSucceeds(getDoc(doc(parent("parent-a", "school-a", "family-a"), "valves", "classe-a")));
  });
  it("autre classe ou autre section : refusé", async () => {
    await assertFails(getDoc(doc(parent("parent-b", "school-a", "family-b"), "valves", "classe-a")));
    await assertFails(getDoc(doc(parent("parent-a", "school-a", "family-a"), "valves", "section-b")));
  });
  it("« Tous les parents » : lu par tout parent de l'école, refusé à un parent d'une autre école", async () => {
    await assertSucceeds(getDoc(doc(parent("parent-a", "school-a", "family-a"), "valves", "tous-a")));
    await assertSucceeds(getDoc(doc(parent("parent-b", "school-a", "family-b"), "valves", "tous-a")));
    await assertFails(getDoc(doc(parent("parent-c", "school-b", "family-c"), "valves", "tous-a")));
    await assertFails(getDoc(doc(parent("parent-a", "school-a", "family-a"), "valves", "tous-autre-ecole")));
  });
  it("publication ancienne sans public : refusée aux parents tant que la reprise n'est pas faite", async () => {
    await assertFails(getDoc(doc(parent("parent-a", "school-a", "family-a"), "valves", "ancienne-sans-public")));
  });
  it("requêtes de l'écran du parent : « Tous » et « ma liste » permises, toute l'école refusée", async () => {
    const db = parent("parent-a", "school-a", "family-a");
    const scope = [where("schoolId", "==", "school-a"), where("schoolYearId", "==", year)];
    await assertSucceeds(getDocs(query(collection(db, "valves"), ...scope, where("audienceAll", "==", true))));
    await assertSucceeds(getDocs(query(collection(db, "valves"), ...scope, where("audienceParentIds", "array-contains", "family-a"))));
    await assertFails(getDocs(query(collection(db, "valves"), ...scope)));
    await assertFails(getDocs(query(collection(db, "valves"), ...scope, where("audienceParentIds", "array-contains", "family-b"))));
  });
  it("les autres rôles de l'école lisent comme avant", async () => {
    for (const [uid, role] of [["admin-a", "school_admin"], ["secretary-a", "secretary"], ["cashier-a", "cashier"]]) {
      await assertSucceeds(getDocs(query(collection(staff(uid, role), "valves"), where("schoolId", "==", "school-a"), where("schoolYearId", "==", year))));
    }
  });
});

describe("Valves : une écriture sans public valide est refusée", () => {
  const admin = () => staff("admin-a", "school_admin");
  it("public cohérent : accepté", async () => {
    await assertSucceeds(setDoc(doc(admin(), "valves", "v1"), valve("v1", "school-a", { visibility: "all_parents", audienceAll: true, audienceParentIds: [] })));
    await assertSucceeds(setDoc(doc(admin(), "valves", "v2"), valve("v2", "school-a", { visibility: "class", targetClassKey: "1ère Primaire", audienceAll: false, audienceParentIds: ["family-a"] })));
    await assertSucceeds(setDoc(doc(staff("secretary-a", "secretary"), "valves", "v3"), valve("v3", "school-a", { visibility: "Primaire", audienceAll: false, audienceParentIds: [] })));
  });
  it("sans public, ou public incohérent avec la Visibilité : refusé", async () => {
    await assertFails(setDoc(doc(admin(), "valves", "v4"), valve("v4", "school-a", { visibility: "all_parents" })));
    await assertFails(setDoc(doc(admin(), "valves", "v5"), valve("v5", "school-a", { visibility: "class", targetClassKey: "1ère Primaire", audienceAll: true, audienceParentIds: [] })));
    await assertFails(setDoc(doc(admin(), "valves", "v6"), valve("v6", "school-a", { visibility: "all_parents", audienceAll: true, audienceParentIds: ["family-a"] })));
    await assertFails(setDoc(doc(admin(), "valves", "v7"), valve("v7", "school-a", { visibility: "Primaire", audienceAll: "oui", audienceParentIds: [] })));
  });
  it("modification : le public doit rester valide", async () => {
    await assertSucceeds(updateDoc(doc(admin(), "valves", "classe-a"), { title: "Nouveau titre" }));
    await assertFails(updateDoc(doc(admin(), "valves", "classe-a"), { audienceAll: true }));
  });
});
