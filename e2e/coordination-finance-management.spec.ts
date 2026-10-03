import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { coordinationMissionFixture } from "./support/coordinationMissionFixture";
import { formatCurrencyMoney } from "../src/utils/currency";

async function responsive(page: Page, name: string) {
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const drawer = page.getByRole("dialog");
    if (await drawer.count()) expect(await drawer.last().evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`${name}-${width}.png`), fullPage: true });
    console.log(JSON.stringify({ responsive: name, width, result: "PASS" }));
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

test("Coordination finances et gestion Super Admin — validation finale Staging", async ({ browser, request }, testInfo) => {
  test.setTimeout(1800000);
  const expectedSha = process.env.E2E_EXPECTED_SHA;
  expect(expectedSha).toMatch(/^[a-f0-9]{40}$/);
  expect(await (await request.get("/version.json")).text()).toContain(expectedSha!);
  const fixture = await coordinationMissionFixture();
  console.log(JSON.stringify({ fixturePrefix: fixture.prefix, project: "acadea-staging" }));
  const contexts: BrowserContext[] = [];
  const api = (token: string, data: Record<string, unknown>, endpoint = "manage-coordination") => request.post(`/api/${endpoint}`, { headers: { Authorization: `Bearer ${token}` }, data });
  try {
    await fixture.seed();
    const canonicalResponse = await api(await fixture.token("cashier"), { action: "list-arrears", studentId: fixture.studentId, schoolYearId: fixture.yearId }, "manage-financial-transaction");
    expect(canonicalResponse.status()).toBe(200);
    const canonical = await canonicalResponse.json();
    expect(canonical.debts).toHaveLength(2); expect(canonical.settled).toHaveLength(1);
    for (const role of ["coordination_admin", "sub_coordination_admin", "school_admin", "cashier"]) {
      await test.step(`Arriérés et dates ${role}`, async () => {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }); contexts.push(context);
        const page = await context.newPage();
        const pageFailures: string[] = [];
        page.on("pageerror", (error) => pageFailures.push(error.name));
        page.on("response", (response) => { if (response.status() >= 400) pageFailures.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`); });
        await fixture.login(page, role);
        const title = role.includes("coordination") ? "Arriérés encaissés, hors recouvrement de l'année courante" : "Arriérés encaissés";
        const arrearsCard = page.getByText(title, { exact: role.includes("coordination") }).first().locator("..");
        await expect(arrearsCard).toContainText(formatCurrencyMoney(35, "USD"), { timeout: 60000 });
        const currentFees = page.getByText("Frais de l'année encaissés", { exact: true }).locator("..");
        await expect(currentFees).toContainText(formatCurrencyMoney(25, "USD"));
        const start = page.getByLabel("Date de début", { exact: true });
        await start.fill(fixture.yesterdayKey); await start.fill(fixture.today);
        await expect(arrearsCard).toContainText(formatCurrencyMoney(25, "USD"));
        await expect(arrearsCard).toContainText(formatCurrencyMoney(1000, "CDF"));
        await start.fill(fixture.yesterdayKey);
        await expect(arrearsCard).toContainText(formatCurrencyMoney(35, "USD"));
        await page.getByLabel("Date de fin", { exact: true }).fill(fixture.yesterdayKey);
        await expect(arrearsCard).toContainText(formatCurrencyMoney(10, "USD"));
        await expect(arrearsCard).not.toContainText(formatCurrencyMoney(1000, "CDF"));
        await expect(currentFees).toContainText(formatCurrencyMoney(0, "USD"));
        await page.getByLabel("Date de fin", { exact: true }).fill(fixture.today);
        await expect(arrearsCard).toContainText(formatCurrencyMoney(35, "USD"));
        await expect(currentFees).toContainText(formatCurrencyMoney(25, "USD"));
        await responsive(page, `${role}-dashboard`);
        if (role.includes("coordination")) {
          const token = await fixture.token(role);
          const result = await api(token, { action: "read-student-arrears", studentId: fixture.studentId });
          expect(result.status()).toBe(200); expect(await result.json()).toEqual(canonical);
          expect((await api(token, { action: "read-student-arrears", studentId: `${fixture.prefix}-foreign-student` })).status()).toBe(404);
          expect((await api(token, { action: "create-coordinator", coordinationId: fixture.coordinationId })).status()).toBe(403);
          await page.getByRole("button", { name: "Contrôle", exact: true }).last().click();
          await page.locator("article").filter({ hasText: "7ème CTEB" }).getByRole("button", { name: "Finance Élève", exact: true }).click({ timeout: 30000 });
          await expect(page.getByText("Dettes des années antérieures", { exact: true })).toBeVisible({ timeout: 60000 });
          const debts = page.locator("section").filter({ has: page.getByRole("heading", { name: "Dettes des années antérieures" }) });
          await expect(debts).toContainText("2024-2025"); await expect(debts).toContainText("2025-2026");
          await expect(debts).toContainText(formatCurrencyMoney(65, "USD")); await expect(debts).toContainText(formatCurrencyMoney(9000, "CDF")); await expect(debts).toContainText("Soldée");
          await responsive(page, `${role}-fiche`);
          const popupPromise = page.waitForEvent("popup");
          await page.getByRole("button", { name: "Imprimer PDF", exact: true }).click();
          const popup = await popupPromise;
          await expect(popup.locator("iframe[data-pdf-frame]")).toHaveAttribute("src", /^blob:/, { timeout: 120000 });
          const bytes = await popup.evaluate(async () => Array.from(new Uint8Array(await (await fetch(document.querySelector<HTMLIFrameElement>("iframe[data-pdf-frame]")!.src)).arrayBuffer())));
          await writeFile(testInfo.outputPath(`${role}-arrears.pdf`), Buffer.from(bytes));
          expect(bytes.length).toBeGreaterThan(1000); await popup.close();
          await page.reload(); await expect(page.getByRole("button", { name: "Dashboard", exact: true }).last()).toBeVisible({ timeout: 60000 });
        }
        expect(pageFailures).toEqual([]);
        await context.close(); console.log(JSON.stringify({ scenario: role, result: "PASS" }));
      });
    }
    await test.step("Gestion Coordination et Coordinateurs", async () => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }); contexts.push(context);
      const page = await context.newPage();
      const timings: { category: string; ms: number }[] = [];
      page.on("requestfinished", (req) => {
        const url = new URL(req.url()), timing = req.timing();
        const category = url.hostname === "identitytoolkit.googleapis.com" ? "Firebase Auth" : url.hostname === "firestore.googleapis.com" ? "Firestore" : url.pathname.startsWith("/api/") ? "API" : url.pathname.endsWith(".js") ? "JavaScript" : "autre";
        if (timing.responseEnd >= 0) timings.push({ category, ms: Math.round(timing.responseEnd) });
      });
      const t0 = Date.now(); await fixture.login(page, "super_admin");
      console.log(JSON.stringify({ afterSuperAdminLoginMs: Date.now() - t0 }));
      const schoolTimes: number[] = [];
      for (let n = 0; n < 3; n++) { const t = Date.now(); await page.getByRole("button", { name: "Écoles", exact: true }).last().click(); await expect(page.getByText("École E2E Finance Coordination", { exact: true }).first()).toBeVisible(); schoolTimes.push(Date.now() - t); await page.getByRole("button", { name: "Dashboard", exact: true }).last().click(); }
      console.log(JSON.stringify({ afterSchoolNavigationMs: schoolTimes }));
      console.log(JSON.stringify({ browserRequests: timings }));
      await page.getByRole("button", { name: "Écoles", exact: true }).last().click();
      const detailStart = Date.now();
      await page.getByText("École E2E Finance Coordination", { exact: true }).first().click();
      await page.getByRole("button", { name: "Informations", exact: true }).click();
      await expect(page.getByText("Chargement des données de cette école...", { exact: true })).toHaveCount(0, { timeout: 60000 });
      console.log(JSON.stringify({ schoolDetailMs: Date.now() - detailStart }));
      await responsive(page, "school-information");
      await page.getByRole("button", { name: "Fermer les informations de l'école", exact: true }).click();
      let refusedCounts = 0;
      await page.route(/firestore\.googleapis\.com.*runAggregationQuery/i, async (route) => { refusedCounts++; await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: 403, status: "PERMISSION_DENIED", message: "Erreur compteur E2E contrôlée" } }) }); });
      await page.reload();
      await page.getByRole("button", { name: "Écoles", exact: true }).last().click({ timeout: 60000 });
      await expect(page.getByText("École E2E Finance Coordination", { exact: true }).first()).toBeVisible();
      expect(refusedCounts).toBeGreaterThan(0);
      await page.unroute(/firestore\.googleapis\.com.*runAggregationQuery/i);
      await page.getByText("École E2E Finance Coordination", { exact: true }).first().click();
      await page.getByRole("button", { name: "Informations", exact: true }).click();
      await expect(page.getByText("Chargement des données de cette école...", { exact: true })).toHaveCount(0, { timeout: 60000 });
      await page.getByRole("button", { name: "Fermer les informations de l'école", exact: true }).click();
      console.log(JSON.stringify({ schoolsSurviveCounterError: "PASS", refusedCounts }));
      await page.getByRole("button", { name: "Coordinations", exact: true }).last().click();
      await page.getByRole("button", { name: /Coordination E2E Finance/ }).click();
      const management = page.getByRole("region", { name: "Gestion de la Coordination" });
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 900 });
        const edit = await management.getByRole("button", { name: "Modifier", exact: true }).boundingBox();
        const users = await management.getByRole("button", { name: "Coordinateurs", exact: true }).boundingBox();
        expect(Math.abs(edit!.width - users!.width)).toBeLessThan(1);
      }
      await responsive(page, "coordination-management");
      await management.getByRole("button", { name: "Modifier", exact: true }).click();
      await management.getByLabel("Nom", { exact: true }).fill("Coordination E2E Modifiée");
      await responsive(page, "coordination-edit-form");
      await management.getByRole("button", { name: "Enregistrer la Coordination" }).click();
      await expect(management.getByRole("status")).toHaveText("Coordination modifiée.");
      expect((await fixture.db.doc(`coordinations/${fixture.coordinationId}`).get()).data()?.name).toBe("Coordination E2E Modifiée");
      await page.reload(); await page.getByRole("button", { name: "Coordinations", exact: true }).last().click({ timeout: 60000 });
      await page.getByRole("button", { name: /Coordination E2E Modifiée/ }).click();
      await management.getByRole("button", { name: "Coordinateurs", exact: true }).click();
      const identities = ["A", "B"].map((suffix) => ({ name: `Coordinateur E2E ${suffix}`, email: `${fixture.prefix}-${suffix.toLowerCase()}@example.test`, password: `E2e!${randomBytes(18).toString("hex")}` }));
      for (const identity of identities) {
        await management.getByRole("button", { name: "Ajouter coordinateur", exact: true }).click();
        if (identity === identities[0]) await responsive(page, "coordinator-create-form");
        await management.getByLabel("Nom Coordinateur", { exact: true }).fill(identity.name);
        await management.getByLabel("E-mail Coordinateur", { exact: true }).fill(identity.email);
        await management.getByLabel("Mot de passe temporaire", { exact: true }).evaluate((input, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }, identity.password);
        await management.getByRole("button", { name: "Enregistrer", exact: true }).dblclick();
        await expect(management.getByRole("article", { name: `Coordinateur ${identity.name}`, exact: true })).toBeVisible({ timeout: 60000 });
      }
      expect((await fixture.db.collection("users").where("coordinationId", "==", fixture.coordinationId).where("role", "==", "coordination_admin").get()).size).toBe(3);
      const oldToken = await fixture.signIn(identities[0]);
      const secondContext = await browser.newContext(); contexts.push(secondContext);
      const secondPage = await secondContext.newPage();
      await fixture.login(secondPage, "coordination_admin", identities[0]);
      await expect(secondPage.getByLabel("Filtrer par école").first()).toContainText("École E2E Finance Coordination");
      await expect(secondPage.getByLabel("Filtrer par école").first()).not.toContainText("École E2E Hors Périmètre");
      await responsive(page, "coordinators-three");
      const first = management.getByRole("article", { name: "Coordinateur Coordinateur E2E A", exact: true });
      await first.getByRole("button", { name: "Modifier", exact: true }).click();
      await management.getByLabel("Nom Coordinateur", { exact: true }).fill("Coordinateur E2E A modifié");
      await management.getByRole("button", { name: "Enregistrer", exact: true }).click();
      const edited = management.getByRole("article", { name: "Coordinateur Coordinateur E2E A modifié", exact: true });
      await expect(edited).toBeVisible();
      await edited.getByRole("button", { name: "Suspendre", exact: true }).click();
      await expect(edited).toContainText("Suspendu");
      const userA = await fixture.auth.getUserByEmail(identities[0].email), userB = await fixture.auth.getUserByEmail(identities[1].email);
      expect(userA.disabled).toBe(true); expect(userB.disabled).toBe(false);
      expect((await fixture.db.doc(`users/${userA.uid}`).get()).data()?.active).toBe(false);
      expect([401, 403]).toContain((await api(oldToken, { action: "read-student-arrears", studentId: fixture.studentId })).status());
      await expect(fixture.signIn(identities[0])).rejects.toThrow("Authentification fixture: HTTP 400");
      const deniedRead = await request.get(`https://firestore.googleapis.com/v1/projects/acadea-staging/databases/(default)/documents/schools/${fixture.schoolId}`, { headers: { Authorization: `Bearer ${oldToken}` } });
      expect([401, 403]).toContain(deniedRead.status());
      await secondContext.close();
      await edited.getByRole("button", { name: "Réactiver", exact: true }).click(); await expect(edited).toContainText("Actif");
      await edited.getByRole("button", { name: "Supprimer", exact: true }).click();
      await management.getByLabel("Tapez SUPPRIMER CE COORDINATEUR").fill("NON");
      await expect(management.getByRole("button", { name: "Confirmer la suppression" })).toBeDisabled();
      await management.getByLabel("Tapez SUPPRIMER CE COORDINATEUR").fill("SUPPRIMER CE COORDINATEUR");
      await management.getByRole("button", { name: "Confirmer la suppression" }).click();
      await expect(edited).toHaveCount(0);
      expect((await fixture.auth.getUser(userB.uid)).disabled).toBe(false);
      expect((await fixture.db.doc(`coordinations/${fixture.coordinationId}`).get()).exists).toBe(true);
      expect((await fixture.db.doc(`schools/${fixture.schoolId}`).get()).exists).toBe(true);
      await page.getByRole("button", { name: "Retirer de la Coordination", exact: true }).click();
      const confirmation = page.getByRole("alertdialog", { name: "Confirmation de périmètre" });
      await confirmation.getByLabel("Texte de confirmation").fill("NON"); await expect(confirmation.getByRole("button", { name: "Confirmer", exact: true })).toBeDisabled();
      await confirmation.getByLabel("Texte de confirmation").fill("RETIRER CETTE ECOLE"); await confirmation.getByRole("button", { name: "Confirmer", exact: true }).click();
      await expect.poll(async () => (await fixture.db.doc(`coordinationSchools/${fixture.coordinationId}__${fixture.schoolId}`).get()).data()?.active).toBe(false);
      expect((await fixture.db.doc(`schools/${fixture.schoolId}`).get()).data()?.activeCoordinationId).toBeNull();
      expect((await fixture.db.doc(`students/${fixture.studentId}`).get()).exists).toBe(true);
      await expect(page.getByRole("button", { name: "Retirer de la Coordination", exact: true })).toHaveCount(0);
      await page.reload();
      await page.getByRole("button", { name: "Coordinations", exact: true }).last().click({ timeout: 60000 });
      await page.getByRole("button", { name: /Coordination E2E Modifiée/ }).click();
      await expect(page.getByRole("button", { name: "Retirer de la Coordination", exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Fermer la fiche Coordination", exact: true }).click();
      await page.getByRole("button", { name: "Menu", exact: true }).last().click();
      await page.getByRole("button", { name: "Déconnexion", exact: true }).click();
      await fixture.login(page, "super_admin");
      await page.getByRole("button", { name: "Coordinations", exact: true }).last().click();
      await page.getByRole("button", { name: /Coordination E2E Modifiée/ }).click();
      await expect(page.getByRole("button", { name: "Retirer de la Coordination", exact: true })).toHaveCount(0);
      await management.getByRole("button", { name: "Coordinateurs", exact: true }).click();
      await expect(management.getByRole("article", { name: "Coordinateur Coordinateur E2E B", exact: true })).toBeVisible();
      await expect(management.getByRole("article", { name: "Coordinateur Coordinateur E2E A modifié", exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "École E2E Finance Coordination", exact: true }).click();
      await confirmation.getByLabel("Texte de confirmation").fill("AJOUTER CETTE ECOLE"); await confirmation.getByRole("button", { name: "Confirmer", exact: true }).click();
      await expect.poll(async () => (await fixture.db.doc(`coordinationSchools/${fixture.coordinationId}__${fixture.schoolId}`).get()).data()?.active).toBe(true);
      await context.close();
    });
    await test.step("École suspendue — texte et déconnexion", async () => {
      await fixture.db.doc(`schools/${fixture.schoolId}`).update({ status: "suspended" });
      const context = await browser.newContext(); contexts.push(context); const page = await context.newPage();
      const account = fixture.accounts.find((row) => row.role === "school_admin")!;
      await page.goto("https://acadea-staging.vercel.app/login"); await page.getByPlaceholder("email@ecole.com").fill(account.email);
      await page.getByPlaceholder("Votre mot de passe").evaluate((input, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }, account.password);
      await page.getByRole("button", { name: "Se connecter", exact: true }).click();
      await expect(page.getByRole("heading", { name: "CETTE ÉCOLE A ÉTÉ SUSPENDUE, VEUILLEZ CONTACTER L'ÉQUIPE ACADÉA. MERCI", exact: true })).toBeVisible({ timeout: 60000 });
      await page.getByRole("button", { name: "Déconnexion", exact: true }).click();
      await expect(page.getByRole("button", { name: "Se connecter", exact: true })).toBeVisible(); await context.close();
    });
  } finally {
    for (const context of contexts) {
      for (const page of context.pages()) await page.locator('input[type="password"]').evaluateAll((inputs) => inputs.forEach((input) => { (input as HTMLInputElement).value = ""; })).catch(() => undefined);
      await context.close();
    }
    await fixture.cleanup();
  }
});
