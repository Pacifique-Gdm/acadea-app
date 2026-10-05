import { expect, test, type BrowserContext } from "@playwright/test";
import { coordinationMissionFixture } from "./support/coordinationMissionFixture";

test("une section activée dans Paramètres école apparaît dans les filtres Coordination après actualisation", async ({ browser, request }) => {
  test.setTimeout(900_000);
  expect(process.env.E2E_EXPECTED_SHA).toMatch(/^[a-f0-9]{40}$/);
  expect(await (await request.get("/version.json")).text()).toContain(process.env.E2E_EXPECTED_SHA!);
  const fixture = await coordinationMissionFixture();
  const contexts: BrowserContext[] = [];
  try {
    await fixture.seed();
    await fixture.seedFilterDiscriminants();
    const coordinationContext = await browser.newContext(); contexts.push(coordinationContext);
    const coordinationPage = await coordinationContext.newPage();
    await fixture.login(coordinationPage, "coordination_admin");
    await coordinationPage.getByRole("button", { name: "Élèves", exact: true }).last().click();
    await coordinationPage.getByLabel("Filtrer par école", { exact: true }).selectOption(fixture.schoolId);
    const classes = coordinationPage.getByLabel("Classe", { exact: true });
    await expect.poll(async () => (await classes.locator("option").allTextContents()).join(" ")).toContain("1ère Primaire");
    expect((await classes.locator("option").allTextContents()).join(" ")).not.toContain("Maternelle 1");

    const adminContext = await browser.newContext(); contexts.push(adminContext);
    const adminPage = await adminContext.newPage();
    await fixture.login(adminPage, "school_admin");
    await adminPage.getByRole("button", { name: "Menu", exact: true }).last().click();
    await adminPage.getByRole("button", { name: /^Paramètres école/ }).click();
    const settings = adminPage.getByRole("dialog", { name: "Paramètres école" });
    await settings.getByLabel("Maternelle", { exact: true }).click();
    await settings.getByLabel("Phrase de confirmation de la section").fill("COCHER CETTE SECTION");
    await settings.getByRole("button", { name: "Confirmer", exact: true }).click();
    await expect(adminPage.getByRole("status")).toContainText("Section « Maternelle » cochée avec succès.");
    expect((await fixture.db.doc(`schools/${fixture.schoolId}`).get()).get("educationLevels")).toContain("Maternelle");

    await coordinationPage.reload();
    await coordinationPage.getByRole("button", { name: "Élèves", exact: true }).last().click();
    await coordinationPage.getByLabel("Filtrer par école", { exact: true }).selectOption(fixture.schoolId);
    const refreshedClasses = coordinationPage.getByLabel("Classe", { exact: true });
    await expect.poll(async () => (await refreshedClasses.locator("option").allTextContents()).join(" ")).toContain("Maternelle 1");
    await expect.poll(async () => (await refreshedClasses.locator("option").allTextContents()).join(" ")).toContain("3ème Primaire");
    console.log(JSON.stringify({ adminSectionChange: "Maternelle", coordinatorAfterRefresh: ["Maternelle 1", "3ème Primaire"], result: "PASS" }));
  } finally {
    for (const context of contexts) await context.close();
    await fixture.cleanup();
    const independent = await coordinationMissionFixture(fixture.prefix);
    try { expect(await independent.scanResidues()).toEqual({ firestore: 0, auth: 0, storage: 0 }); }
    finally { await independent.close(); }
  }
});
