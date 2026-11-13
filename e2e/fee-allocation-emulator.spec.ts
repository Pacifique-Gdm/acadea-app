import { writeFile } from "node:fs/promises";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
import handler from "../api/manage-financial-transaction.js";
import { fixture, invoke } from "./support/emulatorRecipe";

test("répartition préparatoire : quatre rôles authentifiés, transaction, versions, refus et PDF", async ({ browser }) => {
  test.setTimeout(360_000);
  const f = fixture(); let context: BrowserContext | undefined; let activePage: Page | undefined;
  try {
    await f.seed(["school_admin", "cashier", "coordination_admin", "sub_coordination_admin", "teacher"]);
    const coord = `${f.tag}-coord`, sub = `${f.tag}-sub`;
    await f.put(`coordinations/${coord}`, { id: coord, name: "Coordination fictive", status: "active", coordinatorUserId: f.accounts.coordination_admin.uid });
    await f.put(`subCoordinations/${sub}`, { id: sub, name: "Sous-coordination fictive", coordinationId: coord, active: true, status: "active", coordinatorUserId: f.accounts.sub_coordination_admin.uid });
    await f.put(`coordinationSchools/${coord}__${f.school}`, { coordinationId: coord, schoolId: f.school, active: true });
    await f.put(`subCoordinationSchools/${sub}__${f.school}`, { subCoordinationId: sub, coordinationId: coord, schoolId: f.school, active: true });
    await f.db.doc(`schools/${f.school}`).update({ activeCoordinationId: coord });
    for (const role of ["coordination_admin", "sub_coordination_admin"]) {
      const scope = { role, coordinationId: coord, ...(role === "sub_coordination_admin" ? { subCoordinationId: sub } : {}) };
      await f.auth.setCustomUserClaims(f.accounts[role].uid, scope);
      await f.db.doc(`users/${f.accounts[role].uid}`).update(scope);
    }
    for (const [suffix, amount, option] of [["a", 100, "Sciences"], ["b", 200, "Littéraire"]] as const) {
      await f.put(`feeTypes/${f.tag}-${suffix}`, { id: `${f.tag}-${suffix}`, schoolId: f.school, schoolYearId: f.year, name: "Minerval fictif", className: "1ère Secondaire", classOptionKey: `1ère Secondaire::option::${option}`, amount });
    }
    const adminToken = await f.token("school_admin");
    const session = await f.session(browser, "school_admin", { "/api/manage-financial-transaction": handler });
    context = session.context; let page = session.page; activePage = page;
    await page.getByRole("button", { name: "Menu", exact: true }).last().click();
    await page.getByRole("button", { name: "Répartition des frais", exact: true }).click();
    await page.getByRole("button", { name: "+ Ajouter", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Ajouter une répartition", exact: true });
    await editor.getByLabel("Frais existant", { exact: true }).selectOption(`${f.tag}-a`);
    await editor.getByRole("checkbox", { name: "Toutes les classes concernées", exact: true }).check();
    for (const [index, name, mode, value] of [[0, "Fonctionnement", "percent", "20"], [1, "Salaire", "fixed", "30"], [2, "Prime", "percent", "25"]] as const) {
      if (index) await editor.getByRole("button", { name: "+ Ajouter une rubrique", exact: true }).click();
      await editor.getByLabel(`Nom de la rubrique ${index + 1}`, { exact: true }).fill(name);
      await editor.getByRole("combobox", { name: "Mode", exact: true }).nth(index).selectOption(mode);
      await editor.locator('input[inputmode="decimal"]').nth(index).fill(value);
    }
    await expect(editor.getByText(/Non affecté :/)).toHaveCount(2);
    let lost: Record<string, unknown> | undefined;
    await page.route("**/api/manage-financial-transaction", async route => {
      const input = route.request().postDataJSON();
      if (input.action !== "fee-allocation.save-drafts" || lost) return route.fallback();
      lost = input;
      const result = await invoke(handler, route.request().headers().authorization, input);
      expect(result.status).toBe(200); await route.abort("connectionreset");
    });
    await editor.getByRole("button", { name: "Enregistrer la répartition", exact: true }).click();
    await expect(editor.getByRole("button", { name: "Vérifier la même demande", exact: true })).toBeVisible();
    await expect(editor.getByLabel("Frais existant")).toBeDisabled();
    await editor.getByRole("button", { name: "Vérifier la même demande", exact: true }).click();
    await expect(editor).toHaveCount(0);
    const configs = () => f.db.collection("feeAllocationConfigs").where("schoolId", "==", f.school).get();
    expect((await configs()).size).toBe(2);
    expect((await invoke(handler, adminToken, lost)).payload.idempotent).toBe(true);
    await page.getByRole("button", { name: "Fonctionnement", exact: true }).first().click();
    await page.getByRole("button", { name: "Préparer une version", exact: true }).click();
    await expect(page.getByText(/Version 1 · prepared/)).toBeVisible();
    await page.getByRole("button", { name: "Fermer le détail de rubrique", exact: true }).click();
    await context.close(); context = undefined;
    for (const role of ["school_admin", "cashier", "coordination_admin", "sub_coordination_admin"]) {
      const s = await f.session(browser, role, { "/api/manage-financial-transaction": handler }); context = s.context; page = s.page; activePage = page;
      await page.getByRole("button", { name: "Menu", exact: true }).last().click();
      await page.getByRole("button", { name: "Répartition des frais", exact: true }).click();
      const drawer = page.getByRole("dialog", { name: "Répartition des frais", exact: true });
      await expect(drawer.getByRole("button", { name: "Exporter PDF", exact: true })).toBeEnabled();
      await expect(drawer.getByRole("button", { name: "+ Ajouter", exact: true })).toHaveCount(role === "school_admin" ? 1 : 0);
      await expect(drawer.getByLabel("Filtre", { exact: true }).locator("option")).toHaveText(["Frais", "Classe", "Période"]);
      await expect(drawer.locator("tbody tr")).toHaveCount(8);
      await drawer.getByLabel("Filtre", { exact: true }).selectOption("class");
      await drawer.getByLabel("Valeur correspondante", { exact: true }).selectOption(JSON.stringify([f.school, "1ère Secondaire::option::Sciences"]));
      await expect(drawer.locator("tbody tr")).toHaveCount(4);
      await drawer.getByLabel("Filtre", { exact: true }).selectOption("period");
      await drawer.getByLabel("Valeur correspondante", { exact: true }).selectOption("today");
      await expect(drawer.locator("tbody tr")).toHaveCount(8);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(drawer.getByRole("button", { name: "Exporter PDF", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`${role}-mobile.png`), fullPage: true });
      await drawer.getByRole("button", { name: "Exporter PDF", exact: true }).click();
      await expect(page.locator("[data-pdf-download]")).toHaveAttribute("href", /^blob:/, { timeout: 45_000 });
      const bytes = new Uint8Array(await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch(document.querySelector<HTMLAnchorElement>("[data-pdf-download]")!.href)).arrayBuffer()))));
      await writeFile(test.info().outputPath(`${role}-allocation.pdf`), bytes);
      const pdf = await getDocument({ data: bytes.slice() }).promise;
      expect(pdf.numPages).toBeGreaterThan(0);
      for (let i = 1; i <= pdf.numPages; i++) {
        const sheet = await pdf.getPage(i), viewport = sheet.getViewport({ scale: 1.2 });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await sheet.render({ canvasContext: canvas.getContext("2d") as never, canvas: canvas as never, viewport }).promise;
        await writeFile(test.info().outputPath(`${role}-allocation-${i}.png`), canvas.toBuffer("image/png"));
      }
      await context.close(); context = undefined;
      const token = await f.token(role);
      expect((await invoke(handler, token, { action: "fee-allocation.get-workspace", schoolId: f.other })).status).toBe(403);
      if (role !== "school_admin") expect((await invoke(handler, token, lost)).status).toBe(403);
      const denied = await fetch(`http://127.0.0.1:8080/v1/projects/demo-acadea/databases/(default)/documents/feeAllocationConfigs/${f.tag}-forged`, { method: "PATCH", headers: { Authorization: token, "Content-Type": "application/json" }, body: JSON.stringify({ fields: { schoolId: { stringValue: f.school } } }) });
      expect(denied.status).toBe(403);
    }
    expect((await invoke(handler, await f.token("teacher"), { action: "fee-allocation.get-workspace", schoolId: f.school })).status).toBe(403);
    expect((await invoke(handler, adminToken, { action: "fee-allocation.activate" })).status).toBe(409);
    for (const collection of ["payments", "expenses", "feeAllocationMovements", "feeAllocationBalances", "feeAllocationOpeningAudits"]) expect((await f.db.collection(collection).where("schoolId", "==", f.school).get()).empty).toBe(true);
  } catch (error) {
    if (activePage && !activePage.isClosed() && !activePage.url().includes("/login")) {
      await writeFile(test.info().outputPath("allocation-ui-error.txt"), await activePage.locator("body").ariaSnapshot());
      await activePage.screenshot({ path: test.info().outputPath("allocation-ui-error.png"), fullPage: true });
    }
    throw error;
  } finally { await context?.close(); await f.cleanup(); }
});
