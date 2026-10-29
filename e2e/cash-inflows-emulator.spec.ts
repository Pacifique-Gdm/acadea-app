import { writeFile } from "node:fs/promises";
import { expect, test, type BrowserContext } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
import handler from "../api/manage-financial-transaction.js";
import { readCashBalance } from "../api/_lib/cashBalance.js";
import { fixture, invoke } from "./support/emulatorRecipe";

test("PR32 : quatre catégories, comptabilité réelle, refus et réponse réseau perdue", async ({ browser }) => {
  test.setTimeout(240_000);
  const f = fixture(); let context: BrowserContext | undefined;
  try {
    await f.seed(["cashier", "teacher"]);
    const today = new Date().toISOString().slice(0, 10);
    const token = await f.token("cashier");
    const body = { action: "create-cash-inflow", schoolYearId: f.year, category: "Don", amount: 50.25, entryDate: today,
      source: "Association fictive", paymentMethod: "Espèces", description: "Contribution de recette fictive", clientRequestId: f.tag + "-negative" };
    expect((await invoke(handler, token, { ...body, description: "" })).status).toBe(400);
    expect((await invoke(handler, await f.token("teacher"), body)).status).toBe(403);
    expect((await invoke(handler, token, { ...body, schoolYearId: f.tag + "-other-year" })).status).toBe(400);
    expect((await f.db.collection("cashInflows").where("schoolId", "==", f.school).get()).empty).toBe(true);
    const transport = { dropNextWriteResponse: false };
    const session = await f.session(browser, "cashier", { "/api/manage-financial-transaction": handler }, transport);
    context = session.context;
    const page = session.page;
    await page.getByRole("button", { name: "Contrôle", exact: true }).last().click();
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await page.getByLabel("Type d'enregistrement").selectOption("inflow");
    const form = page.getByRole("form", { name: "Autres entrées de caisse", exact: true });
    await expect(form.getByLabel("Nature de l'entrée").locator("option")).toHaveText(["Subvention", "Don", "Frais de fonctionnement reçus", "Autres"]);
    const categories = ["Subvention", "Don", "Frais de fonctionnement", "Autres"];
    const amounts = ["100,25", "200.50", "300,75", "400"];
    for (let i = 0; i < categories.length; i++) {
      await form.getByLabel("Nature de l'entrée").selectOption(categories[i]);
      await form.getByLabel("Montant", { exact: true }).fill(amounts[i]);
      await form.getByLabel("Provenance des fonds").fill("Association fictive");
      await form.getByLabel("Mode de paiement").fill("Espèces");
      await form.getByRole("button", { name: "Enregistrer cette entrée" }).click();
      expect((await f.db.collection("cashInflows").where("schoolId", "==", f.school).get()).size).toBe(i);
      await form.getByLabel("Description", { exact: true }).fill("Recette fictive catégorie " + categories[i]);
      await form.getByRole("button", { name: "Enregistrer cette entrée" }).click();
      await expect.poll(async () => (await f.db.collection("cashInflows").where("schoolId", "==", f.school).get()).size).toBe(i + 1);
      await expect(form.getByLabel("Montant", { exact: true })).toHaveValue("");
    }
    const balance = () => readCashBalance({ db: f.db, schoolId: f.school, schoolYearId: f.year, currency: "CDF", yearCurrency: "CDF" });
    expect((await balance()).availableCents).toBe(100150);
    // Le serveur engage la transaction, mais le navigateur perd la réponse : réessai du même identifiant.
    await form.getByLabel("Montant", { exact: true }).fill("10");
    await form.getByLabel("Provenance des fonds").fill("Association fictive");
    await form.getByLabel("Mode de paiement").fill("Espèces");
    await form.getByLabel("Description", { exact: true }).fill("Réponse réseau perdue fictive");
    transport.dropNextWriteResponse = true;
    await form.getByRole("button", { name: "Enregistrer cette entrée" }).click();
    await expect(form.getByRole("alert")).toBeVisible();
    expect((await f.db.collection("cashInflows").where("schoolId", "==", f.school).get()).size).toBe(5);
    await form.getByRole("button", { name: "Enregistrer cette entrée" }).click();
    await expect(form.getByLabel("Montant", { exact: true })).toHaveValue("");
    expect((await f.db.collection("cashInflows").where("schoolId", "==", f.school).get()).size).toBe(5);
    expect((await balance()).availableCents).toBe(101150);
    expect((await f.db.collection("payments").where("schoolId", "==", f.school).get()).empty).toBe(true);
    expect((await f.db.collection("cashInflows").where("schoolId", "==", f.other).get()).empty).toBe(true);
    // Règles réelles : aucune écriture financière client directe, même avec un token Caissier valide.
    const denied = await fetch("http://127.0.0.1:8080/v1/projects/demo-acadea/databases/(default)/documents/cashInflows/" + f.tag + "-forged", {
      method: "PATCH", headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { schoolId: { stringValue: f.school }, amount: { doubleValue: 999 } } }),
    });
    expect(denied.status).toBe(403);
    await page.getByRole("button", { name: "Fermer Enregistrer", exact: true }).click();
    await page.getByRole("button", { name: "Historique", exact: true }).click();
    await page.getByLabel("Type d'historique").selectOption("cashInflows");
    await expect(page.getByRole("dialog", { name: "Historique" }).locator("article")).toHaveCount(5);
    await page.getByRole("button", { name: "Fermer l'historique" }).click();
    await page.getByRole("button", { name: "Menu", exact: true }).last().click();
    await page.getByRole("button", { name: /Rapport financier/ }).click();
    await expect(page.getByText("Frais de fonctionnement reçus", { exact: false }).first()).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("cash-report.png"), fullPage: true });
    await page.getByRole("button", { name: "Export PDF", exact: true }).click();
    await expect(page.locator("[data-pdf-download]")).toHaveAttribute("href", /^blob:/, { timeout: 45_000 });
    const bytes = new Uint8Array(await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch(document.querySelector<HTMLAnchorElement>("[data-pdf-download]")!.href)).arrayBuffer()))));
    await writeFile(test.info().outputPath("cash-report.pdf"), bytes);
    const pdf = await getDocument({ data: bytes.slice() }).promise;
    for (let i = 1; i <= pdf.numPages; i++) {
      const sheet = await pdf.getPage(i), viewport = sheet.getViewport({ scale: 1.5 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await sheet.render({ canvasContext: canvas.getContext("2d") as never, canvas: canvas as never, viewport }).promise;
      await writeFile(test.info().outputPath("cash-report-" + i + ".png"), canvas.toBuffer("image/png"));
    }
  } finally { await context?.close(); await f.cleanup(); }
});
