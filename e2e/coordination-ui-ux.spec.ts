import { randomBytes } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { coordinationMissionFixture } from "./support/coordinationMissionFixture";

async function fitsViewport(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const dialog = page.getByRole("dialog");
  if (await dialog.count()) {
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
}

test("UI Coordination et drawers dédiés — Staging isolé", async ({ browser, request }) => {
  test.setTimeout(900000);
  const expectedSha = process.env.E2E_EXPECTED_SHA;
  expect(expectedSha).toMatch(/^[a-f0-9]{40}$/);
  const version = await request.get("/version.json");
  expect(version.status()).toBe(200);
  expect(await version.text()).toContain(expectedSha!);
  const fixture = await coordinationMissionFixture();
  console.log(JSON.stringify({ fixturePrefix: fixture.prefix }));
  const contexts: BrowserContext[] = [];
  try {
    await fixture.seed();
    for (const role of ["coordination_admin", "sub_coordination_admin"]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
      contexts.push(context);
      const page = await context.newPage();
      await fixture.login(page, role);
      await page.getByRole("button", { name: "Contrôle", exact: true }).last().click();
      await expect(page.getByLabel("Filtrer par école", { exact: true })).toBeVisible();
      await expect(page.getByLabel("Année scolaire", { exact: true })).toBeVisible();
      for (const width of [1440, 768, 390]) {
        await fitsViewport(page, width);
        const school = await page.getByLabel("Filtrer par école", { exact: true }).boundingBox();
        const year = await page.getByLabel("Année scolaire", { exact: true }).boundingBox();
        expect(school && year).toBeTruthy();
        expect(Math.abs(school!.y - year!.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(school!.width - year!.width)).toBeLessThanOrEqual(2);
        const header = await page.locator("main > header").boundingBox();
        const headerContent = await page.locator("main > header > div").first().boundingBox();
        const content = await page.locator("main > section").boundingBox();
        expect(header && headerContent && content).toBeTruthy();
        expect(header!.x).toBeLessThanOrEqual(1);
        expect(header!.width).toBeGreaterThanOrEqual(width - 1);
        expect(headerContent!.x).toBeGreaterThanOrEqual(content!.x - 1);
        expect(headerContent!.x).toBeLessThanOrEqual(content!.x + 17);
        expect(headerContent!.x + headerContent!.width).toBeLessThanOrEqual(content!.x + content!.width + 1);
        if (width === 1440) {
          const controls = [
            page.getByLabel("Statut des élèves"),
            page.getByLabel("Option", { exact: true }),
            page.getByLabel("Classe", { exact: true }),
            page.getByRole("button", { name: "Montant payé", exact: true }),
            page.getByLabel("Filtre", { exact: true }),
            page.getByRole("button", { name: "Exporter PDF", exact: true }),
            page.getByRole("button", { name: "Réinitialiser", exact: true }),
            page.getByRole("button", { name: "Historique", exact: true }),
          ];
          const boxes = await Promise.all(controls.map((control) => control.boundingBox()));
          expect(boxes.every(Boolean)).toBe(true);
          expect(Math.max(...boxes.map((box) => box!.y)) - Math.min(...boxes.map((box) => box!.y))).toBeLessThanOrEqual(2);
        }
      }
      await page.getByRole("button", { name: "Historique", exact: true }).tap();
      await expect(page.getByRole("dialog", { name: "Historique du contrôle" })).toBeVisible();
      await page.getByRole("button", { name: "Fermer l’historique" }).tap();
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.locator("article button").filter({ hasText: "Finance Élève" }).first().click();
      await expect(page.getByRole("heading", { name: "Dettes des années antérieures" })).toBeVisible({ timeout: 60000 });
      await expect(page.getByLabel("Résumé financier")).toBeVisible({ timeout: 60000 });
      await expect(page.getByRole("heading", { name: "Historique des paiements", exact: true })).toBeVisible({ timeout: 60000 });
      const headings = await page.locator("h1, h2, h3").allTextContents();
      expect(headings.indexOf("Dettes des années antérieures")).toBeLessThan(headings.indexOf("Informations générales"));
      expect(headings.indexOf("Dettes des années antérieures")).toBeLessThan(headings.indexOf("Historique des paiements"));
      await expect(page.getByRole("button", { name: "Retour au contrôle" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Imprimer PDF" })).toBeVisible();
      for (const width of [1440, 768, 390]) await fitsViewport(page, width);
      await page.getByRole("button", { name: "Retour au contrôle" }).tap();
      await page.getByRole("button", { name: "Élèves", exact: true }).last().click();
      const student = page.getByRole("row").filter({ hasText: "7ème CTEB" }).getByRole("button", { name: /Finance.*E2E.*Élève/ });
      await expect(student).toBeVisible({ timeout: 60000 });
      await student.click();
      await expect(page.getByRole("heading", { name: "Dettes des années antérieures" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Imprimer PDF" })).toHaveCount(0);
      for (const width of [1440, 768, 390]) await fitsViewport(page, width);
      console.log(JSON.stringify({ role, controlAndStudents: "PASS", widths: [1440, 768, 390] }));
    }

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
    contexts.push(context);
    const page = await context.newPage();
    await fixture.login(page, "super_admin");
    await page.getByRole("button", { name: "Coordinations", exact: true }).last().click();
    await page.getByRole("button", { name: /Coordination E2E Finance.*Active/ }).click();
    await expect(page.getByRole("dialog", { name: "Coordination E2E Finance" })).toBeVisible();
    for (const width of [1440, 768, 390]) await fitsViewport(page, width);
    await page.getByRole("button", { name: "Modifier", exact: true }).tap();
    await expect(page.getByRole("dialog", { name: "Modifier la Coordination" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    for (const width of [1440, 768, 390]) await fitsViewport(page, width);
    await page.getByRole("button", { name: "Retour aux informations de la Coordination" }).tap();
    await expect(page.getByRole("dialog", { name: "Coordination E2E Finance" })).toBeVisible();
    await page.getByRole("button", { name: "Modifier", exact: true }).tap();
    await expect(page.getByRole("dialog", { name: "Modifier la Coordination" })).toBeVisible();
    await page.getByRole("textbox", { name: "Nom", exact: true }).fill("Coordination E2E Finance UX");
    await page.getByRole("button", { name: "Enregistrer la Coordination" }).click();
    await expect(page.getByRole("dialog", { name: "Coordination E2E Finance UX" })).toBeVisible({ timeout: 60000 });
    for (const width of [1440, 768, 390]) await fitsViewport(page, width);
    await page.getByRole("button", { name: "Coordinateurs", exact: true }).tap();
    await expect(page.getByRole("dialog", { name: "Coordinateurs" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Ajouter coordinateur" })).toBeVisible();
    await page.getByRole("button", { name: "Ajouter coordinateur" }).tap();
    await expect(page.getByRole("dialog", { name: "Ajouter coordinateur" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(page.getByRole("dialog", { name: "Coordinateurs" })).toHaveCount(0);
    for (const width of [1440, 768, 390]) await fitsViewport(page, width);
    await page.getByRole("form", { name: "Ajouter coordinateur" }).getByRole("button", { name: "Enregistrer" }).click();
    expect(await page.getByRole("textbox", { name: "Nom Coordinateur" }).evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
    await page.getByRole("button", { name: "Retour aux Coordinateurs" }).tap();
    await expect(page.getByRole("dialog", { name: "Coordinateurs" })).toBeVisible();
    await expect(page.getByRole("form", { name: "Ajouter coordinateur" })).toHaveCount(0);
    await page.getByRole("button", { name: "Ajouter coordinateur" }).tap();
    await expect(page.getByRole("textbox", { name: "Nom Coordinateur" })).toHaveValue("");
    const coordinatorEmail = `${fixture.prefix}-extra@example.test`;
    await page.getByRole("textbox", { name: "Nom Coordinateur" }).fill("Coordinateur UX E2E");
    await page.getByRole("textbox", { name: "E-mail Coordinateur" }).fill(coordinatorEmail);
    await page.getByRole("textbox", { name: "Téléphone Coordinateur" }).fill("+243810000000");
    await page.getByLabel("Mot de passe temporaire").fill(`E2e!${randomBytes(18).toString("hex")}`);
    await page.getByRole("form", { name: "Ajouter coordinateur" }).getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByRole("dialog", { name: "Coordinateurs" })).toBeVisible({ timeout: 60000 });
    await expect(page.getByRole("form", { name: "Ajouter coordinateur" })).toHaveCount(0);
    const coordinator = page.getByRole("article", { name: "Coordinateur Coordinateur UX E2E" });
    await expect(coordinator).toContainText(coordinatorEmail, { timeout: 60000 });
    await coordinator.getByRole("button", { name: "Modifier" }).click();
    await page.getByRole("form", { name: "Modifier le Coordinateur" }).getByRole("textbox", { name: "Nom Coordinateur" }).fill("Coordinateur UX Modifié");
    await page.getByRole("form", { name: "Modifier le Coordinateur" }).getByRole("button", { name: "Enregistrer" }).click();
    const updated = page.getByRole("article", { name: "Coordinateur Coordinateur UX Modifié" });
    await expect(updated).toBeVisible({ timeout: 60000 });
    await updated.getByRole("button", { name: "Suspendre" }).click();
    await expect(updated).toContainText("Suspendu", { timeout: 60000 });
    await updated.getByRole("button", { name: "Réactiver" }).click();
    await expect(updated).toContainText("Actif", { timeout: 60000 });
    await updated.getByRole("button", { name: "Supprimer" }).click();
    const confirmation = page.getByRole("alertdialog", { name: "Supprimer le Coordinateur" });
    await confirmation.getByRole("textbox").fill("SUPPRIMER CE COORDINATEUR");
    await confirmation.getByRole("button", { name: "Confirmer la suppression" }).click();
    await expect(updated).toHaveCount(0, { timeout: 60000 });
    for (const width of [1440, 768, 390]) await fitsViewport(page, width);
    await page.getByRole("button", { name: "Retour aux informations de la Coordination" }).tap();
    await expect(page.getByRole("dialog", { name: "Coordination E2E Finance UX" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Coordinations", exact: true }).last()).toBeVisible({ timeout: 60000 });
    await page.getByRole("button", { name: "Coordinations", exact: true }).last().click();
    await page.getByRole("button", { name: /Coordination E2E Finance UX.*Active/ }).click();
    await expect(page.getByRole("dialog", { name: "Coordination E2E Finance UX" })).toBeVisible();
    console.log(JSON.stringify({ role: "super_admin", editAndCoordinatorDrawers: "PASS", widths: [1440, 768, 390] }));
  } finally {
    for (const context of contexts) await context.close();
    await fixture.cleanup();
    const independent = await coordinationMissionFixture(fixture.prefix);
    try {
      const residues = await independent.scanResidues();
      console.log(JSON.stringify({ independentResidueScan: residues }));
      expect(residues).toEqual({ firestore: 0, auth: 0, storage: 0 });
    } finally {
      await independent.close();
    }
  }
});
