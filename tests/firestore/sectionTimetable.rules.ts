import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

// Lot R5 : brouillon d'horaire par section (règle timetables).
let environment: RulesTestEnvironment;
const schoolId = "school-a";
const schoolYearId = "year-a";
const now = "2026-11-26T10:00:00.000Z";
const database = (userId: string) => environment.authenticatedContext(userId, { role: "study_director", schoolId }).firestore();
const seed = (path: string, data: Record<string, unknown>) => environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), path), data));

beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId: "demo-section-timetable", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
}, 30_000);
beforeEach(async () => {
  await environment.clearFirestore();
  await seed("users/primary", { id: "primary", role: "study_director", schoolId, status: "active", sectionIds: ["Primaire"] });
  await seed("users/secondary", { id: "secondary", role: "study_director", schoolId, status: "active", sectionIds: ["Secondaire"] });
  await seed("users/whole", { id: "whole", role: "study_director", schoolId, status: "active" });
  await seed(`schools/${schoolId}`, { id: schoolId, status: "active" });
  await seed(`schoolYears/${schoolYearId}`, { id: schoolYearId, schoolId, status: "active" });
});
afterAll(async () => environment?.cleanup(), 30_000);

function timetable(id: string, createdBy: string, extra: Record<string, unknown> = {}) {
  return { id, schoolId, schoolYearId, version: 1, status: "DRAFT", activeDraft: true, createdBy, createdAt: now, updatedAt: now,
    generationMetadata: { algorithm: "deterministic-backtracking", exploredBranches: 1, durationMs: 1, maxSameAssignmentPeriodsPerDay: 2 }, ...extra };
}

describe("brouillon d'horaire par section", () => {
  it("un compte de la section crée le brouillon de sa section, pas celui d'une autre", async () => {
    await assertSucceeds(setDoc(doc(database("primary"), "timetables", "p"), timetable("p", "primary", { sectionId: "Primaire" })));
    await assertFails(setDoc(doc(database("secondary"), "timetables", "s"), timetable("s", "secondary", { sectionId: "Primaire" })));
    await assertFails(setDoc(doc(database("primary"), "timetables", "x"), timetable("x", "primary", { sectionId: "Inconnue" })));
  });

  it("un compte sans section crée le brouillon de toute section ; le brouillon de toute l'école reste comme avant", async () => {
    await assertSucceeds(setDoc(doc(database("whole"), "timetables", "w"), timetable("w", "whole", { sectionId: "Secondaire" })));
    await assertSucceeds(setDoc(doc(database("primary"), "timetables", "e"), timetable("e", "primary")));
  });

  it("seul un compte de la section active ou désactive le brouillon de la section", async () => {
    await seed("timetables/p", timetable("p", "primary", { sectionId: "Primaire" }));
    await assertFails(updateDoc(doc(database("secondary"), "timetables", "p"), { activeDraft: false, updatedAt: "later" }));
    await assertSucceeds(updateDoc(doc(database("primary"), "timetables", "p"), { activeDraft: false, updatedAt: "later" }));
    await assertSucceeds(updateDoc(doc(database("whole"), "timetables", "p"), { activeDraft: true, updatedAt: "later2" }));
  });

  it("la section d'un brouillon ne peut pas être ajoutée ni changée", async () => {
    await seed("timetables/e", timetable("e", "primary"));
    await assertFails(updateDoc(doc(database("primary"), "timetables", "e"), { sectionId: "Primaire", updatedAt: "later" }));
    await seed("timetables/p", timetable("p", "primary", { sectionId: "Primaire" }));
    await assertFails(updateDoc(doc(database("primary"), "timetables", "p"), { sectionId: "Secondaire", updatedAt: "later" }));
  });
});
