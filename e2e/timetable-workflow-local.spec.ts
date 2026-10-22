import { randomUUID } from "node:crypto";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { expect, test, type Browser } from "@playwright/test";
import handler from "../api/manage-teacher-grading.js";

const origin = "http://127.0.0.1:5173";
const projectId = "demo-acadea";
const tag = `e2e-pr28-${randomUUID().slice(0, 8)}`;
const schoolId = `${tag}-school`, yearId = `${tag}-year`, scheduleId = `${tag}-schedule`;
const teacherUid = `${tag}-teacher-user`, directorUid = `${tag}-director`;
const teacherId = `${tag}-teacher`, classId = `${tag}-class`, subjectId = `${tag}-subject`, assignmentId = `${tag}-assignment`;
const periodId = `${tag}-period`, entryId = `${tag}-entry`;
const password = `LocalOnly-${randomUUID()}!`;
const app = initializeApp({ projectId });
const db = getFirestore(app), auth = getAuth(app);
const paths: string[] = [];

function guard() {
  if (process.env.ACADEA_E2E_LOCAL_EMULATORS !== "YES" || process.env.VITE_FIREBASE_PROJECT_ID !== projectId
    || process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
    || process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080"
    || process.env.FIREBASE_STORAGE_EMULATOR_HOST !== "127.0.0.1:9199"
    || process.env.ACADEA_E2E_BASE_URL !== origin) throw new Error("Émulateurs demo-acadea requis.");
}
async function put(path: string, data: Record<string, unknown>) {
  guard();
  expect((await db.doc(path).get()).exists).toBe(false);
  await db.doc(path).create({ ...data, fixtureId: tag });
  paths.push(path);
}
async function idToken(uid: string) {
  guard();
  const response = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${uid}@local-e2e.invalid`, password, returnSecureToken: true }),
  });
  expect(response.ok).toBe(true);
  return (await response.json() as { idToken: string }).idToken;
}
async function invoke(token: string, body: Record<string, unknown>) {
  let status = 200, payload: unknown;
  await handler({ method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body }, {
    status(value: number) { status = value; return this; }, json(value: unknown) { payload = value; },
  });
  return { status, payload };
}
async function login(browser: Browser, uid: string) {
  const context = await browser.newContext({ baseURL: origin });
  const remote: string[] = [];
  const calls: Array<{ action: string; status: number }> = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (["http:", "https:"].includes(url.protocol) && !["127.0.0.1", "localhost"].includes(url.hostname)) {
      remote.push(url.hostname);
      return route.abort();
    }
    return route.continue();
  });
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    if (new URL(request.url()).pathname !== "/api/manage-teacher-grading") return route.fulfill({ status: 404, body: "API locale absente" });
    let status = 200, payload: unknown;
    await handler({ method: request.method(), headers: request.headers(), body: request.postDataJSON() }, {
      status(value: number) { status = value; return this; }, json(value: unknown) { payload = value; },
    });
    calls.push({ action: request.postDataJSON()?.action ?? "", status });
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.goto("/login");
  await page.getByPlaceholder("email@ecole.com").fill(`${uid}@local-e2e.invalid`);
  await page.getByPlaceholder("Votre mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page.waitForURL((url) => url.pathname !== "/login");
  return { context, page, remote, calls };
}

test.describe("PR #28 : Horaires authentifiés sur émulateurs", () => {
  test.setTimeout(180_000);
  test.beforeAll(async () => {
    guard();
    await put(`schools/${schoolId}`, { id: schoolId, name: "École fictive PR28", status: "active", activeSchoolYearId: yearId, currency: "CDF", timeZone: "Africa/Kinshasa" });
    await put(`schoolYears/${yearId}`, { id: yearId, schoolId, name: "2027-2028", status: "active", startsAt: "2027-09-01", endsAt: "2028-07-31", currency: "CDF" });
    for (const [uid, role] of [[directorUid, "study_director"], [teacherUid, "teacher"]]) {
      await auth.createUser({ uid, email: `${uid}@local-e2e.invalid`, password });
      await auth.setCustomUserClaims(uid, { role, schoolId });
      await put(`users/${uid}`, { id: uid, schoolId, role, name: role, email: `${uid}@local-e2e.invalid`, activeSchoolYearId: yearId, status: "active", active: true });
    }
    await put(`teachers/${teacherId}`, { id: teacherId, schoolId, schoolYearId: yearId, userId: teacherUid, fullName: "Professeur Fictif", status: "active", active: true });
    await put(`classes/${classId}`, { id: classId, schoolId, schoolYearId: yearId, name: "Classe fictive", section: "Secondaire", active: true });
    await put(`subjects/${subjectId}`, { id: subjectId, schoolId, schoolYearId: yearId, name: "Mathématiques fictives", active: true });
    await put(`pedagogicalAssignments/${assignmentId}`, { id: assignmentId, schoolId, schoolYearId: yearId, teacherId, classId, subjectId, weeklyPeriods: 1, active: true });
    await put(`schedulePeriods/${periodId}`, { id: periodId, schoolId, schoolYearId: yearId, label: "Première période", startTime: "08:00", endTime: "09:00", order: 1, type: "course", active: true });
    await put(`timetables/${scheduleId}`, { id: scheduleId, schoolId, schoolYearId: yearId, version: 1, status: "DRAFT", activeDraft: true, activePublished: false, persistenceState: "COMPLETE", createdBy: directorUid, createdAt: "2026-10-22T00:00:00Z", updatedAt: "2026-10-22T00:00:00Z", generationMetadata: { algorithm: "deterministic-backtracking", exploredBranches: 1, durationMs: 1, maxSameAssignmentPeriodsPerDay: 2, sourceFingerprint: "fixture-source" } });
    await put(`timetableEntries/${entryId}`, { id: entryId, schoolId, schoolYearId: yearId, scheduleId, teacherId, classId, subjectId, assignmentId, periodId, dayOfWeek: "monday", roomId: null, active: true });
  });
  test.afterAll(async () => {
    guard();
    const states = await db.collection("timetablePublicationStates").where("schoolId", "==", schoolId).where("schoolYearId", "==", yearId).get();
    for (const state of states.docs) {
      expect(state.data()).toMatchObject({ schoolId, schoolYearId: yearId });
      await state.ref.delete();
    }
    expect((await db.collection("timetablePublicationStates").where("schoolId", "==", schoolId).get()).empty).toBe(true);
    for (const path of paths.reverse()) {
      const ref = db.doc(path), snapshot = await ref.get();
      if (snapshot.exists) { expect(snapshot.data()?.fixtureId).toBe(tag); await ref.delete(); }
      expect((await ref.get()).exists).toBe(false);
    }
    for (const uid of [directorUid, teacherUid]) {
      await auth.deleteUser(uid);
      await expect(auth.getUser(uid)).rejects.toMatchObject({ code: "auth/user-not-found" });
    }
    await deleteApp(app);
  });

  test("Vérifier → Valider → Publier → consultation Enseignant", async ({ browser }) => {
    const director = await login(browser, directorUid);
    try {
      await director.page.getByRole("button", { name: "Horaires", exact: true }).click();
      await expect(director.page.getByRole("heading", { name: "Horaires" })).toBeVisible();
      await expect(director.page.getByRole("button", { name: "Valider", exact: true })).toBeDisabled();
      await expect(director.page.getByRole("button", { name: "Vérifier", exact: true })).toBeEnabled({ timeout: 20_000 });
      await director.page.getByRole("button", { name: "Vérifier", exact: true }).click();
      await expect(director.page.getByText("Horaire vérifié sans conflit")).toBeVisible();
      expect((await db.doc(`timetables/${scheduleId}`).get()).data()?.status).toBe("DRAFT");
      await director.page.getByRole("button", { name: "Valider", exact: true }).click();
      await director.page.getByRole("button", { name: "Confirmer la validation" }).click();
      await expect.poll(async () => (await db.doc(`timetables/${scheduleId}`).get()).data()?.status).toBe("VALID");
      await expect(director.page.getByRole("button", { name: "Publier", exact: true })).toBeDisabled();
      await director.page.getByRole("button", { name: "Vérifier", exact: true }).click();
      await director.page.getByRole("button", { name: "Publier", exact: true }).click();
      await director.page.getByRole("dialog", { name: "Publier cet horaire ?" }).getByRole("button", { name: "Publier" }).click();
      await expect.poll(async () => (await db.doc(`timetables/${scheduleId}`).get()).data()?.status).toBe("PUBLISHED");
      expect((await db.doc(`timetables/${scheduleId}`).get()).data()?.activePublished).toBe(true);
      expect(director.calls).toEqual([{ action: "timetable-validate", status: 200 }, { action: "timetable-publish", status: 200 }]);
      expect(director.remote).toEqual([]);
      const teacher = await login(browser, teacherUid);
      try {
        await teacher.page.getByRole("button", { name: "Mon horaire", exact: true }).click();
        await expect(teacher.page.getByRole("heading", { name: "Mon horaire" })).toBeVisible();
        await expect(teacher.page.getByText("Mathématiques fictives")).toBeVisible();
        await expect(teacher.page.locator(`[data-active-schedule-id="${scheduleId}"]`)).toBeVisible();
        expect(teacher.remote).toEqual([]);
      } finally { await teacher.context.close(); }
    } finally { await director.context.close(); }
  });

  test("conflit visible, validation refusée et permissions du vrai handler API", async ({ browser }) => {
    const invalid = `${tag}-invalid`;
    const updatedAt = "2026-10-22T01:00:00Z";
    await put(`timetables/${invalid}`, { id: invalid, schoolId, schoolYearId: yearId, version: 2, status: "DRAFT", activeDraft: true, activePublished: false, persistenceState: "COMPLETE", createdBy: directorUid, createdAt: updatedAt, updatedAt,
      generationMetadata: { algorithm: "deterministic-backtracking", exploredBranches: 1, durationMs: 1, maxSameAssignmentPeriodsPerDay: 2, sourceFingerprint: "fixture-source" } });
    for (const index of [1, 2]) await put(`timetableEntries/${invalid}-${index}`, { id: `${invalid}-${index}`, schoolId, schoolYearId: yearId, scheduleId: invalid, teacherId, classId, subjectId, assignmentId, periodId, dayOfWeek: "monday", roomId: null, active: true });
    const director = await login(browser, directorUid);
    try {
      await director.page.getByRole("button", { name: "Horaires", exact: true }).click();
      await expect(director.page.getByRole("button", { name: "Vérifier", exact: true })).toBeEnabled({ timeout: 30_000 });
      await director.page.getByRole("button", { name: "Vérifier", exact: true }).click();
      await expect(director.page.getByText("Horaire invalide")).toBeVisible();
      await expect(director.page.getByText(/deux créneaux qui se chevauchent/)).toBeVisible();
      await expect(director.page.getByRole("button", { name: "Valider", exact: true })).toBeDisabled();
      const request = { action: "timetable-validate", schoolId, schoolYearId: yearId, scheduleId: invalid, expectedUpdatedAt: updatedAt, requestId: randomUUID() };
      expect((await invoke("", request)).status).toBe(401);
      expect((await invoke(await idToken(teacherUid), request)).status).toBe(403);
      expect((await invoke(await idToken(directorUid), request)).status).toBe(409);
      expect((await db.doc(`timetables/${invalid}`).get()).data()?.status).toBe("DRAFT");
      expect(director.remote).toEqual([]);
    } finally { await director.context.close(); }
  });
});
