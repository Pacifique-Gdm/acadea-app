import { test, expect, type BrowserContext } from "@playwright/test";
import { coordinationMissionFixture } from "./support/coordinationMissionFixture";

test("Mesures initiales fiches et confirmation retrait — Staging isolé", async ({ browser, request }) => {
  test.setTimeout(900000);
  expect(await (await request.get("/version.json")).text()).toContain("8d323b02da2bdcb82379aa4171b09368dce52e28");
  const fixture = await coordinationMissionFixture();
  const contexts: BrowserContext[] = [];
  console.log(JSON.stringify({ baselineFixture: fixture.prefix }));
  try {
    await fixture.seed();
    for (const role of ["school_admin", "coordination_admin", "sub_coordination_admin"]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }); contexts.push(context);
      const page = await context.newPage();
      await fixture.login(page, role);
      for (const tab of ["Contrôle", "Élèves"]) {
        await page.getByRole("button", { name: tab, exact: true }).last().click();
        const student = tab === "Contrôle"
          ? page.locator("article").filter({ hasText: "7ème CTEB" }).getByRole("button", { name: "Finance Élève", exact: true })
          : page.getByRole("row").filter({ hasText: "7ème CTEB" }).getByRole("button", { name: /Finance.*E2E.*Élève/ });
        await expect(student).toBeVisible({ timeout: 60000 });
        const calls: { path: string; ms: number }[] = [];
        const record = (response: import("@playwright/test").Response) => {
          const url = new URL(response.url());
          if (url.pathname.startsWith("/api/") || url.hostname === "firestore.googleapis.com") calls.push({ path: url.pathname, ms: Math.round(response.request().timing().responseEnd) });
        };
        page.on("response", record);
        const start = Date.now(); await student.click();
        await expect(page.getByRole("heading", { name: /Finance.*Élève/ }).first()).toBeVisible({ timeout: 60000 });
        const usefulMs = Date.now() - start;
        if (role.includes("coordination")) await expect(page.getByRole("heading", { name: "Dettes des années antérieures" })).toBeVisible({ timeout: 60000 });
        await expect(page.getByText("Chargement de la fiche…", { exact: true })).toHaveCount(0);
        console.log(JSON.stringify({ baseline: { role, tab, usefulMs, completeMs: Date.now() - start, calls } }));
        page.off("response", record);
      }
      await context.close();
    }
    // A long, entirely synthetic available-school list proves where the dialog is rendered.
    for (let index = 0; index < 12; index++) {
      const id = `${fixture.prefix}-available-${index}`;
      await fixture.db.doc(`schools/${id}`).set({ id, name: `École disponible E2E ${index}`, status: "active", currency: "USD" });
    }
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true }); contexts.push(context);
    const page = await context.newPage(); await fixture.login(page, "super_admin");
    await page.getByRole("button", { name: "Coordinations", exact: true }).last().click();
    await page.getByRole("button", { name: /Coordination E2E Finance.*Active/ }).click();
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const trigger = page.getByRole("button", { name: "Retirer de la Coordination", exact: true });
      await trigger.scrollIntoViewIfNeeded();
      if (width === 390) await trigger.tap(); else await trigger.click();
      const dialog = page.getByRole("alertdialog", { name: "Confirmation de périmètre" });
      await expect(dialog).toBeAttached();
      console.log(JSON.stringify({ baselineRemove: { width, trigger: await trigger.boundingBox(), confirmation: await dialog.boundingBox(), viewportHeight: 900, styles: await dialog.evaluate((element) => ({ position: getComputedStyle(element).position, zIndex: getComputedStyle(element).zIndex, pointerEvents: getComputedStyle(element).pointerEvents })) } }));
      await page.screenshot({ path: test.info().outputPath(`baseline-remove-${width}.png`) });
      await dialog.getByRole("button", { name: "Annuler", exact: true }).click();
    }
  } finally {
    for (const context of contexts) await context.close();
    await fixture.cleanup();
  }
});
