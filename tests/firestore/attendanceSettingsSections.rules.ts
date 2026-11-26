import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

// Lot R3 : un Directeur de discipline avec sections enregistre ses réglages de présence par le
// serveur ; un Directeur sans section garde l'écriture directe d'aujourd'hui.
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
  sectionSchedule: { Primaire: { monday: { lateAfter: "07:15" } } },
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
  await seed("users/empty-sections", { schoolId: "school-a", role: "discipline_director", sectionIds: [], section: null });
  await seed("users/primary", { schoolId: "school-a", role: "discipline_director", sectionIds: ["Primaire"] });
  await seed("users/legacy-primary", { schoolId: "school-a", role: "discipline_director", section: "Primaire" });
});
afterAll(() => env.cleanup(), 30_000);

describe("réglages de présence et sections du Directeur de discipline (lot R3)", () => {
  it("un Directeur sans section écrit toujours directement, comme aujourd'hui", async () => {
    await assertSucceeds(setDoc(doc(discipline("school-wide"), "attendanceSettings", settingsId), baseSettings));
    const ref = doc(discipline("school-wide"), "attendanceSettings", settingsId);
    await assertSucceeds(updateDoc(ref, { schoolDays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] }));
    await assertSucceeds(updateDoc(ref, { "sectionSchoolDays.Secondaire": ["monday"] }));
  });

  it("une liste de sections vide compte comme « sans section »", async () => {
    await seed(`attendanceSettings/${settingsId}`, baseSettings);
    await assertSucceeds(updateDoc(doc(discipline("empty-sections"), "attendanceSettings", settingsId), { defaultSchedule: { monday: { lateAfter: "07:00" } } }));
  });

  it("un Directeur avec sections n'écrit plus directement (il passe par le serveur)", async () => {
    await seed(`attendanceSettings/${settingsId}`, baseSettings);
    const ref = doc(discipline("primary"), "attendanceSettings", settingsId);
    await assertFails(updateDoc(ref, { "sectionSchedule.Primaire": { monday: { lateAfter: "07:20" } } }));
    await assertFails(updateDoc(ref, { schoolDays: ["monday"] }));
    await assertFails(updateDoc(doc(discipline("legacy-primary"), "attendanceSettings", settingsId), { "sectionSchoolDays.Primaire": ["monday"] }));
  });

  it("à la création aussi, un Directeur avec sections passe par le serveur", async () => {
    await assertFails(setDoc(doc(discipline("primary"), "attendanceSettings", settingsId), baseSettings));
  });

  it("la lecture reste ouverte à tous les Directeurs de discipline de l'école", async () => {
    await seed(`attendanceSettings/${settingsId}`, baseSettings);
    await assertSucceeds(getDoc(doc(discipline("primary"), "attendanceSettings", settingsId)));
    await assertSucceeds(getDoc(doc(discipline("school-wide"), "attendanceSettings", settingsId)));
  });
});
