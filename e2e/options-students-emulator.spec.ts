import { writeFile } from "node:fs/promises";
import { expect, test, type BrowserContext } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
import handler from "../api/manage-school.js";
import { studentForPersistence } from "../src/utils/studentYearTransition.js";
import { fixture, invoke, students } from "./support/emulatorRecipe";

test("PR31 : renommage réel, sessions ouvertes, références, tableaux et PDF", async ({ browser }) => {
  test.setTimeout(240_000);
  const f = fixture(), sessions: BrowserContext[] = [];
  try {
    await f.seed(["super_admin", "school_admin", "secretary"]);
    const classId = f.tag + "-class", studentId = f.tag + "-student";
    await f.put("classes/" + classId, { id: classId, schoolId: f.school, schoolYearId: f.year, name: "1ère Humanité", section: "Secondaire", classOptionKey: "Sciences", active: true });
    await f.put("students/" + studentId, studentForPersistence({ id: studentId, schoolId: f.school, schoolYearId: f.year,
      classId, className: "1ère Humanité", section: "Secondaire", option: "Sciences", matricule: "E2E-001",
      nom: "ALPHA", postnom: "FICTIF", prenom: "Alice", sexe: "F", birthDate: "2012-09-25", phone: "0999000000", status: "ACTIVE" }));
    const before = (await f.db.doc("students/" + studentId).get()).data();
    const otherBefore = (await f.db.doc("schools/" + f.other).get()).data();
    const payload = { action: "rename-option", schoolId: f.school, option: "Sciences", newName: "Technologies", confirmation: "CHANGER LE NOM DE CETTE OPTION" };
    expect((await invoke(handler, await f.token("super_admin"), { ...payload, confirmation: "incorrecte" })).status).toBe(400);
    expect((await invoke(handler, await f.token("secretary"), payload)).status).toBe(403);
    const handlers = { "/api/manage-school": handler };
    const admin = await f.session(browser, "school_admin", handlers); sessions.push(admin.context);
    const secretary = await f.session(browser, "secretary", handlers); sessions.push(secretary.context);
    for (const { page } of [admin, secretary]) {
      await students(page);
      await expect(page.getByRole("columnheader", { name: "Date de naissance", exact: true })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Téléphone", exact: true })).toHaveCount(0);
      await expect(page.getByRole("row").filter({ hasText: "ALPHA" })).toContainText("25/09/2012");
      await page.getByRole("button", { name: "Ajouter un élève" }).click();
      await expect(page.locator('select option[value="Sciences"]').last()).toHaveText("Sciences");
    }
    const platform = await f.session(browser, "super_admin", handlers); sessions.push(platform.context);
    await platform.page.getByRole("button", { name: /Écoles/, exact: false }).first().click();
    await platform.page.getByText("École recette locale", { exact: true }).first().click();
    await platform.page.getByRole("button", { name: "Informations", exact: true }).click();
    await platform.page.getByRole("button", { name: /Sciences.*Renommer/ }).click();
    const dialog = platform.page.getByRole("dialog", { name: "Renommer une option scolaire" });
    await dialog.getByLabel("Nouveau nom").fill("Technologies");
    await dialog.getByLabel("Confirmation du renommage de l'option").fill("incorrecte");
    await expect(dialog.getByRole("button", { name: "Enregistrer", exact: true })).toBeDisabled();
    await dialog.getByLabel("Confirmation du renommage de l'option").fill(payload.confirmation);
    await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect.poll(async () => (await f.db.doc("schools/" + f.school).get()).data()?.schoolOptionDisplayNames?.Sciences).toBe("Technologies");
    for (const [role, { page }] of [["admin", admin], ["secretary", secretary]] as const) {
      // Les deux sessions étaient ouvertes avant le renommage : ni reload ni reconnexion.
      await expect(page.locator('select option[value="Sciences"]').last()).toHaveText("Technologies");
      await page.getByRole("button", { name: "Fermer le formulaire élève" }).click();
      await page.getByRole("button", { name: "Exporter PDF", exact: true }).click();
      await expect(page.locator("[data-pdf-download]")).toHaveAttribute("href", /^blob:/, { timeout: 45_000 });
      const bytes = new Uint8Array(await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch(document.querySelector<HTMLAnchorElement>("[data-pdf-download]")!.href)).arrayBuffer()))));
      expect(bytes.length).toBeGreaterThan(1000);
      await writeFile(test.info().outputPath(role + "-students.pdf"), bytes);
      const pdf = await getDocument({ data: bytes.slice() }).promise;
      for (let i = 1; i <= pdf.numPages; i++) {
        const sheet = await pdf.getPage(i), viewport = sheet.getViewport({ scale: 1.5 });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await sheet.render({ canvasContext: canvas.getContext("2d") as never, canvas: canvas as never, viewport }).promise;
        await writeFile(test.info().outputPath(role + "-page-" + i + ".png"), canvas.toBuffer("image/png"));
      }
      await page.locator("[data-pdf-close]").click();
      await page.screenshot({ path: test.info().outputPath(role + "-table.png"), fullPage: true });
    }
    await admin.page.getByRole("button", { name: "Menu", exact: true }).last().click();
    await admin.page.getByRole("button", { name: /Paramètres école/ }).click();
    await expect(admin.page.getByText("Technologies", { exact: true }).first()).toBeVisible();
    expect((await f.db.doc("students/" + studentId).get()).data()).toEqual(before);
    expect((await f.db.doc("classes/" + classId).get()).data()?.classOptionKey).toBe("Sciences");
    expect((await f.db.doc("schools/" + f.school).get()).data()?.schoolOptions).toEqual(["Sciences", "Littéraire"]);
    expect((await f.db.doc("schools/" + f.other).get()).data()).toEqual(otherBefore);
  } finally {
    for (const session of sessions) await session.close();
    await f.cleanup();
  }
});
