import { randomUUID } from "node:crypto";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { expect, test } from "@playwright/test";
import handler from "../api/manage-teacher-grading.js";

const origin = "http://127.0.0.1:4173";
const projectId = "demo-acadea";
const tag = `e2e-offline-${randomUUID().slice(0, 8)}`;
const schoolId = `${tag}-school`, yearId = `${tag}-year`, userId = `${tag}-user`;
const teacherId = `${tag}-teacher`, classId = `${tag}-class`, subjectId = `${tag}-subject`;
const assignmentId = `${tag}-assignment`, studentId = `${tag}-student`;
const configId = [schoolId, yearId, classId, subjectId].join("__");
const gradeId = [schoolId, yearId, classId, subjectId, studentId, "period_1"].join("__");
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

test.describe("saisie locale → réouverture → synchronisation serveur", () => {
  test.setTimeout(120_000);
  test.beforeAll(async () => {
    guard();
    await put(`schools/${schoolId}`, { id: schoolId, name: "École fictive hors connexion", status: "active", activeSchoolYearId: yearId, currency: "CDF" });
    await put(`schoolYears/${yearId}`, { id: yearId, schoolId, name: "2027-2028", status: "active", currency: "CDF" });
    await auth.createUser({ uid: userId, email: `${userId}@local-e2e.invalid`, password });
    await auth.setCustomUserClaims(userId, { role: "teacher", schoolId });
    await put(`users/${userId}`, { id: userId, schoolId, role: "teacher", name: "Professeur fictif", email: `${userId}@local-e2e.invalid`, activeSchoolYearId: yearId, status: "active", active: true });
    await put(`teachers/${teacherId}`, { id: teacherId, schoolId, schoolYearId: yearId, userId, fullName: "Professeur fictif", status: "active", active: true });
    await put(`classes/${classId}`, { id: classId, schoolId, schoolYearId: yearId, name: "Classe fictive", active: true });
    await put(`subjects/${subjectId}`, { id: subjectId, schoolId, schoolYearId: yearId, name: "Mathématiques fictives", active: true });
    await put(`pedagogicalAssignments/${assignmentId}`, { id: assignmentId, schoolId, schoolYearId: yearId, teacherId, classId, subjectId, active: true });
    await put(`students/${studentId}`, { id: studentId, schoolId, schoolYearId: yearId, classId, className: "Classe fictive", status: "ACTIVE", nom: "Élève", postnom: "Fictif", prenom: "Alice", matricule: `${tag}-001`, sexe: "F", birthDate: "2015-04-05" });
    await put(`courseGradingConfigs/${configId}`, { id: configId, schoolId, schoolYearId: yearId, classId, subjectId, maxScore: 20, active: true });
  });
  test.afterAll(async () => {
    guard();
    for (const name of ["gradeEntries", "offlineOperationReceipts", "pedagogicalActivityLogs", "apiRateLimits"]) {
      const rows = await db.collection(name).where("schoolId", "==", schoolId).get();
      for (const row of rows.docs) { expect(row.data()?.schoolId).toBe(schoolId); await row.ref.delete(); }
      expect((await db.collection(name).where("schoolId", "==", schoolId).get()).empty).toBe(true);
    }
    for (const path of paths.reverse()) {
      const ref = db.doc(path), row = await ref.get();
      if (row.exists) { expect(row.data()?.fixtureId).toBe(tag); await ref.delete(); }
      expect((await ref.get()).exists).toBe(false);
    }
    await auth.deleteUser(userId);
    await expect(auth.getUser(userId)).rejects.toMatchObject({ code: "auth/user-not-found" });
    await deleteApp(app);
  });

  test("une cote reste locale hors réseau puis reçoit un accusé unique après reconnexion", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: origin, serviceWorkers: "allow" });
    await context.route("**/api/**", async (route) => {
      if (new URL(route.request().url()).pathname !== "/api/manage-teacher-grading") return route.fulfill({ status: 404, body: "API locale absente" });
      let status = 200, payload: unknown;
      await handler({ method: route.request().method(), headers: route.request().headers(), body: route.request().postDataJSON() }, {
        status(value: number) { status = value; return this; }, json(value: unknown) { payload = value; },
      });
      return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    try {
      await page.goto("/login");
      await page.getByPlaceholder("email@ecole.com").fill(`${userId}@local-e2e.invalid`);
      await page.getByPlaceholder("Votre mot de passe").fill(password);
      await page.getByRole("button", { name: "Se connecter", exact: true }).click();
      await page.waitForURL((url) => url.pathname !== "/login");
      await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 30_000 }).toBe(true);
      await expect.poll(() => page.evaluate(async () => {
        const cache = await caches.open("acadea-pwa-v6-assets");
        return Boolean(await cache.match(document.querySelector<HTMLScriptElement>('script[type="module"]')?.src || ""));
      }), { timeout: 30_000 }).toBe(true);
      await context.setOffline(true);
      await expect(page.getByLabel("Cours préchargé")).toBeVisible({ timeout: 20_000 });
      await page.getByLabel("Cours préchargé").selectOption(assignmentId);
      await page.getByLabel("Élève", { exact: true }).selectOption(studentId);
      await page.getByLabel("Cote locale").fill("12");
      await page.getByRole("button", { name: "Enregistrer le brouillon local" }).click();
      await expect(page.getByText("Brouillon local enregistré.", { exact: false })).toBeVisible();
      expect((await db.doc(`gradeEntries/${gradeId}`).get()).exists).toBe(false);
      await page.reload();
      await expect(page.getByRole("heading", { name: "Acadéa hors connexion" })).toBeVisible({ timeout: 20_000 });
      await context.setOffline(false);
      // Firebase can lose its Auth session on an offline restart. Reauthenticate
      // normally before any queued operation is allowed to reach the server.
      await expect(page.getByPlaceholder("email@ecole.com")).toBeVisible({ timeout: 20_000 });
      await page.getByPlaceholder("email@ecole.com").fill(`${userId}@local-e2e.invalid`);
      await page.getByPlaceholder("Votre mot de passe").fill(password);
      await page.getByRole("button", { name: "Se connecter", exact: true }).click();
      await expect.poll(async () => (await db.doc(`gradeEntries/${gradeId}`).get()).data()?.score, { timeout: 30_000 }).toBe(12);
      expect((await db.collection("gradeEntries").where("schoolId", "==", schoolId).get()).size).toBe(1);
    } finally { await context.close().catch(() => {}); }
  });
});
