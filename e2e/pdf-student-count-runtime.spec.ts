import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { coordinationMissionFixture } from "./support/coordinationMissionFixture";

async function exportAndCheck(page: Page, name: string, count: number, tab: "students" | "control") {
  if (tab === "control") await expect(page.locator("main article")).toHaveCount(Math.min(count, 50), { timeout: 90_000 });
  else await expect(page.locator("table tbody tr")).toHaveCount(Math.min(count, 50), { timeout: 90_000 });
  await page.evaluate(() => {
    const state = window as typeof window & { __e2ePdfStudentCount?: string };
    state.__e2ePdfStudentCount = undefined;
    const observer = new MutationObserver(() => {
      const card = document.querySelector<HTMLElement>(".acadea-pdf .document-title");
      const date = [...(card?.querySelectorAll("small") ?? [])].find((element) => element.textContent?.startsWith("Date de génération :"));
      const count = date?.nextElementSibling;
      if (count?.tagName === "SMALL" && count.textContent?.startsWith("Nombre d'élèves :")
        && document.querySelectorAll(".acadea-pdf .document-title").length === 1
        && [...document.querySelectorAll(".acadea-pdf .info-box")].every((element) => !element.textContent?.includes("Nombre d'élèves :"))) {
        state.__e2ePdfStudentCount = count.textContent.replace(/\s+/g, " ").trim();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.setTimeout(() => observer.disconnect(), 120_000);
  });
  await page.getByRole("button", { name: "Exporter PDF", exact: true }).last().click();
  await expect(page.locator("[data-pdf-download]")).toHaveAttribute("href", /^blob:/, { timeout: 120_000 });
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __e2ePdfStudentCount?: string }).__e2ePdfStudentCount)).toBe(`Nombre d'élèves : ${count}`);
  const bytes = await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch(document.querySelector<HTMLAnchorElement>("[data-pdf-download]")!.href)).arrayBuffer())));
  expect(bytes.length).toBeGreaterThan(1000);
  await writeFile(test.info().outputPath(`${name}.pdf`), Buffer.from(bytes));
  await page.locator("[data-pdf-close]").click();
  console.log(JSON.stringify({ pdf: name, expectedStudents: count, renderedStudents: count, bytes: bytes.length, result: "PASS" }));
}

test("PDF Élèves et Contrôle : compteur issu des lignes exportées dans huit parcours", async ({ browser, request }) => {
  test.setTimeout(1_800_000);
  expect(process.env.E2E_EXPECTED_SHA).toMatch(/^[a-f0-9]{40}$/);
  expect(await (await request.get("/version.json")).text()).toContain(process.env.E2E_EXPECTED_SHA!);
  const fixture = await coordinationMissionFixture();
  const contexts: BrowserContext[] = [];
  const secretary = { uid: `${fixture.prefix}-secretary`, email: `${fixture.prefix}-secretary@example.test`, password: `E2e!${randomBytes(18).toString("hex")}` };
  let secretaryCreated = false;
  try {
    await fixture.seed();
    await fixture.seedFilterDiscriminants();
    await fixture.auth.createUser(secretary); secretaryCreated = true;
    await fixture.auth.setCustomUserClaims(secretary.uid, { role: "secretary", schoolId: fixture.schoolId });
    await fixture.db.doc(`users/${secretary.uid}`).set({ id: secretary.uid, name: "Secrétaire PDF E2E", email: secretary.email, role: "secretary", schoolId: fixture.schoolId, status: "active", active: true });
    for (const role of ["school_admin", "secretary", "cashier", "coordination_admin", "sub_coordination_admin"]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }); contexts.push(context);
      const page = await context.newPage();
      if (role === "secretary") {
        await page.goto("https://acadea-staging.vercel.app/login");
        await page.getByPlaceholder("email@ecole.com").fill(secretary.email);
        await page.getByPlaceholder("Votre mot de passe").evaluate((input, value) => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }, secretary.password);
        await page.getByRole("button", { name: "Se connecter", exact: true }).click();
        await expect(page.getByRole("button", { name: "Exporter PDF", exact: true })).toBeVisible({ timeout: 60_000 });
      } else await fixture.login(page, role);
      const coordinated = role.includes("coordination");
      if (role !== "cashier") {
        if (role !== "secretary") await page.getByRole("button", { name: "Élèves", exact: true }).last().click();
        await exportAndCheck(page, `${role}-students`, coordinated ? 54 : 53, "students");
        if (coordinated) {
          await page.getByLabel("Filtrer par école", { exact: true }).selectOption(fixture.secondSchoolId);
          await page.getByLabel("Classe", { exact: true }).selectOption(`${fixture.secondSchoolId}::2ème Humanité`);
          await page.getByLabel("Option", { exact: true }).selectOption("Littéraire");
          await exportAndCheck(page, `${role}-students-filtered`, 1, "students");
        }
      }
      if (role !== "secretary") {
        await page.getByRole("button", { name: "Contrôle", exact: true }).last().click();
        if (coordinated) await page.getByLabel("Filtrer par école", { exact: true }).selectOption("");
        await exportAndCheck(page, `${role}-control`, coordinated ? 54 : 53, "control");
        if (role === "school_admin") {
          await page.getByLabel("Classe", { exact: true }).selectOption({ label: "1ère Sciences" });
          await exportAndCheck(page, `${role}-control-filtered`, 1, "control");
        }
        if (coordinated) {
          await page.getByLabel("Filtrer par école", { exact: true }).selectOption(fixture.secondSchoolId);
          await page.getByLabel("Classe", { exact: true }).selectOption(`${fixture.secondSchoolId}::2ème Humanité`);
          await exportAndCheck(page, `${role}-control-filtered`, 1, "control");
        }
      }
      await context.close(); contexts.pop();
    }
  } finally {
    for (const context of contexts) await context.close();
    if (secretaryCreated) await fixture.auth.deleteUser(secretary.uid);
    await fixture.cleanup();
    const independent = await coordinationMissionFixture(fixture.prefix);
    try { expect(await independent.scanResidues()).toEqual({ firestore: 0, auth: 0, storage: 0 }); }
    finally { await independent.close(); }
  }
});
