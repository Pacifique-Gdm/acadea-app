import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { expect, test, type Browser, type Route } from "@playwright/test";
import financeHandler from "../api/manage-financial-transaction.js";

const origin = "http://127.0.0.1:5173";
const projectId = "demo-acadea";
const suffix = randomUUID().slice(0, 8);
const schoolId = "e2e-payroll-export-school-" + suffix;
const foreignSchoolId = "e2e-payroll-export-foreign-" + suffix;
const coordinationId = "e2e-payroll-export-coord-" + suffix;
const subCoordinationId = "e2e-payroll-export-sub-" + suffix;
const password = "LocalOnly" + randomUUID().replace(/-/g, "").slice(0, 16) + "!";
const app = initializeApp({ projectId });
const auth = getAuth(app);
const db = getFirestore(app);
const accounts = {
  coordination_admin: { uid: "e2e-payroll-export-coordinator-" + suffix, email: "coordinator-" + suffix + "@local-e2e.invalid" },
  sub_coordination_admin: { uid: "e2e-payroll-export-subcoordinator-" + suffix, email: "subcoordinator-" + suffix + "@local-e2e.invalid" },
};
const fixturePaths = [
  "schools/" + schoolId, "schools/" + foreignSchoolId, "coordinations/" + coordinationId,
  "subCoordinations/" + subCoordinationId, "coordinationSchools/" + coordinationId + "__" + schoolId,
  "subCoordinationSchools/" + subCoordinationId + "__" + schoolId,
  ...Object.values(accounts).map((account) => "users/" + account.uid),
];

function assertLocalOnly() {
  if (process.env.ACADEA_E2E_LOCAL_EMULATORS !== "YES" || process.env.VITE_FIREBASE_PROJECT_ID !== projectId
    || process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
    || process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080"
    || process.env.FIREBASE_STORAGE_EMULATOR_HOST !== "127.0.0.1:9199"
    || process.env.ACADEA_E2E_BASE_URL !== origin) throw new Error("Export paie E2E réservé aux émulateurs locaux.");
}

async function routeFinance(route: Route) {
  if (new URL(route.request().url()).pathname !== "/api/manage-financial-transaction") {
    await route.fulfill({ status: 404, body: "API locale non simulée." });
    return;
  }
  let statusCode = 200;
  let contentType = "application/json";
  let responseBody = "";
  const response = {
    get statusCode() { return statusCode; },
    set statusCode(value: number) { statusCode = value; },
    setHeader(_name: string, value: string) { contentType = value; },
    end(value: string) { responseBody = value; },
  };
  const request = route.request();
  await financeHandler({ method: request.method(), headers: request.headers(), body: request.postDataJSON() }, response);
  await route.fulfill({ status: statusCode, contentType, body: responseBody });
}

test.describe("historique Salaire/Prime Coordination — navigateur local isolé", () => {
  test.setTimeout(300_000);
  test.beforeAll(async () => {
    assertLocalOnly();
    await db.doc("schools/" + schoolId).set({ id: schoolId, name: "École locale export", status: "active", activeSchoolYearId: schoolId + "__2026-2027", currency: "CDF" });
    await db.doc("schools/" + foreignSchoolId).set({ id: foreignSchoolId, name: "École étrangère fictive", status: "active", currency: "USD" });
    await db.doc("coordinations/" + coordinationId).set({ id: coordinationId, name: "Coordination locale export", code: "CLE", status: "active" });
    await db.doc("coordinationSchools/" + coordinationId + "__" + schoolId).set({ id: coordinationId + "__" + schoolId, coordinationId, schoolId, active: true, addedAt: "2026-10-01", addedBy: "fixture" });
    await db.doc("subCoordinations/" + subCoordinationId).set({ id: subCoordinationId, coordinationId, coordinatorUserId: accounts.sub_coordination_admin.uid, circumscription: "Locale", status: "active", active: true });
    await db.doc("subCoordinationSchools/" + subCoordinationId + "__" + schoolId).set({ id: subCoordinationId + "__" + schoolId, coordinationId, subCoordinationId, schoolId, active: true, addedAt: "2026-10-01", addedBy: "fixture" });
    for (const [role, account] of Object.entries(accounts)) {
      await auth.createUser({ uid: account.uid, email: account.email, password });
      await auth.setCustomUserClaims(account.uid, { role, coordinationId, ...(role === "sub_coordination_admin" ? { subCoordinationId } : {}) });
      await db.doc("users/" + account.uid).set({ id: account.uid, email: account.email, name: "Coordination E2E", role, coordinationId,
        ...(role === "sub_coordination_admin" ? { subCoordinationId } : {}), status: "active", active: true });
    }
    for (let index = 0; index < 51; index++) {
      const id = "e2e-payroll-export-" + suffix + "-" + String(index).padStart(2, "0");
      fixturePaths.push("personnelPayments/" + id);
      await db.doc("personnelPayments/" + id).set({ id, schoolId, schoolYearId: schoolId + "__2026-2027", beneficiaryId: "e2e-beneficiary",
        beneficiaryName: "Personnel fictif " + index, beneficiaryJobTitle: "Agent", beneficiaryHasAccount: false,
        kind: index % 2 ? "bonus" : "salary", periodMonth: 9, periodYear: 2026, paidAt: "2026-10-10", currency: index % 2 ? "USD" : "CDF",
        reference: "PAY-LOCAL-" + index, amount: 100, recoveredAmount: 0, recoveries: [], deduction: 0, deductionReason: "", cnss: 0, tax: 0,
        netPaid: 100, description: "", expenseId: "unused", createdAt: "2026-10-10T10:00:00.000Z", createdBy: "fixture" });
    }
    const foreignId = "e2e-payroll-export-foreign-" + suffix;
    fixturePaths.push("personnelPayments/" + foreignId);
    await db.doc("personnelPayments/" + foreignId).set({ id: foreignId, schoolId: foreignSchoolId, kind: "salary", paidAt: "2026-10-10", beneficiaryName: "Hors périmètre", amount: 999, netPaid: 999 });
  });

  test.afterAll(async () => {
    assertLocalOnly();
    for (const path of fixturePaths) await db.doc(path).delete();
    for (const account of Object.values(accounts)) await auth.deleteUser(account.uid);
    await deleteApp(app);
  });

  for (const [role, account] of Object.entries(accounts)) {
    test(role + " : dates, export multi-page et responsive", async ({ browser }: { browser: Browser }) => {
      const context = await browser.newContext({ baseURL: origin, acceptDownloads: true });
      try {
        await context.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseio\.com|firebasestorage\.app)/, (route) => route.abort());
        await context.route("**/api/**", routeFinance);
        const page = await context.newPage();
        await page.goto("/login");
        await page.getByPlaceholder("email@ecole.com").fill(account.email);
        await page.getByPlaceholder("Votre mot de passe").fill(password);
        await page.getByRole("button", { name: "Se connecter" }).click({ noWaitAfter: true });
        await page.waitForURL(/\/coordination/, { timeout: 30_000 });
        await page.getByRole("button", { name: "Contrôle", exact: true }).last().click();
        await page.getByRole("button", { name: "Historique", exact: true }).click();
        const history = page.getByRole("dialog", { name: "Historique du contrôle" });
        await history.getByRole("button", { name: "Salaire/Prime" }).click();
        await history.getByLabel("Date début historique").fill("2026-10-10");
        await history.getByLabel("Date fin historique").fill("2026-10-10");
        await expect(history.getByRole("article").first()).toBeVisible({ timeout: 30_000 });
        await expect(history.getByText("Hors périmètre")).toHaveCount(0);
        const exportButton = history.getByRole("button", { name: "Exporter PDF" });
        for (const width of [1440, 768, 390]) {
          await page.setViewportSize({ width, height: 900 });
          const end = await history.getByLabel("Date fin historique").boundingBox();
          const exportBox = await exportButton.boundingBox();
          expect(end && exportBox && exportBox.x > end.x && Math.abs(exportBox.y - end.y) < 45).toBe(true);
          const line = history.getByRole("article").first();
          const lineBox = await line.boundingBox();
          const pdfBox = await line.getByRole("button", { name: /Télécharger le bulletin PDF/ }).boundingBox();
          expect(lineBox && pdfBox && pdfBox.x > lineBox.x + lineBox.width / 2).toBe(true);
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
        }
        await expect(exportButton).toBeEnabled({ timeout: 30_000 });
        await exportButton.click({ timeout: 30_000 });
        await expect(page.locator("[data-pdf-download]")).toHaveAttribute("aria-disabled", "false", { timeout: 90_000 });
        const [download] = await Promise.all([page.waitForEvent("download"), page.locator("[data-pdf-download]").click()]);
        const bytes = await readFile(await download.path());
        expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
        await writeFile(test.info().outputPath(role + "-historique-salaire-prime.pdf"), bytes);
        await page.locator("[data-pdf-close]").click();
      } finally { await context.close(); }
    });
  }
});
