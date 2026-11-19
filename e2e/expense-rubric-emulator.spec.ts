import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext } from "@playwright/test";
import handler from "../api/manage-financial-transaction.js";
import { fixture, invoke } from "./support/emulatorRecipe";

// Version 1.14.0 : formulaire « Enregistrer une dépense » du Caissier quand la répartition des frais est active.
// Rubrique obligatoire au-dessus de la carte, montants de la rubrique, dépassement bloqué, « Autre » avec précision.
test("dépense du Caissier : rubrique obligatoire, disponible de la rubrique, dépassement bloqué, nature « Autre » précisée", async ({ browser }) => {
  test.setTimeout(240_000);
  const f = fixture(), fixtureId = `e2e-allocation-${randomUUID().replaceAll("-", "")}`;
  let context: BrowserContext | undefined;
  try {
    await f.seed(["school_admin", "cashier"]);
    await f.db.doc(`schools/${f.school}`).update({ fixtureId, schoolId: f.school });
    await f.db.doc(`feeAllocationTestScopes/${fixtureId}`).create({ fixtureId, schoolId: f.school, schoolIds: [f.school], projectId: "demo-acadea",
      status: "active", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
    const fee = `${f.tag}-fee`, student = `${f.tag}-student`, rubric = "b".repeat(32);
    await f.put(`feeTypes/${fee}`, { id: fee, schoolId: f.school, schoolYearId: f.year, name: "Minerval", className: "1ère Secondaire", amount: 100, createdAt: new Date().toISOString() });
    const admin = await f.token("school_admin"), cashier = await f.token("cashier");
    const good = async (body: Record<string, unknown>, token = admin) => {
      const r = await invoke(handler, token, body); expect(r, String(r.payload.code)).toMatchObject({ status: 200 }); return r.payload;
    };
    const allocation = (action: string, extra: Record<string, unknown> = {}) => good({ action: `fee-allocation.${action}`, requestId: randomUUID(), ...extra });
    // Activation fictive : rubrique « Fonctionnement » à 80 %.
    await allocation("save-draft", { feeTypeId: fee, expectedRevision: 0, rubrics: [{ id: rubric, name: "Fonctionnement", mode: "percent", basisPoints: 8000 }] });
    const prepared = await allocation("prepare-version", { feeTypeId: fee, expectedRevision: 1 });
    await allocation("publish-configuration", { versionId: (prepared.version as { id: string }).id });
    await f.put(`students/${student}`, { id: student, schoolId: f.school, schoolYearId: f.year, status: "ACTIVE", className: "1ère Secondaire", createdAt: new Date().toISOString() });
    type Run = { id: string; sequence: number; status: string };
    let run = (await allocation("start-reconciliation")).run as Run;
    while (run.status === "RUNNING") run = (await good({ action: "fee-allocation.advance-reconciliation", runId: run.id, sequence: run.sequence })).run as Run;
    const opening = await allocation("prepare-opening", { cashCountMinor: 0, lines: [{ rubricId: rubric, amountMinor: 0 }], confirmation: "RAPPROCHER LA CAISSE" });
    await allocation("approve-opening", { openingId: opening.openingId, confirmation: "APPROUVER LE RAPPROCHEMENT" });
    await allocation("activate", { openingId: opening.openingId, confirmation: "ACTIVER LA REPARTITION FICTIVE", requestId: randomUUID() });
    // Un paiement de 100 : 80 vont à « Fonctionnement ».
    await good({ action: "create-payment", schoolYearId: f.year, studentId: student, feeTypeId: fee, amount: 100, clientRequestId: randomUUID() }, cashier);

    const session = await f.session(browser, "cashier", { "/api/manage-financial-transaction": handler });
    context = session.context;
    const page = session.page;
    await page.getByRole("button", { name: "Contrôle", exact: true }).last().click();
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await page.getByLabel("Type d'enregistrement").selectOption("expense");
    const drawer = page.getByRole("dialog").filter({ has: page.getByLabel("Type d'enregistrement") });
    const save = drawer.getByRole("button", { name: "Enregistrer", exact: true });
    const rubricSelect = drawer.getByLabel("Rubrique d'imputation obligatoire");
    const card = drawer.getByRole("region", { name: "Disponible de la rubrique" });
    const expenses = async () => (await f.db.collection("expenses").where("schoolId", "==", f.school).get()).docs.map(d => d.data());

    // La rubrique est placée AU-DESSUS de la carte des montants.
    await expect(rubricSelect).toBeVisible();
    const [selectBox, cardBox] = [await rubricSelect.boundingBox(), await card.boundingBox()];
    expect(selectBox!.y).toBeLessThan(cardBox!.y);
    await expect(card).toContainText("Choisissez la rubrique d'imputation");

    await drawer.getByPlaceholder("Montant", { exact: true }).fill("90");
    await drawer.getByPlaceholder("Écrivez la description").fill("Dépense fictive de recette");
    await drawer.getByPlaceholder("Bénéficiaire / fournisseur").fill("Fournisseur fictif");
    await drawer.getByPlaceholder("Mode de paiement").fill("Espèces");
    // Sans rubrique : bouton désactivé.
    await expect(save).toBeDisabled();
    await rubricSelect.selectOption(rubric);
    // 90 > 80 disponibles : message rouge, bouton désactivé.
    await expect(card).toContainText("Disponible de la rubrique « Fonctionnement »");
    await expect(card.getByRole("alert")).toContainText(/Montant supérieur au disponible de la rubrique : 80,00/);
    await expect(save).toBeDisabled();
    expect(await expenses()).toHaveLength(0);
    // Le serveur refuse aussi le dépassement (requête directe).
    const over = await invoke(handler, cashier, { action: "create-expense", schoolYearId: f.year, amount: 90, category: "Fournitures", description: "Fictif",
      beneficiary: "Fictif", paymentMethod: "Espèces", allocationRubricId: rubric, clientRequestId: randomUUID() });
    expect(over.status).toBe(409);

    // 50 : montants de la rubrique, bouton actif.
    await drawer.getByPlaceholder("Montant", { exact: true }).fill("50");
    await expect(card.getByRole("alert")).toHaveCount(0);
    await expect(card).toContainText(/Montant à décaisser : 50,00/);
    await expect(card).toContainText(/Disponible après opération : 30,00/);
    await expect(save).toBeEnabled();

    // Nature « Autre » : précision obligatoire (au moins 3 caractères).
    await drawer.locator("select").filter({ has: page.locator("option", { hasText: "Fournitures" }) }).first().selectOption("Autre");
    const detail = drawer.getByLabel("Précisez la nature (obligatoire)");
    await expect(detail).toBeVisible();
    await expect(save).toBeDisabled();
    await detail.fill("ab");
    await expect(save).toBeDisabled();
    await detail.fill("Réparation du portail");
    await expect(save).toBeEnabled();
    await page.screenshot({ path: test.info().outputPath("depense-rubrique-avant.png"), fullPage: true });
    await save.click();
    await expect.poll(async () => (await expenses()).length).toBe(1);
    const [expense] = await expenses();
    expect(expense).toMatchObject({ amount: 50, category: "Autre", categoryDetail: "Réparation du portail", allocationRubricId: rubric });
    await expect(page.getByText("Dépense enregistrée avec succès.")).toBeVisible();

    // Disponible relu depuis le serveur : 80 − 50 = 30.
    const workspace = await allocation("get-workspace", { schoolId: f.school });
    const ledger = workspace.ledger as { balances: { rubricId: string; availableMinor: number; spentMinor: number }[] };
    expect(ledger.balances.find(b => b.rubricId === rubric)).toMatchObject({ spentMinor: 5000, availableMinor: 3000 });
  } finally { await context?.close(); await f.cleanup(); }
});
