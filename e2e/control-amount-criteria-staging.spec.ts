import { writeFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { coordinationMissionFixture } from "./support/coordinationMissionFixture";
import { studentForPersistence } from "../src/utils/studentYearTransition.js";

const schoolA = "École E2E Finance Coordination";
const schoolB = "École B Critères";

async function selectCriterion(page: Page, label: string) {
  await page.getByRole("button", { name: "Montant payé", exact: true }).click();
  const menu = page.getByRole("group", { name: "Critères de montant payé" });
  await expect(menu.getByLabel("Filtre")).toHaveCount(0);
  await menu.getByRole("button", { name: label, exact: true }).click();
}

async function checkResponsive(page: Page) {
  await page.getByRole("button", { name: "Montant payé", exact: true }).click();
  const menu = page.getByRole("group", { name: "Critères de montant payé" });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(menu).toBeVisible();
    await expect(page.getByLabel("Filtre", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Exporter PDF", exact: true })).toBeVisible();
    const bounds = await menu.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function savePdf(page: Page, filename: string) {
  await expect(page.locator("[data-pdf-download]")).toHaveAttribute("href", /^blob:/, { timeout: 120000 });
  const bytes = await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch(document.querySelector<HTMLAnchorElement>("[data-pdf-download]")!.href)).arrayBuffer())));
  expect(bytes.length).toBeGreaterThan(1000);
  await writeFile(test.info().outputPath(`${filename}.pdf`), Buffer.from(bytes));
  await page.locator("[data-pdf-close]").click();
}

test("Contrôle — critères financiers séparés et isolés par école sur Staging", async ({ browser, request }) => {
  test.setTimeout(1200000);
  const expectedSha = process.env.E2E_EXPECTED_SHA;
  expect(expectedSha).toMatch(/^[a-f0-9]{40}$/);
  expect((await request.get("/version.json")).ok()).toBe(true);
  expect((await (await request.get("/version.json")).json()).version).toBe(expectedSha);
  const fixture = await coordinationMissionFixture();
  const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
  console.log(JSON.stringify({ fixturePrefix: fixture.prefix, testedSha: expectedSha }));
  const bSchool = `${fixture.prefix}-school-b`, bYear = `${fixture.prefix}-year-b`, bOldYear = `${fixture.prefix}-old-b`;
  try {
    await fixture.seed();
    await fixture.db.doc(`schools/${bSchool}`).set({ id: bSchool, name: schoolB, schoolType: "Mixte", educationLevels: ["Primaire", "CTEB"], currency: "CDF", status: "active", activeSchoolYearId: bYear, activeCoordinationId: fixture.coordinationId, subscriptionStatus: "active", subscriptionPlan: "Premium" });
    await fixture.db.doc(`schoolYears/${bYear}`).set({ id: bYear, schoolId: bSchool, name: "2026-2027", startsAt: "2026-09-01", endsAt: "2027-07-31", status: "active", currency: "CDF" });
    await fixture.db.doc(`schoolYears/${bOldYear}`).set({ id: bOldYear, schoolId: bSchool, name: "2025-2026", startsAt: "2025-09-01", endsAt: "2026-07-31", status: "archived", currency: "CDF" });
    await fixture.db.doc(`coordinationSchools/${fixture.coordinationId}__${bSchool}`).set({ coordinationId: fixture.coordinationId, schoolId: bSchool, active: true });
    await fixture.db.doc(`subCoordinationSchools/${fixture.subCoordinationId}__${bSchool}`).set({ coordinationId: fixture.coordinationId, subCoordinationId: fixture.subCoordinationId, schoolId: bSchool, active: true });
    const bStudent = `${fixture.prefix}-b-student`, bPrevious = `${fixture.prefix}-b-previous`, bZero = `${fixture.prefix}-b-zero`, aZero = `${fixture.prefix}-a-zero`;
    for (const [id, schoolId, schoolYearId, name, importedFromStudentId] of [
      [bPrevious, bSchool, bOldYear, "Critère", ""],
      [bStudent, bSchool, bYear, "Critère", bPrevious],
      [bZero, bSchool, bYear, "Zéro B", ""],
      [aZero, fixture.schoolId, fixture.yearId, "Zéro A", ""],
    ]) await fixture.db.doc(`students/${id}`).set(studentForPersistence({ id, schoolId, schoolYearId, nom: name, prenom: "Test", postnom: "", matricule: id, birthDate: "2013-01-01", sexe: "F", status: "ACTIVE", className: "7ème CTEB", ...(importedFromStudentId ? { importedFromStudentId } : {}) }));
    await fixture.db.doc(`feeTypes/${fixture.prefix}-b-current-fee`).set({ schoolId: bSchool, schoolYearId: bYear, name: "Frais B", amount: 20000, className: "7ème CTEB" });
    await fixture.db.doc(`feeTypes/${fixture.prefix}-b-old-fee`).set({ schoolId: bSchool, schoolYearId: bOldYear, name: "Ancien B", amount: 10000, className: "7ème CTEB" });
    await fixture.db.doc(`payments/${fixture.prefix}-b-current-payment`).set({ schoolId: bSchool, schoolYearId: bYear, studentId: bStudent, feeTypeId: `${fixture.prefix}-b-current-fee`, amount: 1370, paidAt: fixture.today, currency: "CDF" });
    await fixture.db.doc(`payments/${fixture.prefix}-b-old-payment`).set({ schoolId: bSchool, schoolYearId: bOldYear, studentId: bPrevious, feeTypeId: `${fixture.prefix}-b-old-fee`, amount: 1000, paidAt: "2025-10-01", currency: "CDF" });

    for (const role of ["school_admin", "cashier", "coordination_admin", "sub_coordination_admin"]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }); contexts.push(context);
      const page = await context.newPage();
      await fixture.login(page, role);
      await page.getByRole("button", { name: "Contrôle", exact: true }).last().click();
      await expect(page.getByLabel("Filtre", { exact: true })).toBeVisible();
      const rows = () => page.locator("article button");
      const coordinated = role.includes("coordination");
      await selectCriterion(page, coordinated ? `Arriérés — ${schoolA} ≥` : "Arriérés ≥");
      await page.getByLabel("Filtre", { exact: true }).fill("65");
      await expect(rows()).toHaveText("Finance Élève", { timeout: 120000 });
      if (role === "school_admin") await page.getByRole("button", { name: "Exporter PDF", exact: true }).click().then(() => savePdf(page, "admin-arrears-gte"));
      await selectCriterion(page, coordinated ? `Arriérés — ${schoolA} <` : "Arriérés <");
      await page.getByLabel("Filtre", { exact: true }).fill("1");
      await expect(rows()).toHaveText("Zéro A Test", { timeout: 120000 });
      if (role === "school_admin") await page.getByRole("button", { name: "Exporter PDF", exact: true }).click().then(() => savePdf(page, "admin-arrears-lt"));
      await checkResponsive(page);
      if (coordinated) {
        await selectCriterion(page, `Arriérés — ${schoolB} ≥`);
        await page.getByLabel("Filtre", { exact: true }).fill("9000");
        await expect(rows()).toHaveText("Critère Test", { timeout: 120000 });
        await selectCriterion(page, `Arriérés — ${schoolB} <`);
        await page.getByLabel("Filtre", { exact: true }).fill("1");
        await expect(rows()).toHaveText("Zéro B Test", { timeout: 120000 });
        await selectCriterion(page, `Tous les frais — ${schoolA} ≥`);
        await page.getByLabel("Filtre", { exact: true }).fill("25");
        await expect(rows()).toHaveText("Finance Élève", { timeout: 120000 });
        await selectCriterion(page, `Tous les frais — ${schoolB} ≥`);
        await page.getByLabel("Filtre", { exact: true }).fill("1370");
        await expect(rows()).toHaveText("Critère Test", { timeout: 120000 });
        if (role === "coordination_admin") await page.getByRole("button", { name: "Exporter PDF", exact: true }).click().then(() => savePdf(page, "coord-all-fees-b"));
        await selectCriterion(page, `Frais B — ${schoolB} ≥`);
        await expect(rows()).toHaveText("Critère Test", { timeout: 120000 });
        await selectCriterion(page, `Minerval — ${schoolA} ≥`);
        await page.getByLabel("Filtre", { exact: true }).fill("25");
        await expect(rows()).toHaveText("Finance Élève", { timeout: 120000 });
        const schoolScope = page.getByLabel("Filtrer par école", { exact: true });
        await schoolScope.selectOption(bSchool);
        await page.getByRole("button", { name: "Montant payé", exact: true }).click();
        await expect(page.getByRole("group", { name: "Critères de montant payé" }).getByRole("button", { name: new RegExp(schoolA) })).toHaveCount(0);
        await page.keyboard.press("Escape");
        await schoolScope.selectOption("");
      }
      await page.getByRole("button", { name: "Réinitialiser", exact: true }).click();
      await page.getByLabel("Rechercher un élève dans le contrôle").fill("Finance");
      await expect(rows()).toHaveText("Finance Élève", { timeout: 120000 });
      console.log(JSON.stringify({ criterionRole: role, result: "PASS" }));
      await context.close();
    }
  } finally {
    for (const context of contexts) await context.close();
    await fixture.cleanup();
  }
});
