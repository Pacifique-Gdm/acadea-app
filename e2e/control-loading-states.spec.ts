import { expect, test, type BrowserContext } from "@playwright/test";
import { coordinationMissionFixture } from "./support/coordinationMissionFixture";

test("Contrôle : recherche réelle et export PDF exclusif dans les quatre rôles", async ({ browser, request }) => {
  test.setTimeout(1_200_000);
  const expectedSha = process.env.E2E_EXPECTED_SHA;
  expect(expectedSha).toMatch(/^[a-f0-9]{40}$/);
  expect((await (await request.get("/version.json")).json()).version).toBe(expectedSha);
  const fixture = await coordinationMissionFixture();
  const contexts: BrowserContext[] = [];
  try {
    await fixture.seed();
    for (const role of ["school_admin", "cashier", "coordination_admin", "sub_coordination_admin"]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      contexts.push(context);
      const page = await context.newPage();
      await fixture.login(page, role);
      await page.getByRole("button", { name: "Contrôle", exact: true }).last().click();
      await expect(page.getByLabel("Filtre", { exact: true })).toBeVisible();
      const endpoint = role.includes("coordination") ? "**/api/manage-coordination" : "**/api/manage-financial-transaction";
      let arrearsRequests = 0;
      await page.route(endpoint, async (route) => {
        const action = route.request().postDataJSON()?.action;
        if (action === "read-student-arrears-batch" || action === "list-arrears-batch") {
          arrearsRequests++;
          await new Promise((resolve) => setTimeout(resolve, 700));
        }
        await route.continue();
      });
      await page.getByRole("button", { name: "Montant payé", exact: true }).click();
      const criterion = role.includes("coordination") ? "Arriérés — École E2E Finance Coordination ≥" : "Arriérés ≥";
      await page.getByRole("group", { name: "Critères de montant payé" }).getByRole("button", { name: criterion, exact: true }).click();
      await page.getByLabel("Filtre", { exact: true }).fill("1");
      const searching = page.getByRole("status").filter({ hasText: "Recherche..." });
      await expect(searching).toBeVisible();
      await expect(searching).toHaveCount(0, { timeout: 120_000 });
      expect(arrearsRequests).toBeGreaterThan(0);
      await expect(page.locator("article button").filter({ hasText: "Finance Élève" })).toBeVisible();
      const exportButton = page.getByRole("button", { name: "Exporter PDF", exact: true });
      await exportButton.click();
      const busy = page.getByRole("button", { name: "En cours...", exact: true });
      await expect(busy).toBeDisabled();
      await expect(page.locator("[data-pdf-download]")).toHaveAttribute("href", /^blob:/, { timeout: 120_000 });
      await expect(exportButton).toBeEnabled();
      await page.locator("[data-pdf-close]").click();
      console.log(JSON.stringify({ role, search: "PASS", pdfBusy: "PASS", arrearsRequests }));
    }
  } finally {
    for (const context of contexts) await context.close();
    await fixture.cleanup();
    const independent = await coordinationMissionFixture(fixture.prefix);
    try {
      expect(await independent.scanResidues()).toEqual({ firestore: 0, auth: 0, storage: 0 });
    } finally {
      await independent.close();
    }
  }
});
