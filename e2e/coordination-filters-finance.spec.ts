import { expect, test, type Page } from "@playwright/test";
import { formatCurrencyMoney } from "../src/utils/currency";
import { coordinationMissionFixture } from "./support/coordinationMissionFixture";

async function choices(page: Page, label: string) {
  return page.getByLabel(label, { exact: true }).locator("option").allTextContents();
}

async function responsive(page: Page, title: string) {
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const header = await page.locator("main > header").boundingBox();
    const inner = await page.locator("main > header > div").first().boundingBox();
    const content = await page.locator("main > section").boundingBox();
    expect(header && inner && content).toBeTruthy();
    expect(header!.x).toBeLessThanOrEqual(1);
    expect(header!.width).toBeGreaterThanOrEqual(width - 1);
    expect(inner!.x).toBeGreaterThanOrEqual(content!.x - 1);
    expect(inner!.x).toBeLessThanOrEqual(content!.x + 17);
    expect(inner!.x + inner!.width).toBeLessThanOrEqual(content!.x + content!.width + 1);
    expect(await page.getByLabel("Filtrer par école", { exact: true }).isVisible()).toBe(true);
    expect(await page.getByLabel("Année scolaire", { exact: true }).isVisible()).toBe(true);
    const school = await page.getByLabel("Filtrer par école", { exact: true }).boundingBox();
    const year = await page.getByLabel("Année scolaire", { exact: true }).boundingBox();
    expect(school && year).toBeTruthy();
    expect(Math.abs(school!.y - year!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(school!.width - year!.width)).toBeLessThanOrEqual(2);
    const heading = await page.getByRole("heading", { name: title, exact: true }).boundingBox();
    expect(heading).not.toBeNull();
    expect(school!.y + school!.height).toBeLessThan(heading!.y);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

test("Coordination et sous-coordination : filtres, finance et responsive sur le SHA servi", async ({ browser, request }) => {
  test.setTimeout(1_200_000);
  const expectedSha = process.env.E2E_EXPECTED_SHA;
  expect(expectedSha).toMatch(/^[a-f0-9]{40}$/);
  const version = await request.get("/version.json");
  expect(version.status()).toBe(200);
  expect(await version.text()).toContain(expectedSha!);
  const fixture = await coordinationMissionFixture();
  const contexts = [];
  console.log(JSON.stringify({ fixturePrefix: fixture.prefix }));
  try {
    await fixture.seed();
    const years = await fixture.seedFilterDiscriminants();
    for (const role of ["coordination_admin", "sub_coordination_admin"]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      contexts.push(context);
      const page = await context.newPage();
      await fixture.login(page, role);
      for (const tab of ["Contrôle", "Élèves"]) {
        await page.getByRole("button", { name: tab, exact: true }).last().click();
        const school = page.getByLabel("Filtrer par école", { exact: true });
        const year = page.getByLabel("Année scolaire", { exact: true });
        const classSelect = page.getByLabel("Classe", { exact: true });
        const option = page.getByLabel("Option", { exact: true });
        await expect(school).toBeVisible({ timeout: 60_000 });
        await expect(classSelect.locator("option")).toContainText(["Toutes", "1ère Humanité"], { timeout: 60_000 });
        await responsive(page, tab);
        expect((await choices(page, "Filtrer par école")).join(" ")).not.toContain("Hors Périmètre");
        if (tab === "Contrôle") {
          await expect(page.getByLabel("Rechercher un élève dans le contrôle")).toHaveCount(0);
        } else {
          await expect(page.getByPlaceholder("Rechercher", { exact: true })).toBeVisible();
        }
        await school.selectOption(fixture.schoolId);
        await expect.poll(async () => (await choices(page, "Classe")).join(" ")).toContain("1ère Humanité");
        await expect.poll(async () => (await choices(page, "Classe")).join(" ")).not.toContain("2ème Humanité");
        await expect.poll(async () => (await choices(page, "Année scolaire")).join(" ")).not.toContain("École E2E Littéraire");
        await expect.poll(async () => (await choices(page, "Option")).join(" ")).toContain("Sciences");
        await expect.poll(async () => (await choices(page, "Option")).join(" ")).not.toContain("Littéraire");

        await classSelect.selectOption(`${fixture.schoolId}::7ème CTEB`);
        const pagination = page.getByRole("navigation", { name: tab === "Contrôle" ? "Pagination du contrôle" : "Pagination des élèves" });
        await expect(pagination.getByRole("button", { name: "Suivante" })).toBeEnabled({ timeout: 90_000 });
        await pagination.getByRole("button", { name: "Suivante" }).click();
        await expect(pagination).toContainText("Page 2", { timeout: 60_000 });
        await classSelect.selectOption(`${fixture.schoolId}::1ère Humanité`);
        await expect(pagination).toContainText("Page 1", { timeout: 60_000 });
        await expect.poll(async () => (await choices(page, "Option")).join(" ")).toContain("Sciences");
        await option.selectOption("Sciences");
        await school.selectOption(fixture.secondSchoolId);
        await expect(classSelect).toHaveValue("");
        await expect(option).toHaveValue("");
        await expect.poll(async () => (await choices(page, "Classe")).join(" ")).toContain("2ème Humanité");
        await expect.poll(async () => (await choices(page, "Classe")).join(" ")).not.toContain("1ère Humanité");
        await expect.poll(async () => (await choices(page, "Option")).join(" ")).not.toContain("Sciences");
        await classSelect.selectOption(`${fixture.secondSchoolId}::2ème Humanité`);
        await expect.poll(async () => (await choices(page, "Option")).join(" ")).toContain("Littéraire");
        await option.selectOption("Littéraire");
        await year.selectOption(years.secondOldYearId);
        await expect(classSelect).toHaveValue("");
        await expect(option).toHaveValue("");
        await expect.poll(async () => (await choices(page, "Classe")).join(" ")).not.toContain("2ème Humanité");
        await expect.poll(async () => (await choices(page, "Option")).join(" ")).not.toContain("Littéraire");

        await school.selectOption(fixture.schoolId);
        await year.selectOption(fixture.yearId);
        await classSelect.selectOption(`${fixture.schoolId}::7ème CTEB`);
        if (tab === "Contrôle") {
          await page.getByRole("button", { name: "Finance Élève", exact: true }).first().click();
          const summary = page.getByLabel("Résumé financier");
          await expect(summary).toBeVisible({ timeout: 60_000 });
          await expect(summary).toContainText(formatCurrencyMoney(200, "USD"));
          await expect(summary).toContainText(formatCurrencyMoney(25, "USD"));
          await expect(summary).toContainText(formatCurrencyMoney(175, "USD"));
          const summaryBox = await summary.boundingBox();
          const arrearsBox = await page.getByRole("heading", { name: "Dettes des années antérieures" }).boundingBox();
          const detailsBox = await page.getByRole("heading", { name: "Informations générales" }).boundingBox();
          expect(summaryBox && arrearsBox && detailsBox).toBeTruthy();
          expect(summaryBox!.y + summaryBox!.height).toBeLessThan(arrearsBox!.y);
          expect(arrearsBox!.y).toBeLessThan(detailsBox!.y);
          await expect(page.getByRole("button", { name: "Imprimer PDF" })).toBeVisible();
          for (const width of [1440, 768, 390]) {
            await page.setViewportSize({ width, height: 900 });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
            const cards = await summary.locator(":scope > div").all();
            expect(cards).toHaveLength(3);
            const boxes = await Promise.all(cards.map((card) => card.boundingBox()));
            expect(boxes.every(Boolean)).toBe(true);
            expect(Math.max(...boxes.map((box) => box!.y)) - Math.min(...boxes.map((box) => box!.y))).toBeLessThanOrEqual(1);
          }
          await page.setViewportSize({ width: 1440, height: 900 });
          await page.getByRole("button", { name: "Retour au contrôle" }).click();
        } else {
          await page.getByRole("row").filter({ hasText: "7ème CTEB" }).getByRole("button", { name: /Finance.*E2E.*Élève/ }).first().click();
          await expect(page.getByRole("heading", { name: "Dettes des années antérieures" })).toHaveCount(0);
          await expect(page.getByRole("button", { name: "Imprimer PDF" })).toHaveCount(0);
          for (const width of [1440, 768, 390]) {
            await page.setViewportSize({ width, height: 900 });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
          }
          await page.setViewportSize({ width: 1440, height: 900 });
        }
        console.log(JSON.stringify({ role, tab, result: "PASS", widths: [1440, 768, 390] }));
      }
    }
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
