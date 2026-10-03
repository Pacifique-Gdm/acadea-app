import { writeFile } from "node:fs/promises";
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { coordinationMissionFixture } from "./support/coordinationMissionFixture";
import { studentForPersistence } from "../src/utils/studentYearTransition.js";
import { formatCurrencyMoney } from "../src/utils/currency";

async function responsive(page: Page, label: string) {
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const drawer = page.getByRole("dialog");
    if (await drawer.count()) expect(await drawer.last().evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    const paidPanel = page.getByRole("group", { name: "Filtres de montant payé" });
    if (await paidPanel.count()) {
      const box = await paidPanel.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(901);
    }
    await page.screenshot({ path: test.info().outputPath(`${label}-${width}.png`) });
    console.log(JSON.stringify({ responsive: label, width, result: "PASS" }));
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}
async function savePdf(page: Page, name: string) {
  await expect(page.locator("[data-pdf-download]")).toHaveAttribute("href", /^blob:/, { timeout: 120000 });
  const bytes = await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch(document.querySelector<HTMLAnchorElement>("[data-pdf-download]")!.href)).arrayBuffer())));
  await writeFile(test.info().outputPath(`${name}.pdf`), Buffer.from(bytes));
  expect(bytes.length).toBeGreaterThan(1000);
  await page.locator("[data-pdf-close]").click();
}

test("Dashboards, Contrôle et retrait Coordination — Staging final", async ({ browser, request }) => {
  test.setTimeout(1800000);
  expect(process.env.E2E_EXPECTED_SHA).toMatch(/^[a-f0-9]{40}$/);
  expect(await (await request.get("/version.json")).text()).toContain(process.env.E2E_EXPECTED_SHA!);
  const fixture = await coordinationMissionFixture();
  const contexts: BrowserContext[] = [];
  console.log(JSON.stringify({ fixturePrefix: fixture.prefix, sha: process.env.E2E_EXPECTED_SHA }));
  const bSchool = `${fixture.prefix}-scope-b`, bYear = `${fixture.prefix}-year-b`;
  try {
    await fixture.seed();
    await fixture.db.doc(`schools/${fixture.schoolId}`).update({ educationLevels: ["Primaire", "CTEB", "Secondaire"], schoolOptions: ["Littéraire", "Pédagogie"] });
    await fixture.db.doc(`schools/${bSchool}`).set({ id: bSchool, name: "École B Finance", schoolType: "Mixte", educationLevels: ["Primaire", "CTEB", "Secondaire"], schoolOptions: ["Pédagogie", "Commerciale"], currency: "CDF", status: "active", activeSchoolYearId: bYear, activeCoordinationId: fixture.coordinationId, subscriptionStatus: "active", subscriptionPlan: "Premium" });
    await fixture.db.doc(`schoolYears/${bYear}`).set({ id: bYear, schoolId: bSchool, name: "2026-2027", startsAt: "2026-09-01", endsAt: "2027-07-31", status: "active", currency: "CDF" });
    await fixture.db.doc(`coordinationSchools/${fixture.coordinationId}__${bSchool}`).set({ coordinationId: fixture.coordinationId, schoolId: bSchool, active: true });
    await fixture.db.doc(`subCoordinationSchools/${fixture.subCoordinationId}__${bSchool}`).set({ coordinationId: fixture.coordinationId, subCoordinationId: fixture.subCoordinationId, schoolId: bSchool, active: true });
    for (let i = 0; i < 60; i++) {
      const id = `${fixture.prefix}-page-${i}`;
      await fixture.db.doc(`students/${id}`).set(studentForPersistence({ id, schoolId: i < 30 ? fixture.schoolId : bSchool, schoolYearId: i < 30 ? fixture.yearId : bYear, nom: `Pagination${String(i).padStart(2, "0")}`, prenom: "Test", postnom: "", matricule: `${fixture.prefix}-P${i}`, birthDate: "2013-01-01", sexe: "F", status: "ACTIVE", className: "7ème CTEB" }));
    }
    const bOldYear = `${fixture.prefix}-old-b`, bOldStudent = `${fixture.prefix}-old-student-b`;
    await fixture.db.doc(`schoolYears/${bOldYear}`).set({ schoolId: bSchool, name: "2025-2026", startsAt: "2025-09-01", endsAt: "2026-07-31", status: "archived", currency: "CDF" });
    await fixture.db.doc(`students/${bOldStudent}`).set(studentForPersistence({ id: bOldStudent, schoolId: bSchool, schoolYearId: bOldYear, nom: "Pagination59", prenom: "Test", postnom: "", matricule: `${fixture.prefix}-P59`, birthDate: "2013-01-01", sexe: "F", status: "ACTIVE", className: "6ème Primaire" }));
    await fixture.db.doc(`students/${fixture.prefix}-page-59`).update({ importedFromStudentId: bOldStudent });
    await fixture.db.doc(`feeTypes/${fixture.prefix}-old-fee-b`).set({ schoolId: bSchool, schoolYearId: bOldYear, name: "Ancien frais B", amount: 9065, className: "6ème Primaire" });
    await fixture.db.doc(`payments/${fixture.prefix}-old-payment-b`).set({ schoolId: bSchool, schoolYearId: bOldYear, studentId: bOldStudent, feeTypeId: `${fixture.prefix}-old-fee-b`, amount: 65, paidAt: "2025-10-01", currency: "CDF" });
    await fixture.db.doc(`feeTypes/${fixture.prefix}-fee-b`).set({ schoolId: bSchool, schoolYearId: bYear, name: "Frais école B", amount: 20000, className: "7ème CTEB" });
    await fixture.db.doc(`payments/${fixture.prefix}-payment-b`).set({ schoolId: bSchool, schoolYearId: bYear, studentId: `${fixture.prefix}-page-30`, feeTypeId: `${fixture.prefix}-fee-b`, amount: 1370, paidAt: fixture.today, currency: "CDF", cashierName: "Test B" });
    for (const [suffix, schoolId, schoolYearId, amount, spentAt] of [["today", fixture.schoolId, fixture.yearId, 7, fixture.today], ["yesterday", fixture.schoolId, fixture.yearId, 3, fixture.yesterdayKey], ["b", bSchool, bYear, 500, fixture.today]] as const) {
      await fixture.db.doc(`expenses/${fixture.prefix}-${suffix}`).set({ schoolId, schoolYearId, amount, spentAt, createdAt: spentAt, category: "Bureau", description: `Dépense fixture ${suffix}`, cashierName: "Test" });
    }
    for (const role of ["school_admin", "cashier", "coordination_admin", "sub_coordination_admin"]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true }); contexts.push(context);
      const page = await context.newPage();
      const failures: string[] = [];
      page.on("pageerror", (error) => failures.push(error.name));
      page.on("response", (response) => { if (response.status() >= 400) failures.push(`${response.status()} ${new URL(response.url()).pathname}`); });
      await fixture.login(page, role);
      const title = role.includes("coordination") ? "Arriérés encaissés, hors recouvrement de l'année courante" : "Arriérés encaissés pendant la période, hors recouvrement des frais de l'année";
      const card = page.getByText(title, { exact: true }).locator("..");
      await expect(card).toContainText(formatCurrencyMoney(25, "USD"), { timeout: 60000 });
      await expect(card).not.toContainText(formatCurrencyMoney(35, "USD"));
      await expect(card).toContainText(formatCurrencyMoney(1000, "CDF"));
      const start = page.getByLabel("Date de début", { exact: true }), end = page.getByLabel("Date de fin", { exact: true });
      await start.fill(fixture.yesterdayKey); await end.fill(fixture.yesterdayKey);
      await expect(card).toContainText(formatCurrencyMoney(10, "USD"));
      await expect(card).not.toContainText(formatCurrencyMoney(1000, "CDF"));
      await end.fill(fixture.today); await expect(card).toContainText(formatCurrencyMoney(35, "USD"));
      await start.fill("2020-01-01"); await end.fill("2020-01-02"); await expect(card).toHaveCount(0);
      await start.fill(fixture.today); await end.fill(fixture.today); await expect(card).toContainText(formatCurrencyMoney(25, "USD"));
      await responsive(page, `${role}-dashboard`);
      await page.reload(); await expect(card).toContainText(formatCurrencyMoney(25, "USD"), { timeout: 60000 });
      await page.getByRole("button", { name: "Contrôle", exact: true }).last().click();
      const debtRows = () => page.locator("article button");
      await expect(page.getByLabel("Devise des arriérés")).toHaveCount(0);
      await expect(page.getByLabel("Arriérés ≥", { exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Montant payé", exact: true }).click();
      await page.getByLabel("Arriérés ≥", { exact: true }).fill("65");
      await page.getByLabel("Arriérés <", { exact: true }).fill("66");
      await expect(debtRows()).toHaveCount(1, { timeout: 120000 });
      await expect(debtRows().filter({ hasText: "Finance" })).toHaveCount(1);
      if (role.includes("coordination")) await expect(page.locator("article button").filter({ hasText: "Pagination59" })).toHaveCount(0);
      await page.getByLabel("Arriérés <", { exact: true }).fill("65");
      await expect(debtRows().filter({ hasText: "Finance" })).toHaveCount(0, { timeout: 120000 });
      if (role.includes("coordination")) {
        await page.getByLabel("Arriérés ≥", { exact: true }).fill("0"); await page.getByLabel("Arriérés <", { exact: true }).fill("1");
        await expect(debtRows()).toHaveCount(50, { timeout: 120000 });
        await page.getByRole("button", { name: "Suivante", exact: true }).click();
        await expect(page.getByRole("navigation", { name: "Pagination du contrôle" })).toContainText("Page 2", { timeout: 120000 });
        expect(await debtRows().count()).toBeGreaterThan(0);
        expect(await debtRows().count()).toBeLessThan(50);
        await page.getByRole("button", { name: "Précédente", exact: true }).click();
        await expect(debtRows()).toHaveCount(50, { timeout: 120000 });
      }
      if (!await page.getByRole("group", { name: "Filtres de montant payé" }).count()) await page.getByRole("button", { name: "Montant payé", exact: true }).click();
      await page.getByLabel("Arriérés ≥", { exact: true }).fill("9000"); await page.getByLabel("Arriérés <", { exact: true }).fill("9001");
      await expect(debtRows().filter({ hasText: "Pagination59" })).toHaveCount(role.includes("coordination") ? 1 : 0, { timeout: 120000 });
      await expect(debtRows().filter({ hasText: "Finance" })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("group", { name: "Filtres de montant payé" })).toHaveCount(0);
      await page.getByRole("button", { name: "Montant payé", exact: true }).click();
      await expect(page.getByLabel("Arriérés ≥", { exact: true })).toHaveValue("9000");
      await responsive(page, `${role}-arrears-filter`);
      await page.getByRole("button", { name: "Réinitialiser", exact: true }).click();
      const batchToken = await fixture.token(role);
      const batchEndpoint = role.includes("coordination") ? "/api/manage-coordination" : "/api/manage-financial-transaction";
      const batchAction = role.includes("coordination") ? "read-student-arrears-batch" : "list-arrears-batch";
      const batchDenied = await request.post(batchEndpoint, { headers: { Authorization: `Bearer ${batchToken}` }, data: { action: batchAction, ...(!role.includes("coordination") ? { schoolYearId: fixture.yearId } : {}), studentIds: [fixture.studentId, `${fixture.prefix}-foreign-student`] } });
      expect(batchDenied.status()).toBe(404);
      console.log(JSON.stringify({ arrearsFilter: role, result: "PASS", partialUSD: 65, partialCDF: 9000, exclusiveUpperBound: true }));
      if (role.includes("coordination")) {
        await page.getByRole("button", { name: "Contrôle", exact: true }).last().click();
        const schoolScope = page.getByLabel("Filtrer par école", { exact: true });
        await schoolScope.selectOption(bSchool);
        await expect(page.getByLabel("Option", { exact: true }).locator("option")).toHaveText(["Toutes les options", "Commerciale", "Pédagogie"]);
        await expect(page.locator("article button")).toHaveCount(30, { timeout: 60000 });
        await page.getByRole("button", { name: "Montant payé", exact: true }).click();
        await page.getByLabel("Arriérés ≥", { exact: true }).fill("9000");
        await page.getByLabel("Arriérés <", { exact: true }).fill("9001");
        await expect(page.locator("article button")).toHaveText("Pagination59 Test", { timeout: 120000 });
        await schoolScope.selectOption(fixture.schoolId);
        await expect(page.getByLabel("Option", { exact: true }).locator("option")).toHaveText(["Toutes les options", "Littéraire", "Pédagogie"]);
        await page.getByLabel("Arriérés ≥", { exact: true }).fill("65");
        await page.getByLabel("Arriérés <", { exact: true }).fill("66");
        await expect(page.locator("article button")).toHaveText("Finance Élève", { timeout: 120000 });
        await page.getByRole("button", { name: "Réinitialiser", exact: true }).click();
        await expect(page.locator("article button")).toHaveCount(31, { timeout: 60000 });
        await schoolScope.selectOption("");
        const controlYear = page.getByLabel("Année scolaire", { exact: true });
        const controlOption = page.getByLabel("Option", { exact: true });
        await expect(controlYear).toHaveValue("active");
        await expect(controlOption.locator("option")).toHaveText(["Toutes les options", "Commerciale", "Littéraire", "Pédagogie"]);
        await controlYear.selectOption(bYear);
        await expect(controlOption.locator("option")).toHaveText(["Toutes les options", "Commerciale", "Pédagogie"]);
        await controlYear.selectOption(fixture.yearId);
        await expect(controlOption.locator("option")).toHaveText(["Toutes les options", "Littéraire", "Pédagogie"]);
        await controlYear.selectOption("active");
        await expect(page.getByRole("navigation", { name: "Pagination du contrôle" })).toContainText("50 élèves", { timeout: 60000 });
        expect((await page.getByRole("navigation", { name: "Pagination du contrôle" }).boundingBox())!.y).toBeGreaterThan((await page.locator("article").last().boundingBox())!.y);
        const names = () => page.locator("article button").allTextContents();
        const first = await names(); expect(first).toHaveLength(50);
        await page.getByRole("button", { name: "Suivante", exact: true }).click();
        await expect(page.getByRole("navigation", { name: "Pagination du contrôle" })).toContainText("11 élèves", { timeout: 60000 });
        const second = await names(); expect(second).toHaveLength(11);
        expect(first.filter((name) => second.includes(name))).toEqual([]);
        await page.getByRole("button", { name: "Précédente", exact: true }).click();
        await expect(page.getByRole("navigation", { name: "Pagination du contrôle" })).toContainText("50 élèves", { timeout: 60000 });
        expect(await names()).toEqual(first);
        await responsive(page, `${role}-pagination`);
        await page.getByLabel("Rechercher un élève dans le contrôle").fill("Pagination59");
        await expect(page.locator("article button")).toHaveCount(1, { timeout: 60000 });
        await expect(page.locator("article button")).toHaveText("Pagination59 Test");
        await page.getByLabel("Rechercher un élève dans le contrôle").fill("");
        await page.getByLabel("Année scolaire", { exact: true }).selectOption(fixture.yearId);
        await expect(page.locator("article button")).toHaveCount(31, { timeout: 60000 });
        await page.getByRole("button", { name: "Réinitialiser", exact: true }).click();
        await expect(page.locator("article button")).toHaveCount(50, { timeout: 60000 });
        for (const tab of ["Contrôle", "Élèves"]) {
          await page.getByRole("button", { name: tab, exact: true }).last().click();
          if (tab === "Élèves") {
            const studentYear = page.getByLabel("Année scolaire", { exact: true });
            await expect(studentYear).toHaveValue("active");
            await expect(page.getByLabel("Option", { exact: true }).locator("option")).toHaveText(["Toutes les options", "Commerciale", "Littéraire", "Pédagogie"]);
            await studentYear.selectOption(bOldYear);
            await expect(page.getByRole("row").filter({ hasText: "Pagination59" })).toHaveCount(1, { timeout: 60000 });
            await studentYear.selectOption("active");
          }
          const target = tab === "Contrôle" ? page.locator("article").filter({ hasText: "7ème CTEB" }).getByRole("button", { name: "Finance Élève", exact: true }) : page.getByRole("row").filter({ hasText: "7ème CTEB" }).getByRole("button", { name: /Finance.*E2E.*Élève/ });
          await expect(target).toBeVisible({ timeout: 60000 });
          const calls: { path: string; action: string; ms: number }[] = [];
          const record = (req: import("@playwright/test").Request) => { const url = new URL(req.url()); if (url.pathname.startsWith("/api/")) calls.push({ path: url.pathname, action: String(req.postDataJSON()?.action ?? ""), ms: Math.round(req.timing().responseEnd) }); };
          page.on("requestfinished", record);
          const t0 = Date.now(); await target.click();
          await expect(page.getByRole("heading", { name: /Finance.*Élève/ }).first()).toBeVisible(); const usefulMs = Date.now() - t0;
          await expect(page.getByText("Chargement des arriérés…", { exact: true })).toHaveCount(0, { timeout: 60000 });
          await expect(page.getByText("Chargement des paiements…", { exact: true })).toHaveCount(0);
          await expect(page.getByText("Chargement du parent…", { exact: true })).toHaveCount(0);
          const debts = page.getByRole("heading", { name: "Dettes des années antérieures" }).locator("..");
          await expect(debts).toContainText(formatCurrencyMoney(65, "USD")); await expect(debts).toContainText(formatCurrencyMoney(9000, "CDF"));
          console.log(JSON.stringify({ performance: { role, tab, usefulMs, completeMs: Date.now() - t0, calls } }));
          page.off("requestfinished", record);
          if (tab === "Contrôle") {
            await expect(page.getByRole("button", { name: "Retour au contrôle", exact: true })).toBeVisible();
            await expect(page.getByRole("button", { name: /Retour à la liste/ })).toHaveCount(0);
            await expect(page.locator("main article img")).toHaveCount(0);
            await page.getByRole("button", { name: "Imprimer PDF", exact: true }).click(); await savePdf(page, `${role}-control`);
          } else await expect(page.getByRole("button", { name: "Imprimer PDF", exact: true })).toHaveCount(0);
          await responsive(page, `${role}-${tab}-detail`);
        }
        await page.getByRole("button", { name: "Contrôle", exact: true }).last().click();
        await page.getByRole("button", { name: "Historique", exact: true }).click();
        const drawer = page.getByRole("dialog", { name: "Historique du contrôle" });
        await expect(drawer.getByLabel("Date début historique")).toHaveValue(fixture.today);
        await expect(drawer.getByLabel("Date fin historique")).toHaveValue(fixture.today);
        await expect(drawer.getByText("Chargement de l’historique…", { exact: true })).toHaveCount(0, { timeout: 60000 });
        await drawer.getByLabel("École de l’historique").selectOption(fixture.schoolId);
        await drawer.getByLabel("Date début historique").fill(fixture.yesterdayKey); await drawer.getByLabel("Date fin historique").fill(fixture.yesterdayKey);
        await expect(drawer.locator("tbody tr")).toHaveCount(1);
        await expect(drawer.locator("tbody")).toContainText(formatCurrencyMoney(10, "USD"));
        await drawer.getByRole("button", { name: "Exporter PDF", exact: true }).click(); await savePdf(page, `${role}-payments-school-a-yesterday`);
        await drawer.getByLabel("Date début historique").fill("2020-01-01"); await drawer.getByLabel("Date fin historique").fill("2020-01-02");
        await expect(drawer.locator("tbody tr")).toHaveCount(0);
        await drawer.getByLabel("École de l’historique").selectOption(bSchool);
        await drawer.getByLabel("Date début historique").fill(fixture.today); await drawer.getByLabel("Date fin historique").fill(fixture.today);
        await expect(drawer.locator("tbody")).toContainText(formatCurrencyMoney(1370, "CDF"));
        await expect(drawer.locator("tbody")).not.toContainText("École E2E Finance Coordination");
        await drawer.getByRole("button", { name: "Exporter PDF", exact: true }).click(); await savePdf(page, `${role}-payments-school-b`);
        await drawer.getByRole("button", { name: "Dépenses", exact: true }).click(); await expect(drawer.locator("tbody")).toContainText(formatCurrencyMoney(500, "CDF"));
        await drawer.getByRole("button", { name: "Exporter PDF", exact: true }).click(); await savePdf(page, `${role}-expenses-school-b`);
        await responsive(page, `${role}-history`);
        await drawer.getByLabel("École de l’historique").selectOption(fixture.schoolId);
        await drawer.getByLabel("Date début historique").fill(fixture.yesterdayKey); await drawer.getByLabel("Date fin historique").fill(fixture.yesterdayKey);
        await expect(drawer.locator("tbody tr")).toHaveCount(1);
        await expect(drawer.locator("tbody")).toContainText(formatCurrencyMoney(3, "USD"));
        await page.getByRole("button", { name: "Fermer l’historique" }).click();
        const token = await fixture.token(role);
        const denied = await request.post("/api/manage-coordination", { headers: { Authorization: `Bearer ${token}` }, data: { action: "read-student-arrears", studentId: `${fixture.prefix}-foreign-student` } });
        expect(denied.status()).toBe(404);
      }
      expect(failures).toEqual([]);
      console.log(JSON.stringify({ scenario: role, result: "PASS" }));
      await context.close();
    }
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true }); contexts.push(context);
    const page = await context.newPage(); await fixture.login(page, "super_admin");
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole("button", { name: "Coordinations", exact: true }).last().click();
      await page.getByRole("button", { name: /Coordination E2E Finance.*Active/ }).click();
      const row = page.getByText("École B Finance", { exact: true }).locator("..").locator("..").locator("..");
      const remove = row.getByRole("button", { name: "Retirer de la Coordination", exact: true });
      if (width === 390) await remove.tap(); else await remove.click();
      const confirmation = page.getByRole("alertdialog", { name: "Confirmation de périmètre" });
      await expect(confirmation).toBeVisible();
      const box = await confirmation.boundingBox(); expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(900);
      await page.screenshot({ path: test.info().outputPath(`remove-confirmation-${width}.png`) });
      await confirmation.getByRole("button", { name: "Annuler", exact: true }).click();
      if (width === 1440) {
        await page.route("**/api/manage-coordination", async (route) => {
          if (route.request().postDataJSON()?.action === "remove-school") await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Refus E2E contrôlé" }) });
          else await route.continue();
        });
        await remove.click(); await confirmation.getByLabel("Texte de confirmation").fill("RETIRER CETTE ECOLE");
        await confirmation.getByRole("button", { name: "Confirmer", exact: true }).click();
        await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Refus E2E contrôlé");
        expect((await fixture.db.doc(`coordinationSchools/${fixture.coordinationId}__${bSchool}`).get()).data()?.active).toBe(true);
        await page.unroute("**/api/manage-coordination");
        await confirmation.getByRole("button", { name: "Annuler", exact: true }).click();
      }
      await remove.click(); await confirmation.getByLabel("Texte de confirmation").fill("RETIRER CETTE ECOLE");
      await confirmation.getByRole("button", { name: "Confirmer", exact: true }).click();
      await expect(confirmation).toHaveCount(0, { timeout: 30000 });
      expect((await fixture.db.doc(`schools/${bSchool}`).get()).exists).toBe(true);
      expect((await fixture.db.doc(`schools/${bSchool}`).get()).data()?.activeCoordinationId).toBeNull();
      expect((await fixture.db.doc(`coordinationSchools/${fixture.coordinationId}__${bSchool}`).get()).data()?.active).toBe(false);
      await page.getByRole("button", { name: "École B Finance", exact: true }).click();
      await confirmation.getByLabel("Texte de confirmation").fill("AJOUTER CETTE ECOLE"); await confirmation.getByRole("button", { name: "Confirmer", exact: true }).click();
      await expect(confirmation).toHaveCount(0, { timeout: 30000 });
      await page.reload();
      await page.getByRole("button", { name: "Menu", exact: true }).last().click();
      await page.getByRole("button", { name: "Déconnexion", exact: true }).click();
      await expect(page.getByRole("button", { name: "Se connecter", exact: true })).toBeVisible();
      await fixture.login(page, "super_admin");
      console.log(JSON.stringify({ removeSchool: width, result: "PASS" }));
    }
  } finally {
    for (const context of contexts) await context.close();
    await fixture.cleanup();
  }
});
