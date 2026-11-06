import { writeFile } from "node:fs/promises";
import { expect, test, type BrowserContext } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
import handler from "../api/manage-financial-transaction.js";
import { readCashBalance } from "../api/_lib/cashBalance.js";
import { fixture, invoke } from "./support/emulatorRecipe";

test("Autres entrées : trois natures de création, précision obligatoire, comptabilité et réponse réseau perdue", async ({ browser }) => {
  test.setTimeout(240_000);
  const f = fixture(); let context: BrowserContext | undefined;
  try {
    await f.seed(["cashier", "teacher", "school_admin"]);
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
    let page = session.page;
    await page.getByRole("button", { name: "Contrôle", exact: true }).last().click();
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await page.getByLabel("Type d'enregistrement").selectOption("inflow");
    const form = page.getByRole("form", { name: "Autres entrées de caisse", exact: true });
    await expect(form.getByLabel("Nature de l'entrée", { exact: true }).locator("option")).toHaveText(["Subvention", "Don", "Autres"]);
    const categories = ["Subvention", "Don", "Autres"];
    const amounts = ["100,25", "200.50", "400"];
    for (let i = 0; i < categories.length; i++) {
      await form.getByLabel("Nature de l'entrée", { exact: true }).selectOption(categories[i]);
      if (categories[i] === "Autres") {
        await expect(form.getByLabel("Précisez la nature de l'entrée")).toBeVisible();
      } else await expect(form.getByLabel("Précisez la nature de l'entrée")).toHaveCount(0);
      await form.getByLabel("Montant", { exact: true }).fill(amounts[i]);
      await form.getByLabel("Provenance des fonds").fill("Association fictive");
      await form.getByLabel("Mode de paiement").fill("Espèces");
      await form.getByRole("button", { name: "Enregistrer cette entrée" }).click();
      expect((await f.db.collection("cashInflows").where("schoolId", "==", f.school).get()).size).toBe(i);
      await form.getByLabel("Description", { exact: true }).fill("Recette fictive catégorie " + categories[i]);
      if (categories[i] === "Autres") {
        await form.getByLabel("Précisez la nature de l'entrée").fill("   ");
        await form.getByRole("button", { name: "Enregistrer cette entrée" }).click();
        expect((await f.db.collection("cashInflows").where("schoolId", "==", f.school).get()).size).toBe(i);
        await form.getByLabel("Précisez la nature de l'entrée").fill("Recettes de la fête scolaire");
      }
      await form.getByRole("button", { name: "Enregistrer cette entrée" }).click();
      await expect.poll(async () => (await f.db.collection("cashInflows").where("schoolId", "==", f.school).get()).size).toBe(i + 1);
      await expect(form.getByLabel("Montant", { exact: true })).toHaveValue("");
    }
    const balance = () => readCashBalance({ db: f.db, schoolId: f.school, schoolYearId: f.year, currency: "CDF", yearCurrency: "CDF" });
    expect((await balance()).availableCents).toBe(70075);
    await form.getByLabel("Nature de l'entrée", { exact: true }).selectOption("Don");
    await expect(form.getByLabel("Précisez la nature de l'entrée")).toHaveCount(0);
    await form.getByLabel("Nature de l'entrée", { exact: true }).selectOption("Autres");
    await expect(form.getByLabel("Précisez la nature de l'entrée")).toHaveValue("");
    // Le serveur engage la transaction, mais le navigateur perd la réponse : réessai du même identifiant.
    await form.getByLabel("Montant", { exact: true }).fill("10");
    await form.getByLabel("Provenance des fonds").fill("Association fictive");
    await form.getByLabel("Mode de paiement").fill("Espèces");
    await form.getByLabel("Description", { exact: true }).fill("Réponse réseau perdue fictive");
    await form.getByLabel("Précisez la nature de l'entrée").fill("Recettes de la fête scolaire");
    transport.dropNextWriteResponse = true;
    await form.getByRole("button", { name: "Enregistrer cette entrée" }).click();
    await expect(form.getByRole("alert")).toBeVisible();
    expect((await f.db.collection("cashInflows").where("schoolId", "==", f.school).get()).size).toBe(4);
    await form.getByRole("button", { name: "Enregistrer cette entrée" }).click();
    await expect(form.getByLabel("Montant", { exact: true })).toHaveValue("");
    expect((await f.db.collection("cashInflows").where("schoolId", "==", f.school).get()).size).toBe(4);
    expect((await balance()).availableCents).toBe(71075);
    expect((await f.db.collection("payments").where("schoolId", "==", f.school).get()).empty).toBe(true);
    expect((await f.db.collection("cashInflows").where("schoolId", "==", f.other).get()).empty).toBe(true);
    // Une archive de l'ancienne catégorie reste lisible même si elle n'est plus proposée dans le formulaire.
    const legacyId = f.tag + "-legacy-inflow";
    await f.db.collection("cashInflows").doc(legacyId).create({ id: legacyId, schoolId: f.school, schoolYearId: f.year,
      category: "Frais de fonctionnement", amount: 1, currency: "CDF", entryDate: today,
      source: "Archive fictive", paymentMethod: "Espèces", description: "Ancienne recette fictive",
      createdAt: new Date().toISOString(), validatedAt: new Date().toISOString(), createdBy: f.tag + "-cashier",
      cashierName: "Caissier fictif", provenance: "financial-api", clientRequestIdHash: f.tag });
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
    await expect(page.getByRole("dialog", { name: "Historique" }).getByText("Recettes de la fête scolaire", { exact: false }).first()).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Historique" }).getByText("Frais de fonctionnement reçus", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Fermer l'historique" }).click();
    // Le rapport financier appartient au menu Administrateur, pas au menu Caissier.
    await context.close();
    const admin = await f.session(browser, "school_admin", { "/api/manage-financial-transaction": handler });
    context = admin.context;
    page = admin.page;
    await page.getByRole("button", { name: "Menu", exact: true }).last().click();
    await page.getByRole("button", { name: /Rapport financier/ }).click();
    await expect(page.getByText("Recettes de la fête scolaire", { exact: false }).first()).toBeVisible();
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
