import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteField, doc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

// Lot R3 : réglages de présence (jours de cours, heures) par section du Directeur de discipline.
let env: RulesTestEnvironment;
const settingsId = "attendance-settings__school-a__year-a";
const seed = (path: string, data: Record<string, unknown>) => env.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), path), data));
const discipline = (uid: string) => env.authenticatedContext(uid, { role: "discipline_director", schoolId: "school-a" }).firestore();
const baseSettings = {
  id: settingsId,
  schoolId: "school-a",
  schoolYearId: "year-a",
  schoolDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
  defaultSchedule: { monday: { lateAfter: "07:30" } },
  sectionSchedule: { Primaire: { monday: { lateAfter: "07:15" } }, Secondaire: { monday: { lateAfter: "07:45" } } },
  classSchedule: {},
  updatedAt: "2026-11-01T00:00:00.000Z",
  updatedBy: "school-wide",
};

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-attendance-settings-sections", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
}, 30_000);
beforeEach(async () => {
  await env.clearFirestore();
  await seed("schools/school-a", { status: "active" });
  await seed("schoolYears/year-a", { schoolId: "school-a", status: "active" });
  await seed("users/school-wide", { schoolId: "school-a", role: "discipline_director" });
  await seed("users/primary", { schoolId: "school-a", role: "discipline_director", sectionIds: ["Primaire"] });
  await seed("users/legacy-primary", { schoolId: "school-a", role: "discipline_director", section: "Primaire" });
});
afterAll(() => env.cleanup(), 30_000);

describe("réglages de présence par section (lot R3)", () => {
  it("un Directeur sans section modifie toujours toute l'école", async () => {
    await seed(`attendanceSettings/${settingsId}`, baseSettings);
    const ref = doc(discipline("school-wide"), "attendanceSettings", settingsId);
    await assertSucceeds(updateDoc(ref, { schoolDays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"], updatedBy: "school-wide" }));
    await assertSucceeds(updateDoc(ref, { "sectionSchedule.Secondaire": { monday: { lateAfter: "08:00" } }, "sectionSchoolDays.Secondaire": ["monday"] }));
    await assertSucceeds(updateDoc(ref, { defaultSchedule: { monday: { lateAfter: "07:00" } } }));
  });

  it("un Directeur avec section modifie les heures et les jours de SA section", async () => {
    await seed(`attendanceSettings/${settingsId}`, baseSettings);
    const ref = doc(discipline("primary"), "attendanceSettings", settingsId);
    await assertSucceeds(updateDoc(ref, { "sectionSchedule.Primaire": { monday: { lateAfter: "07:20" } }, updatedBy: "primary", updatedAt: "2026-11-26T00:00:00.000Z" }));
    await assertSucceeds(updateDoc(ref, { "sectionSchoolDays.Primaire": ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] }));
    await assertSucceeds(updateDoc(ref, { "sectionSchoolDays.Primaire": deleteField() }));
    await assertSucceeds(updateDoc(ref, { "classSchedule.1ère Primaire": { monday: { lateAfter: "07:10" } } }));
  });

  it("le champ historique « section » seul suffit pour délimiter le compte", async () => {
    await seed(`attendanceSettings/${settingsId}`, baseSettings);
    const ref = doc(discipline("legacy-primary"), "attendanceSettings", settingsId);
    await assertSucceeds(updateDoc(ref, { "sectionSchoolDays.Primaire": ["monday"] }));
    await assertFails(updateDoc(ref, { "sectionSchoolDays.Secondaire": ["monday"] }));
  });

  it("un Directeur avec section ne touche ni aux autres sections ni aux réglages de l'école", async () => {
    await seed(`attendanceSettings/${settingsId}`, baseSettings);
    const ref = doc(discipline("primary"), "attendanceSettings", settingsId);
    await assertFails(updateDoc(ref, { "sectionSchedule.Secondaire": { monday: { lateAfter: "09:00" } } }));
    await assertFails(updateDoc(ref, { "sectionSchedule.Secondaire": deleteField() }));
    await assertFails(updateDoc(ref, { "sectionSchoolDays.Secondaire": ["monday"] }));
    await assertFails(updateDoc(ref, { schoolDays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] }));
    await assertFails(updateDoc(ref, { defaultSchedule: { monday: { lateAfter: "09:00" } } }));
    await assertFails(updateDoc(ref, { defaultLateAfter: "09:00" }));
    await assertFails(updateDoc(ref, { sectionSchedule: { Primaire: { monday: { lateAfter: "07:20" } } } }));
  });

  it("un enregistrement complet périmé (écrasant une autre section) est refusé", async () => {
    await seed(`attendanceSettings/${settingsId}`, baseSettings);
    const stale = { ...baseSettings, sectionSchedule: { Primaire: { monday: { lateAfter: "07:20" } }, Secondaire: { monday: { lateAfter: "07:00" } } }, updatedBy: "primary" };
    await assertFails(setDoc(doc(discipline("primary"), "attendanceSettings", settingsId), stale));
    const fresh = { ...baseSettings, sectionSchedule: { ...baseSettings.sectionSchedule, Primaire: { monday: { lateAfter: "07:20" } } }, updatedBy: "primary" };
    await assertSucceeds(setDoc(doc(discipline("primary"), "attendanceSettings", settingsId), fresh));
  });

  it("à la création, un Directeur avec section n'écrit que ses sections", async () => {
    const ref = doc(discipline("primary"), "attendanceSettings", settingsId);
    const own = { id: settingsId, schoolId: "school-a", schoolYearId: "year-a", sectionSchedule: { Primaire: { monday: { lateAfter: "07:20" } } }, sectionSchoolDays: { Primaire: ["monday"] }, classSchedule: {}, updatedAt: "2026-11-26T00:00:00.000Z", updatedBy: "primary" };
    await assertFails(setDoc(ref, { ...own, schoolDays: ["monday"] }));
    await assertFails(setDoc(ref, { ...own, sectionSchoolDays: { Secondaire: ["monday"] } }));
    await assertSucceeds(setDoc(ref, own));
  });

  it("à la création, un Directeur sans section garde le comportement actuel", async () => {
    await assertSucceeds(setDoc(doc(discipline("school-wide"), "attendanceSettings", settingsId), baseSettings));
  });
});
