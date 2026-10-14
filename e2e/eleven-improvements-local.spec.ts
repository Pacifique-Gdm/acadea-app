import { randomUUID } from "node:crypto";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { expect, test, type Browser, type Page, type Route } from "@playwright/test";
import financeHandler from "../api/manage-financial-transaction.js";

const origin = "http://127.0.0.1:5173";
const projectId = "demo-acadea";
const suffix = randomUUID().slice(0, 8);
const uid = `e2e-options-super-${suffix}`;
const email = `${uid}@local-e2e.invalid`;
const password = `LocalOnly${randomUUID().replace(/-/g, "").slice(0, 16)}!`;
const schoolId = `e2e-options-school-${suffix}`;
const suspendedSchoolId = `e2e-options-suspended-${suffix}`;
const yearId = `${schoolId}__2026-2027`;
const coordinationId = `e2e-options-coord-${suffix}`;
const subCoordinationId = `e2e-options-sub-${suffix}`;
const additionalRoles = ["discipline_director", "study_director", "teacher", "coordination_admin", "sub_coordination_admin"] as const;
const additionalAccounts = additionalRoles.map((role) => ({ uid: `e2e-options-${role}-${suffix}`, email: `e2e-options-${role}-${suffix}@local-e2e.invalid`, role }));
const app = initializeApp({ projectId });
const auth = getAuth(app);
const db = getFirestore(app);

function assertLocalOnly() {
  if (process.env.ACADEA_E2E_LOCAL_EMULATORS !== "YES"
    || process.env.VITE_FIREBASE_PROJECT_ID !== projectId
    || process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
    || process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080"
    || process.env.FIREBASE_STORAGE_EMULATOR_HOST !== "127.0.0.1:9199"
    || process.env.ACADEA_E2E_BASE_URL !== origin) {
    throw new Error("E2E des améliorations réservé aux émulateurs locaux.");
  }
}

async function localPage(browser: Browser, actor: { email: string; route: string } = { email, route: "/platform" }) {
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 900 } });
  const remoteRequests: string[] = [];
  await context.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseio\.com|firebasestorage\.app)/, (route) => {
    remoteRequests.push(new URL(route.request().url()).hostname);
    return route.abort();
  });
  await context.route("**/api/manage-financial-transaction", async (route: Route) => {
    const request = route.request();
    let statusCode = 200;
    let body = "";
    const response = {
      get statusCode() { return statusCode; },
      set statusCode(value: number) { statusCode = value; },
      setHeader() { /* JSON response supplied below. */ },
      end(value: string) { body = value; },
    };
    await financeHandler({ method: request.method(), headers: request.headers(), body: request.postDataJSON() }, response);
    await route.fulfill({ status: statusCode, contentType: "application/json", body });
  });
  const page = await context.newPage();
  await page.goto("/login", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByPlaceholder("email@ecole.com").fill(actor.email);
  await page.getByPlaceholder("Votre mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click({ noWaitAfter: true });
  await page.waitForURL((url) => url.pathname === actor.route, { waitUntil: "domcontentloaded", timeout: 30_000 });
  page.setDefaultTimeout(8_000);
  return { context, page, remoteRequests };
}

async function fits(page: Page) {
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    for (const drawer of await page.getByRole("dialog").all()) {
      const box = await drawer.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(-1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

test.describe("améliorations Super Administrateur — navigateur local isolé", () => {
  test.setTimeout(120_000);
  test.beforeAll(async () => {
    assertLocalOnly();
    await auth.createUser({ uid, email, password, displayName: "Super Admin local" });
    await auth.setCustomUserClaims(uid, { role: "super_admin" });
    await db.doc(`users/${uid}`).set({ id: uid, name: "Super Admin local", email, role: "super_admin", status: "active", active: true });
    for (const [id, name, status] of [[schoolId, "École locale active", "active"], [suspendedSchoolId, "École locale suspendue", "suspended"]]) {
      await db.doc(`schools/${id}`).set({ id, name, acronym: "E2E", status, schoolType: "CTEB et Secondaire", educationLevels: ["CTEB", "Secondaire"], activeSchoolYearId: yearId, activeCoordinationId: coordinationId, currency: "CDF", schoolOptions: ["Littéraire"] });
    }
    await db.doc(`schoolYears/${yearId}`).set({ id: yearId, schoolId, name: "2026-2027", status: "active", startsAt: "2026-09-01", endsAt: "2027-07-31" });
    await db.doc(`coordinations/${coordinationId}`).set({ id: coordinationId, name: "Coordination locale", code: "CL", address: "Adresse fictive", phone: "+243000000000", email: "coord@local-e2e.invalid", status: "active" });
    await db.doc(`subCoordinations/${subCoordinationId}`).set({ id: subCoordinationId, coordinationId, coordinatorUserId: additionalAccounts.find((account) => account.role === "sub_coordination_admin")!.uid, circumscription: "Zone locale", status: "active", active: true });
    await db.doc(`coordinationSchools/${coordinationId}__${schoolId}`).set({ coordinationId, schoolId, active: true });
    await db.doc(`subCoordinationSchools/${subCoordinationId}__${schoolId}`).set({ coordinationId, subCoordinationId, schoolId, active: true });
    for (const account of additionalAccounts) {
      const scope = account.role.includes("coordination") ? { coordinationId, ...(account.role === "sub_coordination_admin" ? { subCoordinationId } : {}) } : { schoolId };
      await auth.createUser({ uid: account.uid, email: account.email, password, displayName: account.role });
      await auth.setCustomUserClaims(account.uid, { role: account.role, ...scope });
      await db.doc(`users/${account.uid}`).set({ id: account.uid, name: account.role, email: account.email, role: account.role, status: "active", active: true, ...scope });
    }
    const teacher = additionalAccounts.find((account) => account.role === "teacher")!;
    await db.doc(`teachers/${schoolId}__${yearId}__${teacher.uid}`).set({ id: `${schoolId}__${yearId}__${teacher.uid}`, schoolId, schoolYearId: yearId, userId: teacher.uid, name: "Enseignant local", active: true, status: "active" });
  });

  test.afterAll(async () => {
    assertLocalOnly();
    for (const path of [
      `users/${uid}`, ...additionalAccounts.map((account) => `users/${account.uid}`),
      `schools/${schoolId}`, `schools/${suspendedSchoolId}`, `schoolYears/${yearId}`,
      `teachers/${schoolId}__${yearId}__${additionalAccounts.find((account) => account.role === "teacher")!.uid}`,
      `coordinations/${coordinationId}`, `subCoordinations/${subCoordinationId}`,
      `coordinationSchools/${coordinationId}__${schoolId}`, `subCoordinationSchools/${subCoordinationId}__${schoolId}`,
      "platformSettings/schoolOptionsCatalog",
    ]) await db.doc(path).delete();
    for (const account of additionalAccounts) await auth.deleteUser(account.uid);
    await auth.deleteUser(uid);
    await deleteApp(app);
  });

  test("niveau mixte, catalogue et confirmations restent accessibles et contenus", async ({ browser }) => {
    const { context, page, remoteRequests } = await localPage(browser);
    try {
      console.info("E2E améliorations : plateforme ouverte");
      await expect(page.getByText("1 actives, 1 suspendues")).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: "Menu", exact: true }).last().click();
      await page.getByRole("button", { name: /Créer une école/ }).click();
      const create = page.getByRole("dialog", { name: "Créer une école" });
      await expect(create).toBeVisible();
      await create.getByLabel("Niveau de l'école").selectOption("CTEB et Secondaire");
      await expect(create.getByLabel("Niveau de l'école")).toHaveValue("CTEB et Secondaire");
      await expect(create.getByText("Options scolaires")).toBeVisible();
      await create.getByRole("checkbox", { name: "Autre" }).check();
      await create.getByPlaceholder("Ex. Informatique").fill(`Option locale ${suffix}`);
      await create.getByRole("button", { name: "Ajouter", exact: true }).click();
      await expect(create.getByRole("button", { name: "Confirmer l'ajout" })).toBeDisabled();
      await create.getByLabel("Confirmation d'ajout au catalogue global").fill("AJOUTER CETTE OPTION");
      await create.getByRole("button", { name: "Confirmer l'ajout" }).click();
      console.info("E2E améliorations : ajout catalogue soumis");
      await expect.poll(async () => (await db.doc("platformSettings/schoolOptionsCatalog").get()).data()?.options, { timeout: 10_000 }).toContain(`Option locale ${suffix}`);
      console.info("E2E améliorations : catalogue persisté");
      await fits(page);
      await create.getByRole("button", { name: /Fermer/ }).click();

      await page.getByRole("button", { name: /Logo de l'application/ }).click();
      const logo = page.getByRole("dialog", { name: "Logo de l'application" });
      await expect(logo).toBeVisible();
      await logo.locator('input[type="file"]').setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>') });
      console.info("E2E améliorations : logo fictif sélectionné");
      await logo.getByRole("button", { name: "Enregistrer le logo" }).click();
      const logoConfirmation = logo.getByRole("group", { name: "Confirmer la modification du logo" });
      await expect(logoConfirmation.getByText("ENREGISTRER LE NOUVEAU LOGO", { exact: false })).toBeVisible();
      await expect(logoConfirmation.getByRole("button", { name: "Confirmer" })).toBeDisabled();
      await logoConfirmation.getByLabel("Phrase de confirmation du logo").fill("ENREGISTRER LE NOUVEAU LOGO");
      await expect(logoConfirmation.getByRole("button", { name: "Confirmer" })).toBeEnabled();
      await fits(page);
      await logoConfirmation.getByRole("button", { name: "Annuler" }).click();
      console.info("E2E améliorations : logo annulé");
      expect((await db.doc("publicConfig/appConfig").get()).exists).toBe(false);
      await logo.getByRole("button", { name: /Fermer/ }).click();

      await page.getByRole("button", { name: "Écoles", exact: true }).last().click();
      await expect(page.getByText("École locale active")).toBeVisible();
      await page.getByRole("button", { name: /École locale active/ }).click();
      console.info("E2E améliorations : école active ouverte");
      const school = page.getByRole("dialog", { name: "École locale active" });
      await expect(school).toBeVisible();
      await school.getByRole("button", { name: "Suspendre", exact: true }).click();
      const suspend = page.getByRole("dialog", { name: "Suspendre l'école" });
      await expect(suspend.getByText("SUSPENDRE CETTE ÉCOLE", { exact: true })).toBeVisible();
      await expect(suspend.getByRole("button", { name: "Confirmer" })).toBeDisabled();
      await suspend.getByLabel("Phrase de confirmation du statut de l'école").fill("SUSPENDRE CETTE ÉCOLE");
      await expect(suspend.getByRole("button", { name: "Confirmer" })).toBeEnabled();
      await fits(page);
      await suspend.getByRole("button", { name: "Annuler", exact: true }).click();
      expect((await db.doc(`schools/${schoolId}`).get()).data()?.status).toBe("active");
      await school.getByRole("button", { name: /Fermer/ }).click();

      await page.getByRole("button", { name: /École locale suspendue/ }).click();
      const inactive = page.getByRole("dialog", { name: "École locale suspendue" });
      await inactive.getByRole("button", { name: "Reactiver" }).click();
      const reactivate = page.getByRole("dialog", { name: "Réactiver l'école" });
      await expect(reactivate.getByText("RÉACTIVER CETTE ÉCOLE", { exact: true })).toBeVisible();
      await expect(reactivate.getByRole("button", { name: "Confirmer" })).toBeDisabled();
      await fits(page);
      await reactivate.getByRole("button", { name: "Annuler", exact: true }).click();
      expect((await db.doc(`schools/${suspendedSchoolId}`).get()).data()?.status).toBe("suspended");
      expect(remoteRequests).toEqual([]);
    } finally { await context.close(); }
  });

  test("Salaire/Prime des trois autres rôles et en-têtes Coordination restent lisibles", async ({ browser }) => {
    for (const account of additionalAccounts) {
      const route = account.role === "study_director" ? "/studies" : account.role === "teacher" ? "/teacher" : account.role.includes("coordination") ? "/coordination" : "/dashboard";
      const { context, page, remoteRequests } = await localPage(browser, { email: account.email, route });
      try {
        if (account.role.includes("coordination")) {
          await expect(page.getByRole("heading", { name: account.role === "coordination_admin" ? "Coordination locale" : "Sous-coordination — Zone locale" })).toBeVisible({ timeout: 30_000 });
          await expect(page.getByText("Code Coordination : CL")).toBeVisible();
          await fits(page);
          await page.getByRole("button", { name: "Contrôle", exact: true }).last().click();
          await page.getByRole("button", { name: "Historique", exact: true }).click();
          const history = page.getByRole("dialog", { name: "Historique du contrôle" });
          await history.getByRole("button", { name: "Salaire/Prime", exact: true }).click();
          await expect(history.getByText("Aucun salaire ou prime versé dans ce périmètre.")).toBeVisible({ timeout: 30_000 });
          await fits(page);
        } else {
          await page.getByRole("button", { name: "Menu", exact: true }).last().click();
          const payroll = page.getByRole("button", { name: /Salaire\/Prime/ }).first();
          await expect(payroll).toBeVisible({ timeout: 30_000 });
          await payroll.click();
          await expect(page.getByRole("dialog", { name: "Salaire/Prime" })).toBeVisible();
          await fits(page);
          await page.getByRole("button", { name: "Fermer mes salaires et primes" }).click();
        }
        expect(remoteRequests).toEqual([]);
      } finally { await context.close(); }
    }
  });
});
