import { expect, test } from "@playwright/test";
import { fixture, origin } from "./support/emulatorRecipe";

test("incident frais : école coordonnée, classe historique, confirmation et réponse perdue", async ({ browser }) => {
  test.setTimeout(180_000);
  const f = fixture();
  const context = await browser.newContext({ baseURL: origin, serviceWorkers: "block" });
  try {
    await f.seed(["school_admin", "teacher"]);
    await f.put(`coordinations/${f.tag}-coord`, { id: f.tag + "-coord", status: "active" });
    await f.db.doc(`schools/${f.school}`).update({ activeCoordinationId: f.tag + "-coord" });
    await f.put(`students/${f.tag}-legacy`, { id: f.tag + "-legacy", schoolId: f.school, schoolYearId: f.year,
      matricule: "FICTIF", nom: "Fictif", postnom: "Frais", prenom: "Test", sexe: "F", birthDate: "2014-01-01", className: "1ère Sciences", status: "ACTIVE" });
    const auth = await f.token("school_admin");
    // Reproduction exacte du chemin historique : la règle reste restrictive.
    const denied = await fetch(`http://127.0.0.1:8080/v1/projects/demo-acadea/databases/(default)/documents/schoolYears/${f.year}?updateMask.fieldPaths=customFeeKindChoices`, {
      method: "PATCH", headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { customFeeKindChoices: { arrayValue: { values: [{ stringValue: "Libellé refusé" }] } } } }),
    });
    expect(denied.status).toBe(403);
    const beforeYear = (await f.db.doc(`schoolYears/${f.year}`).get()).data()!;
    await context.route("**/*", route => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByPlaceholder("email@ecole.com").fill(f.accounts.school_admin.email);
    await page.getByPlaceholder("Votre mot de passe").fill(f.accounts.school_admin.password);
    await page.getByRole("button", { name: "Se connecter", exact: true }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 40_000 });
    await page.getByRole("button", { name: "Menu", exact: true }).last().click();
    await page.getByRole("button", { name: /Types de frais/ }).click();
    const drawer = page.getByRole("dialog", { name: "Types de frais", exact: true });
    await expect(drawer.getByRole("textbox", { name: /^Montant/ })).toHaveValue("10 000");
    await drawer.getByLabel("Frais", { exact: true }).selectOption("__add_fee__");
    await drawer.getByPlaceholder("Nom du frais").fill("Frais fictif incident");
    let lostKind = false;
    await page.route("**/api/manage-financial-transaction", async route => {
      if (route.request().postDataJSON()?.action !== "add-fee-kind" || lostKind) return route.continue();
      lostKind = true;
      expect((await route.fetch()).status()).toBe(200);
      await route.abort("connectionreset");
    });
    await drawer.getByRole("button", { name: "Ajouter le frais", exact: true }).click();
    await expect(drawer.getByRole("button", { name: "Vérifier l'ajout", exact: true })).toBeVisible();
    await expect(drawer.getByPlaceholder("Nom du frais")).toBeDisabled();
    await drawer.getByRole("button", { name: "Vérifier l'ajout", exact: true }).click();
    await expect.poll(async () => (await f.db.doc(`schoolYears/${f.year}`).get()).data()?.customFeeKindChoices, { timeout: 20000 }).toEqual(["Frais fictif incident"]);
    await expect(drawer.getByLabel("Frais", { exact: true })).toHaveValue("Frais fictif incident");
    const afterYear = (await f.db.doc(`schoolYears/${f.year}`).get()).data()!;
    expect({ ...afterYear, customFeeKindChoices: undefined }).toEqual({ ...beforeYear, customFeeKindChoices: undefined });
    await drawer.getByRole("checkbox", { name: "1ère Sciences", exact: true }).check();
    await drawer.getByRole("textbox", { name: /^Montant/ }).fill("");
    await drawer.getByRole("textbox", { name: /^Montant/ }).pressSequentially("15000");
    await expect(drawer.getByRole("textbox", { name: /^Montant/ })).toHaveValue("15 000");
    await drawer.getByRole("button", { name: "Enregistrer", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Ajouter le type de frais", exact: true });
    await dialog.getByPlaceholder("AJOUTER CE FRAIS").fill("AJOUTER CE FRAIS");
    // Le serveur écrit réellement, seule la réponse est perdue dans le transport.
    let lostRequest: Record<string, unknown> | undefined;
    await page.route("**/api/manage-financial-transaction", async route => {
      if (route.request().postDataJSON()?.action !== "save-fee-types" || lostRequest) return route.continue();
      lostRequest = route.request().postDataJSON();
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("connectionreset");
    });
    await dialog.getByRole("button", { name: "Confirmer l'ajout", exact: true }).click();
    await expect(drawer.getByRole("alert")).toContainText("Confirmation serveur indisponible");
    const fees = () => f.db.collection("feeTypes").where("schoolId", "==", f.school).get();
    expect((await fees()).size).toBe(1);
    await drawer.getByRole("button", { name: "Vérifier l'enregistrement", exact: true }).click();
    await expect(drawer.getByRole("alert")).toHaveCount(0);
    await expect(drawer.getByTestId("fee-groups")).toContainText("Frais fictif incident");
    expect((await fees()).size).toBe(1);
    expect((await fees()).docs[0].data()).toMatchObject({ className: "1ère Sciences", amount: 15000 });
    const result = await page.request.post("/api/manage-financial-transaction", { headers: { Authorization: auth }, data: lostRequest });
    expect(result.status()).toBe(200); expect((await result.json()).idempotent).toBe(true);
    const forbidden = await page.request.post("/api/manage-financial-transaction", { headers: { Authorization: await f.token("teacher") }, data: lostRequest });
    expect(forbidden.status()).toBe(403);
    const invalid = await page.request.post("/api/manage-financial-transaction", { headers: { Authorization: auth }, data: {
      ...lostRequest, requestId: f.tag + "-forbidden", fees: [{ id: f.tag + "-forbidden-fee", name: "Fictif", amount: 15, className: "Classe inexistante" }],
    } });
    expect(invalid.status()).toBe(400);
    const foreignYear = await page.request.post("/api/manage-financial-transaction", { headers: { Authorization: auth }, data: {
      action: "add-fee-kind", schoolYearId: f.tag + "-other-year", requestId: f.tag + "-foreign", name: "Interdit",
    } });
    expect(foreignYear.status()).toBe(409);
    const concurrent = await Promise.all([1, 2].map(i => page.request.post("/api/manage-financial-transaction", { headers: { Authorization: auth }, data: {
      action: "add-fee-kind", schoolYearId: f.year, requestId: f.tag + "-concurrent-" + i, name: "Libellé concurrent",
    } })));
    expect(concurrent.map(r => r.status())).toEqual([200, 200]);
    expect((await f.db.doc(`schoolYears/${f.year}`).get()).data()?.customFeeKindChoices).toEqual(["Frais fictif incident", "Libellé concurrent"]);
    // Confirmed errors must be shown verbatim by the real form, without an
    // optimistic list entry or a misleading global persistence error.
    await drawer.getByLabel("Frais", { exact: true }).selectOption("__add_fee__");
    await drawer.getByPlaceholder("Nom du frais").fill("Année close fictive");
    await page.route("**/api/manage-financial-transaction", async route => {
      const payload = route.request().postDataJSON();
      if (payload?.action !== "add-fee-kind") return route.continue();
      // Attack through the real form/HTTP API: no response is mocked.
      await route.continue({ postData: JSON.stringify({ ...payload, schoolYearId: f.tag + "-other-year" }) });
    });
    await drawer.getByRole("button", { name: "Ajouter le frais", exact: true }).click();
    await expect(drawer.getByRole("alert")).toContainText("L'année sélectionnée n'est plus l'année active");
    expect((await f.db.doc(`schoolYears/${f.year}`).get()).data()?.customFeeKindChoices).not.toContain("Année close fictive");
    await f.db.doc(`schoolYears/${f.year}`).update({ status: "archived" });
    const archived = await page.request.post("/api/manage-financial-transaction", { headers: { Authorization: auth }, data: {
      action: "add-fee-kind", schoolYearId: f.year, requestId: f.tag + "-archived", name: "Interdit",
    } });
    expect(archived.status()).toBe(409);
    expect((await fees()).size).toBe(1);
    console.log("FEE_INCIDENT_AUTHENTICATED_FORM_API_TRANSACTION_REPLAY_PASS");
  } finally { await context.close(); await f.cleanup(); console.log("FEE_INCIDENT_FIXTURES_CLEANED_AND_VERIFIED"); }
});
