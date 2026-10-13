import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { expect, test, type Browser, type Page, type Route } from "@playwright/test";
import provisionHandler from "../api/provision-school-account.js";
import financeHandler from "../api/manage-financial-transaction.js";

const localOrigin = "http://127.0.0.1:5173";
const projectId = "demo-acadea";
const suffix = randomUUID().slice(0, 8);
const schoolId = `e2e-local-payroll-${suffix}`;
const yearId = `${schoolId}__2026-2027`;
const payrollProfileId = `e2e-service-payroll-${suffix}`;
const password = `LocalOnly${randomUUID().replace(/-/g, "").slice(0, 16)}!`;
const app = initializeApp({ projectId });
const auth = getAuth(app);
const db = getFirestore(app);
const accounts = {
  admin: { uid: `e2e-admin-${suffix}`, role: "school_admin", name: "Administrateur Local", email: `admin-${suffix}@local-e2e.invalid` },
  secretary: { uid: `e2e-secretary-${suffix}`, role: "secretary", name: "Secrétaire Local", email: `secretary-${suffix}@local-e2e.invalid` },
  cashier: { uid: `e2e-cashier-${suffix}`, role: "cashier", name: "Caissier Local", email: `cashier-${suffix}@local-e2e.invalid` },
} as const;

function assertLocalOnly() {
  if (process.env.ACADEA_E2E_LOCAL_EMULATORS !== "YES"
    || process.env.VITE_FIREBASE_PROJECT_ID !== projectId
    || process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
    || process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080"
    || process.env.FIREBASE_STORAGE_EMULATOR_HOST !== "127.0.0.1:9199"
    || process.env.ACADEA_E2E_BASE_URL !== localOrigin) {
    throw new Error("E2E personnel réservé aux émulateurs locaux et à 127.0.0.1.");
  }
}

async function respondWithHandler(route: Route) {
  const pathname = new URL(route.request().url()).pathname;
  const handler = pathname === "/api/provision-school-account" ? provisionHandler
    : pathname === "/api/manage-financial-transaction" ? financeHandler : null;
  if (!handler) return route.fulfill({ status: 404, body: "API locale non simulée." });
  const request = route.request();
  let statusCode = 200;
  let contentType = "application/json";
  let responseBody = "";
  const response = {
    get statusCode() { return statusCode; },
    set statusCode(value: number) { statusCode = value; },
    setHeader(_name: string, value: string) { contentType = value; },
    end(value: string) { responseBody = value; },
  };
  await handler({ method: request.method(), headers: request.headers(), body: request.postDataJSON() }, response);
  await route.fulfill({ status: statusCode, contentType, body: responseBody });
}

async function isolatedContext(browser: Browser) {
  const context = await browser.newContext({ baseURL: localOrigin, acceptDownloads: true });
  const remoteRequests: string[] = [];
  const authStatuses: number[] = [];
  const authCodes: string[] = [];
  const authProjects: string[] = [];
  const firestoreProjects: string[] = [];
  context.on("request", (request) => {
    if (new URL(request.url()).host === "127.0.0.1:8080") {
      const project = request.url().match(/projects\/([^/]+)/)?.[1];
      if (project) firestoreProjects.push(project);
    }
  });
  context.on("response", (response) => {
    if (new URL(response.url()).host === "127.0.0.1:9099") {
      authStatuses.push(response.status());
      if (response.status() >= 400) void response.json().then((body: { error?: { message?: string } }) => authCodes.push(body.error?.message ?? "inconnu")).catch(() => authCodes.push("inconnu"));
      else void response.json().then((body: { idToken?: string }) => {
        const payload = body.idToken?.split(".")[1];
        if (payload) authProjects.push((JSON.parse(Buffer.from(payload, "base64url").toString()) as { aud?: string }).aud ?? "inconnu");
      }).catch(() => undefined);
    }
  });
  await context.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseio\.com|firebasestorage\.app)/, (route) => {
    remoteRequests.push(new URL(route.request().url()).hostname);
    return route.abort();
  });
  await context.route("**/api/**", respondWithHandler);
  return { context, remoteRequests, authStatuses, authCodes, authProjects, firestoreProjects };
}

async function login(page: Page, account: typeof accounts[keyof typeof accounts], authStatuses: number[], authCodes: string[], remoteRequests: string[], authProjects: string[], firestoreProjects: string[]) {
  await page.goto("/login", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByPlaceholder("email@ecole.com").fill(account.email);
  await page.getByPlaceholder("Votre mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click({ noWaitAfter: true });
  try { await page.waitForURL(/\/dashboard/, { timeout: 20_000 }); }
  catch {
    await page.getByPlaceholder("Votre mot de passe").fill("");
    throw new Error(`Connexion locale refusée ; Auth HTTP ${authStatuses.join(",") || "aucun"} (${authCodes.join(",") || "aucun code"}), projets Auth ${[...new Set(authProjects)].join(",") || "inconnu"}, Firestore ${[...new Set(firestoreProjects)].join(",") || "inconnu"}, domaines distants bloqués ${remoteRequests.join(",") || "aucun"}.`);
  }
}

test.describe("paie et personnel — navigateur local isolé", () => {
  test.setTimeout(180_000);

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    assertLocalOnly();
    await db.doc(`schools/${schoolId}`).set({ id: schoolId, name: "École locale E2E", acronym: "ELE", status: "active", schoolType: "CTEB et Secondaire", educationLevels: ["CTEB", "Secondaire"], currency: "CDF", activeSchoolYearId: yearId, address: "Adresse fictive" });
    await db.doc(`schoolYears/${yearId}`).set({ id: yearId, schoolId, name: "2026-2027", status: "active", currency: "CDF", startsAt: "2026-09-01", endsAt: "2027-07-31" });
    await db.doc(`payments/${schoolId}-opening-receipt`).set({ id: `${schoolId}-opening-receipt`, schoolId, schoolYearId: yearId,
      currency: "CDF", amount: 600000, paidAt: "2026-10-09", provenance: "e2e-local-fixture" });
    await db.doc(`classes/${schoolId}-humanites`).set({ id: `${schoolId}-humanites`, schoolId, schoolYearId: yearId, name: "1ère Humanité", section: "Secondaire", active: true });
    await db.doc(`personnelProfiles/${payrollProfileId}`).set({ id: payrollProfileId, schoolId, kind: "service", name: "Agent paie local", jobTitle: "Agent de sécurité", status: "active" });
    for (const account of Object.values(accounts)) {
      await auth.createUser({ uid: account.uid, email: account.email, password, displayName: account.name });
      await auth.setCustomUserClaims(account.uid, { role: account.role, schoolId });
      await db.doc(`users/${account.uid}`).set({ id: account.uid, name: account.name, email: account.email, role: account.role, schoolId, activeSchoolYearId: yearId, status: "active", active: true });
      expect((await db.doc(`users/${account.uid}`).get()).exists).toBe(true);
    }
  });

  test.afterAll(async () => {
    test.setTimeout(120_000);
    assertLocalOnly();
    for (const collection of await db.listCollections()) {
      for (const document of (await collection.get()).docs) {
        const data = document.data();
        const rateLimitForFixture = collection.id === "_rateLimits" && typeof data.action === "string"
          && data.schoolIdHash === createHash("sha256").update(`school\u001f${schoolId}\u001f${data.action}`).digest("hex");
        if (data.schoolId === schoolId || document.id === schoolId || document.id === yearId || rateLimitForFixture) await db.recursiveDelete(document.ref);
      }
    }
    for (const user of (await auth.listUsers(1000)).users) {
      if (user.email?.endsWith("@local-e2e.invalid") && user.email.includes(suffix)) await auth.deleteUser(user.uid);
    }
    await deleteApp(app);
  });

  test("Admin et Secrétaire créent des fiches sans compte, et le parcours Parent reste séparé", async ({ browser }) => {
    for (const [kind, account] of [["admin", accounts.admin], ["secretary", accounts.secretary]] as const) {
      const { context, remoteRequests, authStatuses, authCodes, authProjects, firestoreProjects } = await isolatedContext(browser);
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(10_000);
        await login(page, account, authStatuses, authCodes, remoteRequests, authProjects, firestoreProjects);
        await page.getByRole("button", { name: "Menu", exact: true }).last().click();
        if (kind === "admin") await page.getByRole("button", { name: /Personnels/ }).click();
        await page.getByRole("button", { name: "Créer un personnel", exact: true }).click();
        const drawer = page.getByRole("dialog", { name: "Créer un personnel" });
        if (kind === "admin") await drawer.getByLabel("Type de personnel").selectOption("service");
        await expect(drawer.getByRole("button", { name: "Créer le personnel sans compte" })).toBeVisible();
        await drawer.getByLabel("Nom complet").fill(`Vigile ${kind} ${suffix}`);
        await drawer.getByLabel("Téléphone").fill(kind === "admin" ? "+243812345601" : "+243812345602");
        await drawer.getByRole("button", { name: "Créer le personnel sans compte" }).click();
        await expect(drawer.getByRole("status")).toContainText("sans compte Acadéa");
        if (kind === "secretary") {
          await expect(drawer.getByText("Parent", { exact: true })).toHaveCount(0);
          await drawer.getByRole("button", { name: /Fermer/ }).click();
          await page.getByRole("button", { name: "Parents / Tuteurs" }).click();
          await expect(page.getByRole("dialog", { name: "Parents / Tuteurs" })).toBeVisible();
        }
        expect(remoteRequests).toEqual([]);
      } finally { await Promise.race([context.close().catch(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, 5_000))]); }
    }
    const profiles = await db.collection("personnelProfiles").where("schoolId", "==", schoolId).get();
    expect(profiles.size).toBe(3);
    expect(profiles.docs.every((item) => item.data().kind === "service")).toBe(true);
    expect((await auth.listUsers(1000)).users.filter((user) => user.email?.includes(suffix)).length).toBe(3);
  });

  test("Le Secrétaire conserve la création du compte Parent hors du formulaire Personnel", async ({ browser }) => {
    const { context, remoteRequests, authStatuses, authCodes, authProjects, firestoreProjects } = await isolatedContext(browser);
    try {
      const page = await context.newPage();
      await login(page, accounts.secretary, authStatuses, authCodes, remoteRequests, authProjects, firestoreProjects);
      await page.getByRole("button", { name: "Menu", exact: true }).last().click();
      await page.getByRole("button", { name: "Parents / Tuteurs" }).click();
      await page.getByRole("dialog", { name: "Parents / Tuteurs" }).getByRole("button", { name: "Créer un parent" }).click();
      const drawer = page.getByRole("dialog", { name: "Créer un parent" });
      await expect(drawer.getByLabel("Mot de passe temporaire")).toBeVisible();
      await drawer.getByLabel("Nom complet").fill(`Parent local ${suffix}`);
      await drawer.getByLabel("Téléphone").fill("+243812345603");
      await drawer.getByLabel("Adresse e-mail").fill(`parent-${suffix}@local-e2e.invalid`);
      await drawer.getByLabel("Mot de passe temporaire").fill(password);
      await drawer.getByRole("button", { name: "Enregistrer" }).click();
      await expect(drawer.getByText("Compte parent créé avec succès.", { exact: false })).toBeVisible();
      const created = await auth.getUserByEmail(`parent-${suffix}@local-e2e.invalid`);
      expect((await db.doc(`users/${created.uid}`).get()).data()?.role).toBe("parent");
      expect((await db.collection("parents").where("userId", "==", created.uid).get()).size).toBe(1);
      expect(remoteRequests).toEqual([]);
    } finally { await context.close(); }
  });

  for (const width of [390, 768, 1440]) test(`Les trois actions Personnel restent contenues à ${width} px`, async ({ browser }) => {
    const { context, remoteRequests, authStatuses, authCodes, authProjects, firestoreProjects } = await isolatedContext(browser);
    try {
      const page = await context.newPage();
      await page.setViewportSize({ width, height: 844 });
      await login(page, accounts.admin, authStatuses, authCodes, remoteRequests, authProjects, firestoreProjects);
      await page.getByRole("button", { name: "Menu", exact: true }).last().click();
      await page.getByRole("button", { name: /Personnels/ }).click();
      const drawer = page.getByRole("dialog", { name: "Personnels" });
      const actions = [drawer.getByRole("button", { name: "Créer un personnel" }), drawer.getByRole("button", { name: /Statut :/ }), drawer.getByRole("button", { name: "Imprimer", exact: true })];
      const boxes = [];
      for (const action of actions) {
        await expect(action).toBeVisible();
        boxes.push(await action.boundingBox());
      }
      expect(boxes.every((box) => box && box.width > 75 && box.x >= 0 && box.x + box.width <= width)).toBe(true);
      expect(Math.max(...boxes.map((box) => box!.y)) - Math.min(...boxes.map((box) => box!.y))).toBeLessThan(4);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(remoteRequests).toEqual([]);
    } finally { await context.close(); }
  });

  test("Salaire/Prime, historique et options scolaires restent utilisables aux trois largeurs", async ({ browser }) => {
    for (const account of [accounts.admin, accounts.secretary, accounts.cashier]) {
      const { context, remoteRequests, authStatuses, authCodes, authProjects, firestoreProjects } = await isolatedContext(browser);
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(10_000);
        await login(page, account, authStatuses, authCodes, remoteRequests, authProjects, firestoreProjects);
        await page.getByRole("button", { name: "Menu", exact: true }).last().click();
        const payroll = page.getByRole("button", { name: /Salaire\/Prime/ }).first();
        await expect(payroll).toBeVisible();
        await payroll.click();
        const drawer = page.getByRole("dialog", { name: "Salaire/Prime" });
        await expect(drawer).toBeVisible();
        for (const width of [1440, 768, 390]) {
          await page.setViewportSize({ width, height: 900 });
          const box = await drawer.boundingBox();
          expect(box).not.toBeNull();
          expect(box!.x).toBeGreaterThanOrEqual(-1);
          expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
        }
        await drawer.getByRole("button", { name: "Fermer mes salaires et primes" }).click();
        await expect(drawer).toBeHidden();
        if (account.role === "school_admin") {
          await page.getByRole("button", { name: /Paramètres école/ }).click();
          const school = page.getByRole("dialog", { name: "Paramètres école" });
          await expect(school).toBeVisible();
          await school.getByPlaceholder("Nouvelle option").fill(`Option locale ${suffix}`);
          await school.getByRole("button", { name: "Ajouter", exact: true }).click();
          const optionConfirm = school.getByRole("group", { name: "Confirmer l'ajout de l'option scolaire" });
          await expect(optionConfirm.getByRole("button", { name: "Confirmer l'ajout" })).toBeDisabled();
          await optionConfirm.getByLabel("Phrase de confirmation de l'ajout de l'option").fill("AJOUTER CETTE OPTION");
          await expect(optionConfirm.getByRole("button", { name: "Confirmer l'ajout" })).toBeEnabled();
          for (const width of [1440, 768, 390]) {
            await page.setViewportSize({ width, height: 900 });
            const box = await school.boundingBox();
            expect(box).not.toBeNull();
            expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
          }
          await optionConfirm.getByRole("button", { name: "Annuler" }).click();
          await school.getByRole("button", { name: "Fermer Paramètres école" }).click();
        }
        if (account.role === "school_admin" || account.role === "cashier") {
          await page.getByRole("button", { name: "Contrôle", exact: true }).click();
          await page.getByRole("button", { name: "Historique", exact: true }).click();
          const history = page.getByRole("dialog", { name: "Historique" });
          await history.getByLabel("Type d'historique").selectOption("payroll");
          await expect(history.getByLabel("Type d'historique")).toHaveValue("payroll");
          for (const width of [1440, 768, 390]) {
            await page.setViewportSize({ width, height: 900 });
            const box = await history.boundingBox();
            expect(box).not.toBeNull();
            expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
          }
          await history.getByRole("button", { name: "Fermer l'historique" }).click();
        }
        if (account.role === "school_admin" || account.role === "secretary") {
          await page.getByRole("button", { name: "Élèves", exact: true }).last().click();
          await page.getByRole("button", { name: "Ajouter un élève", exact: true }).click();
          const student = page.getByRole("dialog", { name: "Ajouter un élève" });
          await expect(student).toBeVisible();
          await student.locator('select:has(option[value="1ère Humanité"])').selectOption("1ère Humanité");
          await student.locator('select:has(option[value="__add_option__"])').selectOption("__add_option__");
          await student.getByPlaceholder("Nom de l'option").fill(`Option locale ${suffix}`);
          await student.getByRole("button", { name: "Ajouter", exact: true }).click();
          const optionConfirm = student.getByRole("group", { name: "Confirmer l'ajout de l'option scolaire" });
          await expect(optionConfirm.getByRole("button", { name: "Confirmer l'ajout" })).toBeDisabled();
          await optionConfirm.getByLabel("Phrase de confirmation de l'ajout de l'option").fill("AJOUTER CETTE OPTION");
          await expect(optionConfirm.getByRole("button", { name: "Confirmer l'ajout" })).toBeEnabled();
          for (const width of [1440, 768, 390]) {
            await page.setViewportSize({ width, height: 900 });
            const box = await student.boundingBox();
            expect(box).not.toBeNull();
            expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
          }
          await optionConfirm.getByRole("button", { name: "Annuler" }).click();
          await student.getByRole("button", { name: /Fermer/ }).first().click();
        }
        expect(remoteRequests).toEqual([]);
      } finally { await context.close(); }
    }
  });

  test("Deux avances, récupérations sur salaire et prime, PDF et dépense nette unique", async ({ browser }) => {
    const { context, remoteRequests, authStatuses, authCodes, authProjects, firestoreProjects } = await isolatedContext(browser);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      await login(page, accounts.cashier, authStatuses, authCodes, remoteRequests, authProjects, firestoreProjects);
      console.info("E2E paie : connexion Caissier prête");
      await page.getByRole("button", { name: "Contrôle", exact: true }).click();
      console.info("E2E paie : contrôle ouvert");
      await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
      const drawer = page.getByRole("dialog", { name: "Enregistrer" });
      await drawer.getByLabel("Type d'enregistrement").selectOption("personnel");
      const form = drawer.locator("form").filter({ hasText: "Bénéficiaire" });
      const profile = await db.doc(`personnelProfiles/${payrollProfileId}`).get();
      expect(profile).toBeTruthy();
      await form.getByLabel("Bénéficiaire").selectOption(profile!.id);
      console.info("E2E paie : bénéficiaire sélectionné");
      await form.getByLabel("Nature").selectOption("advance");
      for (const amount of [50000, 80000]) {
        await form.getByLabel("Avance versée").fill(String(amount));
        await expect(form.getByLabel("Avance versée")).toHaveValue(amount.toLocaleString("fr-FR").replace(/\u202f/g, " "));
        await form.getByLabel("Date réelle du paiement").fill("2026-10-09");
        await form.getByRole("button", { name: "Enregistrer le paiement personnel" }).click();
        await expect(drawer).toBeHidden();
        await expect(page.getByRole("status").filter({ hasText: "Paiement du personnel enregistré :" })).toBeVisible();
        await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
        await drawer.getByLabel("Type d'enregistrement").selectOption("personnel");
        await expect(form.getByLabel("Bénéficiaire")).toHaveValue("");
        await form.getByLabel("Bénéficiaire").selectOption(profile!.id);
        await form.getByLabel("Nature").selectOption("advance");
      }
      let payments = (await db.collection("personnelPayments").where("beneficiaryId", "==", profile!.id).get()).docs.map((doc) => doc.data());
      console.info("E2E paie : deux avances soumises");
      expect(payments.filter((item) => item.kind === "advance").map((item) => item.amount).sort((a, b) => a - b)).toEqual([50000, 80000]);
      await form.getByLabel("Nature").selectOption("salary");
      await form.getByLabel("Mois concerné").selectOption("9");
      await form.getByLabel("Année concernée").fill("2026");
      await form.getByLabel("Date réelle du paiement").fill("2026-10-09");
      await form.getByLabel("Salaire brut").fill("500000");
      await expect(form.getByLabel("Salaire brut")).toHaveValue("500 000");
      await expect(form.getByText("Avances récupérables :", { exact: false })).toContainText("130 000");
      const advanceRows = form.locator("section div.border-t");
      await expect(advanceRows).toHaveCount(2);
      const smallAdvance = payments.find((item) => item.kind === "advance" && item.amount === 50000);
      const largeAdvance = payments.find((item) => item.kind === "advance" && item.amount === 80000);
      expect(smallAdvance && largeAdvance).toBeTruthy();
      await advanceRows.filter({ hasText: smallAdvance!.reference }).getByRole("checkbox").check();
      const largeAdvanceRow = advanceRows.filter({ hasText: largeAdvance!.reference });
      await largeAdvanceRow.getByRole("checkbox").check();
      await largeAdvanceRow.getByLabel("Montant à récupérer").fill("30000");
      await form.getByLabel("Autre retenue").fill("20000");
      await form.getByLabel("Motif de retenue").fill("Retenue fictive E2E");
      await form.getByLabel("CNSS (saisie manuelle)").fill("15000");
      await form.getByLabel("Impôt (saisie manuelle)").fill("25000");
      await expect(form.getByText("Net à payer :", { exact: false })).toContainText(/360\s*000/);
      await form.getByRole("button", { name: "Enregistrer le paiement personnel" }).click();
      await expect(drawer).toBeHidden();
      await expect(page.getByRole("status").filter({ hasText: "Paiement du personnel enregistré :" })).toBeVisible();
      console.info("E2E paie : salaire soumis");
      const pdfButton = page.getByRole("status").filter({ hasText: "Paiement du personnel enregistré :" }).getByRole("button", { name: "Télécharger le bulletin de paie" });
      await pdfButton.click();
      await expect(page.locator("[data-pdf-download]")).toHaveAttribute("aria-disabled", "false", { timeout: 30_000 });
      await expect(page.locator("[data-pdf-download]")).toHaveAttribute("download", /bulletin-paie/);
      const [download] = await Promise.all([page.waitForEvent("download"), page.locator("[data-pdf-download]").click()]);
      expect(download.suggestedFilename()).toMatch(/\.pdf$/);
      expect((await readFile(await download.path())).subarray(0, 5).toString()).toBe("%PDF-");
      await page.locator("[data-pdf-close]").click();
      console.info("E2E paie : bulletin prêt");
      payments = (await db.collection("personnelPayments").where("beneficiaryId", "==", profile!.id).get()).docs.map((doc) => doc.data());
      const salary = payments.find((item) => item.kind === "salary");
      expect(salary).toMatchObject({ periodMonth: 9, periodYear: 2026, paidAt: "2026-10-09", recoveredAmount: 80000, netPaid: 360000 });
      await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
      await drawer.getByLabel("Type d'enregistrement").selectOption("personnel");
      await expect(form.getByLabel("Bénéficiaire")).toHaveValue("");
      await form.getByLabel("Bénéficiaire").selectOption(profile!.id);
      await form.getByLabel("Nature").selectOption("bonus");
      await form.getByLabel("Prime brute").fill("100000");
      await expect(advanceRows).toHaveCount(1);
      await advanceRows.first().getByRole("checkbox").check();
      await expect(form.getByText("Net à payer :", { exact: false })).toContainText(/50\s*000/);
      await form.getByRole("button", { name: "Enregistrer le paiement personnel" }).click();
      await expect(drawer).toBeHidden();
      await expect(page.getByRole("status").filter({ hasText: "Paiement du personnel enregistré :" })).toBeVisible();
      console.info("E2E paie : prime soumise");
      payments = (await db.collection("personnelPayments").where("beneficiaryId", "==", profile!.id).get()).docs.map((doc) => doc.data());
      expect(payments).toHaveLength(4);
      expect(payments.find((item) => item.kind === "bonus")).toMatchObject({ recoveredAmount: 50000, netPaid: 50000 });
      expect(payments.filter((item) => item.kind === "advance").every((item) => item.recoveredAmount === item.amount)).toBe(true);
      const expenses = (await db.collection("expenses").where("schoolId", "==", schoolId).get()).docs.map((doc) => doc.data());
      expect(expenses).toHaveLength(4);
      expect(expenses.reduce((sum, item) => sum + item.amount, 0)).toBe(540000);
      expect(expenses.every((item) => item.personnelPaymentId && item.provenance === "personnel-payroll")).toBe(true);
      expect(new Set(expenses.map((item) => item.personnelPaymentId)).size).toBe(4);
      const ownPayroll = await page.evaluate(async () => {
        const modulePath = "/src/services/auth.ts";
        const { getCurrentFirebaseIdToken } = await import(modulePath);
        const response = await fetch("/api/manage-financial-transaction", { method: "POST", headers: { Authorization: `Bearer ${await getCurrentFirebaseIdToken()}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "list-own-payroll" }) });
        const result = await response.json() as { payments?: unknown[] };
        return { status: response.status, count: result.payments?.length };
      });
      expect(ownPayroll).toEqual({ status: 200, count: 0 });
      const secretary = await isolatedContext(browser);
      try {
        const secretaryPage = await secretary.context.newPage();
        await login(secretaryPage, accounts.secretary, secretary.authStatuses, secretary.authCodes, secretary.remoteRequests, secretary.authProjects, secretary.firestoreProjects);
        const privateListStatus = await secretaryPage.evaluate(async (beneficiaryId) => {
          const modulePath = "/src/services/auth.ts";
          const { getCurrentFirebaseIdToken } = await import(modulePath);
          const response = await fetch("/api/manage-financial-transaction", { method: "POST", headers: { Authorization: `Bearer ${await getCurrentFirebaseIdToken()}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "list-personnel-payments", beneficiaryId }) });
          return response.status;
        }, profile!.id);
        expect(privateListStatus).toBe(403);
        expect(secretary.remoteRequests).toEqual([]);
      } finally { await secretary.context.close(); }
      expect(remoteRequests).toEqual([]);
    } finally { await Promise.race([context.close().catch(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, 5_000))]); }
  });

  test("la caisse bloque le dépassement, reste lisible aux trois largeurs et rafraîchit un solde concurrent", async ({ browser }) => {
    const [receipts, priorExpenses] = await Promise.all([
      db.collection("payments").where("schoolId", "==", schoolId).get(), db.collection("expenses").where("schoolId", "==", schoolId).get(),
    ]);
    const available = receipts.docs.reduce((sum, item) => sum + Number(item.data().amount || 0), 0)
      - priorExpenses.docs.reduce((sum, item) => sum + Number(item.data().amount || 0), 0);
    if (available > 60000) await db.doc(`expenses/${schoolId}-balance-fixture`).set({ schoolId, schoolYearId: yearId, currency: "CDF",
      amount: available - 60000, category: "Fournitures", description: "Dépense fictive de cadrage", spentAt: "2026-10-13" });
    if (available < 60000) await db.doc(`payments/${schoolId}-balance-fixture`).set({ schoolId, schoolYearId: yearId, currency: "CDF",
      amount: 60000 - available, paidAt: "2026-10-13", provenance: "e2e-local-fixture" });
    const { context, remoteRequests, authStatuses, authCodes, authProjects, firestoreProjects } = await isolatedContext(browser);
    try {
      const page = await context.newPage();
      await login(page, accounts.cashier, authStatuses, authCodes, remoteRequests, authProjects, firestoreProjects);
      await page.getByRole("button", { name: "Contrôle", exact: true }).click();
      await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
      const drawer = page.getByRole("dialog", { name: "Enregistrer" });
      await drawer.getByLabel("Type d'enregistrement").selectOption("personnel");
      const form = drawer.locator("form").filter({ hasText: "Bénéficiaire" });
      await form.getByLabel("Bénéficiaire").selectOption(payrollProfileId);
      await form.getByLabel("Nature").selectOption("bonus");
      await form.getByLabel("Prime brute").fill("70000");
      const cash = form.getByLabel("Solde de caisse");
      await expect(cash).toContainText(/60\s*000/);
      await expect(cash).toContainText(/10\s*000/);
      await expect(cash.getByRole("alert")).toContainText("solde de caisse insuffisant");
      await expect(form.getByRole("button", { name: "Enregistrer le paiement personnel" })).toBeDisabled();
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 900 });
        const box = await cash.boundingBox();
        expect(box && box.x >= -1 && box.x + box.width <= width + 1).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      const directRefusal = await page.evaluate(async (input) => {
        const modulePath = "/src/services/auth.ts";
        const { getCurrentFirebaseIdToken } = await import(modulePath);
        const response = await fetch("/api/manage-financial-transaction", { method: "POST", headers: {
          Authorization: `Bearer ${await getCurrentFirebaseIdToken()}`, "Content-Type": "application/json",
        }, body: JSON.stringify(input) });
        const payload = await response.json() as { code?: string };
        return { status: response.status, code: payload.code };
      }, { action: "create-personnel-payment", schoolYearId: yearId, beneficiaryId: payrollProfileId, kind: "bonus", periodMonth: 10,
        periodYear: 2026, paidAt: "2026-10-13", amount: 70000, recoveries: [], deduction: 0, deductionReason: "", cnss: 0, tax: 0,
        description: "Test refus direct", clientRequestId: `e2e-cash-direct-${suffix}` });
      expect(directRefusal).toEqual({ status: 409, code: "insufficient-funds" });
      await form.getByLabel("Prime brute").fill("20000");
      await db.doc(`expenses/${schoolId}-concurrent-fixture`).set({ schoolId, schoolYearId: yearId, currency: "CDF", amount: 30000,
        category: "Fournitures", description: "Dépense concurrente fictive", spentAt: "2026-10-13" });
      await form.getByRole("button", { name: "Enregistrer le paiement personnel" }).click();
      await expect(form.getByRole("alert")).toContainText("solde de caisse a changé");
      await expect(cash).toContainText(/30\s*000/);
      await form.getByRole("button", { name: "Enregistrer le paiement personnel" }).click();
      await expect(drawer).toBeHidden();
      expect((await db.collection("expenses").where("schoolId", "==", schoolId).get()).docs.some((item) => item.data().amount === 20000)).toBe(true);
      expect(remoteRequests).toEqual([]);
    } finally { await context.close(); }
  });

  test("L'historique paie permet le PDF et réserve la correction confirmée à l'Administrateur", async ({ browser }) => {
    const paymentId = `e2e-correction-${suffix}`;
    const expenseId = `e2e-correction-expense-${suffix}`;
    const createdAt = "2026-10-11T10:00:00.000Z";
    await db.doc(`personnelPayments/${paymentId}`).set({
      id: paymentId, schoolId, schoolYearId: yearId, beneficiaryId: payrollProfileId,
      beneficiaryName: "Agent paie local", beneficiaryJobTitle: "Agent de sécurité", beneficiaryHasAccount: false,
      kind: "salary", periodMonth: 9, periodYear: 2026, paidAt: "2026-10-09", currency: "CDF", reference: `PAY-E2E-${suffix}`,
      amount: 100000, recoveredAmount: 0, recoveries: [], deduction: 0, deductionReason: "", cnss: 0, tax: 0,
      netPaid: 100000, description: "", expenseId, createdAt, createdBy: accounts.cashier.uid,
    });
    await db.doc(`expenses/${expenseId}`).set({
      id: expenseId, schoolId, schoolYearId: yearId, amount: 100000, category: "Salaire", description: "Salaire E2E local",
      beneficiary: "Agent paie local", paymentMethod: "Paiement personnel", reference: `PAY-E2E-${suffix}`,
      spentAt: "2026-10-09", createdAt, updatedAt: createdAt, createdBy: accounts.cashier.uid, updatedBy: accounts.cashier.uid,
      provenance: "personnel-payroll", personnelPaymentId: paymentId,
    });
    for (const account of [accounts.cashier, accounts.admin]) {
      const { context, remoteRequests, authStatuses, authCodes, authProjects, firestoreProjects } = await isolatedContext(browser);
      try {
        const page = await context.newPage();
        await login(page, account, authStatuses, authCodes, remoteRequests, authProjects, firestoreProjects);
        await page.getByRole("button", { name: "Contrôle", exact: true }).click();
        await page.getByRole("button", { name: "Historique", exact: true }).click();
        const history = page.getByRole("dialog", { name: "Historique" });
        await history.getByLabel("Type d'historique").selectOption("payroll");
        const line = history.getByRole("article").filter({ hasText: `PAY-E2E-${suffix}` });
        await expect(line).toBeVisible({ timeout: 20_000 });
        await expect(line.getByRole("button", { name: /Télécharger le bulletin PDF/ })).toBeEnabled();
        await expect(line.getByRole("button", { name: /Modifier le salaire/ })).toHaveCount(account.role === "school_admin" ? 1 : 0);
        for (const width of [1440, 768, 390]) {
          await page.setViewportSize({ width, height: 900 });
          const box = await line.boundingBox();
          expect(box && box.x >= -1 && box.x + box.width <= width + 1).toBe(true);
          const actions = await line.getByRole("button").all();
          const actionBoxes = await Promise.all(actions.map((action) => action.boundingBox()));
          expect(actionBoxes.every((actionBox) => actionBox && box && actionBox.x > box.x + box.width / 2 && actionBox.y >= box.y && actionBox.y + actionBox.height <= box.y + box.height)).toBe(true);
          if (actionBoxes.length === 2) expect(Math.abs(actionBoxes[0]!.y - actionBoxes[1]!.y)).toBeLessThan(2);
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
          await line.screenshot({ path: test.info().outputPath(account.role + "-historique-" + width + ".png") });
        }
        await line.getByRole("button", { name: /Télécharger le bulletin PDF/ }).click();
        await expect(page.locator("[data-pdf-download]")).toHaveAttribute("aria-disabled", "false", { timeout: 30_000 });
        const [download] = await Promise.all([page.waitForEvent("download"), page.locator("[data-pdf-download]").click()]);
        expect((await readFile(await download.path())).subarray(0, 5).toString()).toBe("%PDF-");
        await page.locator("[data-pdf-close]").click();
        if (account.role === "school_admin") {
          await line.getByRole("button", { name: /Modifier le salaire/ }).click();
          await history.getByLabel("Salaire brut").fill("110000");
          await history.getByLabel("CNSS (saisie manuelle)").fill("10000");
          await history.getByLabel("Impôt (saisie manuelle)").fill("5000");
          await expect(history.getByText("Net à payer :", { exact: false })).toContainText(/95\s*000/);
          await history.getByLabel("Raison obligatoire").fill("Correction E2E locale");
          await expect(history.getByRole("button", { name: "Enregistrer la modification" })).toBeDisabled();
          await history.getByLabel(/Saisissez exactement MODIFIER CE SALAIRE/).fill("MODIFIER CE SALAIRE");
          await history.getByRole("button", { name: "Enregistrer la modification" }).click();
          await expect(history.getByRole("status")).toContainText("Modification enregistrée");
          expect((await db.doc(`personnelPayments/${paymentId}`).get()).data()).toMatchObject({ amount: 110000, cnss: 10000, tax: 5000, netPaid: 95000 });
          expect((await db.doc(`expenses/${expenseId}`).get()).data()?.amount).toBe(95000);
          await line.getByRole("button", { name: /Télécharger le bulletin PDF/ }).click();
          await expect(page.locator("[data-pdf-download]")).toHaveAttribute("aria-disabled", "false", { timeout: 30_000 });
          const [updatedDownload] = await Promise.all([page.waitForEvent("download"), page.locator("[data-pdf-download]").click()]);
          await writeFile(test.info().outputPath("bulletin-corrige.pdf"), await readFile(await updatedDownload.path()));
          await page.locator("[data-pdf-close]").click();
        }
        expect(remoteRequests).toEqual([]);
      } finally { await context.close(); }
    }
  });
});
