import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import gradingHandler from "../api/manage-teacher-grading.js";
import enrollmentHandler from "../api/provision-school-account.js";
import financialHandler from "../api/manage-financial-transaction.js";

const origin = "http://127.0.0.1:4173";
const local = process.env.ACADEA_E2E_LOCAL_EMULATORS === "YES";
const enabled = local || process.env.ACADEA_STAGING_E2E === "YES";
const fixture = enabled ? JSON.parse(readFileSync("test-results/offline-staging-fixture.json", "utf8")) as {
  projectId: string; tag: string; ids: Record<string, string>;
  users: Record<string, { uid: string; email: string; role: string }>;
} : null;

test.skip(!enabled, "Recette réservée aux émulateurs explicites ou à GitHub Actions Staging.");
if (local && (fixture?.projectId !== "demo-acadea" || process.env.VITE_FIREBASE_PROJECT_ID !== "demo-acadea"
  || process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
  || process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080"
  || process.env.FIREBASE_STORAGE_EMULATOR_HOST !== "127.0.0.1:9199"
  || process.env.ACADEA_E2E_BASE_URL !== origin
  || process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_SERVICE_ACCOUNT_JSON)) {
  throw new Error("Émulateurs demo-acadea exclusivement requis.");
}
if (enabled && !local && (fixture?.projectId !== "acadea-staging" || !fixture.tag.startsWith("e2e-offline-")
  || process.env.GOOGLE_CLOUD_PROJECT !== "acadea-staging"
  || process.env.VITE_FIREBASE_PROJECT_ID !== "acadea-staging"
  || process.env.ACADEA_E2E_BASE_URL !== origin || process.env.GITHUB_ACTIONS !== "true")) {
  throw new Error("Environnement Staging authentifié invalide.");
}
const app = enabled ? getApps()[0] ?? initializeApp(local ? { projectId: "demo-acadea" } : { credential: applicationDefault(), projectId: "acadea-staging" }) : null;
const db = app ? getFirestore(app) : null;
const ids = fixture?.ids;
const schoolId = ids?.school;

type ApiHandler = (request: unknown, response: unknown) => Promise<void>;
const handlers: Record<string, ApiHandler> = {
  "/api/manage-teacher-grading": gradingHandler,
  "/api/provision-school-account": enrollmentHandler,
  "/api/manage-financial-transaction": financialHandler,
};

async function invoke(handler: ApiHandler, method: string, headers: Record<string, string>, body: unknown) {
  let status = 200, payload: unknown = null;
  const response = {
    status(value: number) { status = value; return this; },
    json(value: unknown) { payload = value; return this; },
    setHeader() { return this; },
    end(value: string) { payload = JSON.parse(value); return this; },
    set statusCode(value: number) { status = value; },
  };
  await handler({ method, headers, body }, response);
  return { status, payload: payload as Record<string, unknown> };
}

async function createSession(browser: Browser, role: string, transport = { dropNextAttendanceResponse: false }, persistent = false) {
  const profile = persistent ? await mkdtemp(join(tmpdir(), "acadea-offline-browser-")) : null;
  const openContext = (offline = false) => profile
    ? browser.browserType().launchPersistentContext(profile, { baseURL: origin, serviceWorkers: "allow", offline, headless: true })
    : browser.newContext({ baseURL: origin, serviceWorkers: "allow", offline });
  let context = await openContext();
  const calls: Array<{ path: string; status: number; body: Record<string, unknown>; result: Record<string, unknown>; authorization: string }> = [];
  const attachApi = (target: BrowserContext) => target.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const handler = handlers[path];
    if (!handler) return route.fulfill({ status: 404, body: "API E2E absente" });
    const body = (route.request().postData() ? route.request().postDataJSON() : {}) as Record<string, unknown>;
    const outcome = await invoke(handler, route.request().method(), route.request().headers(), body);
    calls.push({ path, status: outcome.status, body, result: outcome.payload,
      authorization: route.request().headers().authorization });
    if (transport.dropNextAttendanceResponse && outcome.status === 200 && body.action === "sync-offline-attendance") {
      transport.dropNextAttendanceResponse = false;
      return route.abort("connectionreset");
    }
    return route.fulfill({ status: outcome.status, contentType: "application/json", body: JSON.stringify(outcome.payload) });
  });
  await attachApi(context);
  let page = await context.newPage();
  await page.addInitScript(() => {
    window.addEventListener("acadea:offline-context-ready", () => {
      (window as Window & { acadeaOfflineContextReady?: boolean }).acadeaOfflineContextReady = true;
    });
  });
  page.setDefaultTimeout(15_000);
  const login = async () => {
    await page.goto("/login");
    await page.getByPlaceholder("email@ecole.com").fill(fixture!.users[role].email);
    await page.getByPlaceholder("Votre mot de passe").fill(process.env.ACADEA_E2E_PASSWORD!);
    await page.getByRole("button", { name: "Se connecter", exact: true }).click();
    await page.waitForURL((url) => url.pathname !== "/login");
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => page.evaluate(async () => {
      const cache = await caches.open("acadea-pwa-v6-assets");
      return Boolean(await cache.match(document.querySelector<HTMLScriptElement>('script[type="module"]')?.src || ""));
    }), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => page.evaluate(() => Boolean((window as Window & { acadeaOfflineContextReady?: boolean }).acadeaOfflineContextReady)),
      { timeout: 45_000 }).toBe(true);
  };
  const session = { context, page, calls, login,
    async restartOffline() {
      if (!profile) throw new Error("Profil persistant requis pour redémarrer Chromium.");
      const url = page.url();
      await context.close(); // Ferme entièrement le processus Chromium persistant.
      context = await openContext(true);
      await attachApi(context);
      page = await context.newPage();
      page.setDefaultTimeout(15_000);
      session.context = context;
      session.page = page;
      await page.goto(url);
    },
    async dispose() {
      await context.close();
      if (profile) {
        if (dirname(profile) !== tmpdir() || !basename(profile).startsWith("acadea-offline-browser-")) throw new Error("Profil temporaire inattendu.");
        await rm(profile, { recursive: true });
      }
    },
  };
  return session;
}

async function returnOnline(context: BrowserContext, page: Page) {
  await context.setOffline(false);
  const loginField = page.getByPlaceholder("email@ecole.com");
  if (await loginField.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false)) {
    await loginField.fill(fixture!.users[roleOf(page)].email);
    await page.getByPlaceholder("Votre mot de passe").fill(process.env.ACADEA_E2E_PASSWORD!);
    await page.getByRole("button", { name: "Se connecter", exact: true }).click();
    await page.waitForURL((url) => url.pathname !== "/login");
  }
}

// This role marker is kept in the test process only; it is not written to the browser or logs.
const pageRoles = new WeakMap<Page, string>();
function roleOf(page: Page) { const role = pageRoles.get(page); if (!role) throw new Error("Rôle E2E absent."); return role; }
async function offline(context: BrowserContext) {
  await context.setOffline(true);
  const page = context.pages()[0];
  await page.getByRole("button", { name: "Voir les opérations" }).click();
  await expect(page.getByRole("region", { name: "État des opérations hors connexion" })).toBeVisible();
}
async function draft(page: Page) {
  await page.getByRole("button", { name: "Enregistrer le brouillon local" }).click();
  await expect(page.getByText("Brouillon local enregistré.", { exact: false })).toBeVisible();
}

test.describe(local ? "recette hors connexion authentifiée sur émulateurs" : "recette hors connexion authentifiée sur acadea-staging", () => {
  test.setTimeout(180_000);

  test("réouverture, cote, accusé serveur et idempotence", async ({ browser }) => {
    const session = await createSession(browser, "teacher", { dropNextAttendanceResponse: false }, true);
    pageRoles.set(session.page, "teacher");
    try {
      await session.login();
      console.info("[offline-reopen] context prepared");
      await offline(session.context);
      await expect(session.page.getByRole("button", { name: "Enregistrer le brouillon local" })).toBeVisible({ timeout: 30_000 });
      await session.page.getByLabel("Cours préchargé").selectOption(ids!.assignment);
      await session.page.getByLabel("Élève", { exact: true }).selectOption(ids!.student);
      await session.page.getByLabel("Cote locale").fill("12");
      await draft(session.page);
      console.info("[offline-reopen] draft saved locally");
      expect((await db!.collection("gradeEntries").where("schoolId", "==", schoolId).get()).empty).toBe(true);
      await session.restartOffline();
      console.info("[offline-reopen] browser restarted offline");
      pageRoles.set(session.page, "teacher");
      await expect(session.page.getByRole("heading", { name: "Acadéa hors connexion" })).toBeVisible({ timeout: 25_000 });
      console.info("[offline-reopen] offline page visible");
      await returnOnline(session.context, session.page);
      console.info("[offline-reopen] connection restored");
      await expect.poll(async () => (await db!.collection("gradeEntries").where("schoolId", "==", schoolId).get()).size, { timeout: 45_000 }).toBe(1);
      console.info("[offline-reopen] server receipt observed");
      const grade = (await db!.collection("gradeEntries").where("schoolId", "==", schoolId).get()).docs[0].data();
      expect(grade.score).toBe(12);
      const call = session.calls.find((item) => item.body.action === "sync-offline-grade" && item.status === 200);
      expect(call).toBeTruthy();
      const repeated = await invoke(gradingHandler, "POST", { authorization: call!.authorization }, call!.body);
      expect(repeated.status).toBe(200);
      expect((await db!.collection("gradeEntries").where("schoolId", "==", schoolId).get()).size).toBe(1);
    } finally { await session.dispose(); }
  });

  test("maximum modifié pendant la déconnexion : conflit sans écrasement", async ({ browser }) => {
    const session = await createSession(browser, "teacher");
    pageRoles.set(session.page, "teacher");
    try {
      const initialGradeCount = (await db!.collection("gradeEntries").where("schoolId", "==", schoolId).get()).size;
      await session.login();
      await offline(session.context);
      await session.page.getByLabel("Cours préchargé").selectOption(ids!.assignment);
      await session.page.getByLabel("Période").selectOption("period_2");
      await session.page.getByLabel("Élève", { exact: true }).selectOption(ids!.student);
      await session.page.getByLabel("Cote locale").fill("13");
      await draft(session.page);
      await db!.doc(`courseGradingConfigs/${[ids!.school, ids!.year, ids!.class, ids!.subject].join("__")}`).update({ maxScore: 25 });
      await returnOnline(session.context, session.page);
      await expect.poll(() => session.calls.some((item) => item.body.action === "sync-offline-grade" && item.status === 409), { timeout: 45_000 }).toBe(true);
      await expect(session.page.getByText("Conflit — intervention nécessaire", { exact: true })).toBeVisible();
      await session.page.getByRole("button", { name: "Réessayer la synchronisation", exact: true }).click();
      await expect(session.page.getByText("Conflit — intervention nécessaire", { exact: true })).toBeVisible();
      expect((await db!.collection("gradeEntries").where("schoolId", "==", schoolId).get()).size).toBe(initialGradeCount);
    } finally { await session.context.close(); }
  });

  test("présence hors ligne, réponse perdue et nouvelle tentative sans doublon", async ({ browser }) => {
    const transport = { dropNextAttendanceResponse: true };
    const session = await createSession(browser, "discipline_director", transport);
    pageRoles.set(session.page, "discipline_director");
    try {
      await session.login();
      await offline(session.context);
      await session.page.getByLabel("Élève", { exact: true }).selectOption(ids!.student);
      await session.page.getByLabel("Motif manuel").fill("Contrôle E2E fictif");
      await draft(session.page);
      expect((await db!.collection("attendance").where("schoolId", "==", schoolId).get()).empty).toBe(true);
      await returnOnline(session.context, session.page);
      await expect.poll(async () => (await db!.collection("attendance").where("schoolId", "==", schoolId).get()).size, { timeout: 45_000 }).toBe(1);
      await expect(session.page.getByText("À réessayer à la reconnexion", { exact: true })).toBeVisible();
      await session.page.getByRole("button", { name: "Réessayer la synchronisation", exact: true }).click();
      await expect(session.page.getByText("Confirmée par le serveur", { exact: true })).toBeVisible();
      expect((await db!.collection("attendance").where("schoolId", "==", schoolId).get()).size).toBe(1);
      expect(session.calls.some((item) => item.body.action === "sync-offline-attendance" && item.status === 200)).toBe(true);
    } finally { await session.context.close(); }
  });

  test("inscription locale synchronisée sans doublon", async ({ browser }) => {
    const session = await createSession(browser, "secretary");
    pageRoles.set(session.page, "secretary");
    try {
      await session.login();
      await offline(session.context);
      await session.page.getByLabel("Classe préchargée").selectOption(ids!.class);
      await session.page.getByLabel("Nom", { exact: true }).fill("Fictif");
      await session.page.getByLabel("Post-nom").fill("Essai");
      await session.page.getByLabel("Prénom").fill("Bob");
      await session.page.getByLabel("Date de naissance").fill("2016-05-06");
      await draft(session.page);
      expect((await db!.collection("students").where("schoolId", "==", schoolId).get()).size).toBe(1);
      await returnOnline(session.context, session.page);
      await expect.poll(async () => (await db!.collection("students").where("schoolId", "==", schoolId).get()).size, { timeout: 45_000 }).toBe(2);
      const call = session.calls.find((item) => item.body.action === "save-manual-student" && item.status === 200);
      expect(call).toBeTruthy();
      expect((await db!.collection("students").where("schoolId", "==", schoolId).get()).docs.some((row) => row.id === (call!.body.student as { id: string }).id)).toBe(true);
      const repeated = await invoke(enrollmentHandler, "POST", { authorization: call!.authorization }, call!.body);
      expect(repeated.status).toBe(200);
      expect((await db!.collection("students").where("schoolId", "==", schoolId).get()).size).toBe(2);
    } finally { await session.context.close(); }
  });

  test("paiement provisoire sans écriture locale, validation serveur et conflit financier", async ({ browser }) => {
    const session = await createSession(browser, "cashier");
    pageRoles.set(session.page, "cashier");
    try {
      await session.login();
      await offline(session.context);
      await session.page.getByLabel("Élève", { exact: true }).selectOption(ids!.student);
      await session.page.getByLabel("Type de frais").selectOption(ids!.fee);
      await session.page.getByLabel("Montant provisoire").fill("100");
      await draft(session.page);
      expect((await db!.collection("payments").where("schoolId", "==", schoolId).get()).empty).toBe(true);
      await returnOnline(session.context, session.page);
      await expect.poll(async () => (await db!.collection("payments").where("schoolId", "==", schoolId).get()).size, { timeout: 45_000 }).toBe(1);
      const payment = (await db!.collection("payments").where("schoolId", "==", schoolId).get()).docs[0].data();
      expect(payment.amount).toBe(100);
      expect(payment.receiptNumber).toBeTruthy();
      const paidCall = session.calls.find((item) => item.body.action === "create-payment" && item.status === 200);
      expect(paidCall).toBeTruthy();
      const repeated = await invoke(financialHandler, "POST", { authorization: paidCall!.authorization }, paidCall!.body);
      expect(repeated.status).toBe(200);
      expect((await db!.collection("payments").where("schoolId", "==", schoolId).get()).size).toBe(1);
      await session.context.close();
      const conflict = await createSession(browser, "cashier");
      pageRoles.set(conflict.page, "cashier");
      try {
        await conflict.login();
        await offline(conflict.context);
        await conflict.page.getByLabel("Élève", { exact: true }).selectOption(ids!.student);
        await conflict.page.getByLabel("Type de frais").selectOption(ids!.feeConflict);
        await conflict.page.getByLabel("Montant provisoire").fill("50");
        await draft(conflict.page);
        await db!.doc(`feeTypes/${ids!.feeConflict}`).update({ amount: 600 });
        await returnOnline(conflict.context, conflict.page);
        await expect.poll(() => conflict.calls.some((item) => item.body.action === "create-payment" && item.status === 409), { timeout: 45_000 }).toBe(true);
        expect((await db!.collection("payments").where("schoolId", "==", schoolId).get()).size).toBe(1);
      } finally { await conflict.context.close(); }
    } finally { await session.context.close().catch(() => {}); }
  });
});
