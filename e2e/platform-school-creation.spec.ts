import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";

const superAdminEmail = process.env.E2E_SUPER_ADMIN_EMAIL;
const superAdminPassword = process.env.E2E_SUPER_ADMIN_PASSWORD;
const stagingProjectId = "acadea-staging";

test.skip(!superAdminEmail || !superAdminPassword, "Identifiants Super Administrateur Staging manquants.");
test.setTimeout(600_000);
test.use({ actionTimeout: 15_000 });

async function login(page: Page, email: string, password: string, route: RegExp) {
  await page.goto("/");
  await page.getByPlaceholder("email@ecole.com").fill(email);
  await page.getByPlaceholder("Votre mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(route, { timeout: 60_000 });
}

async function currentIdToken(page: Page) {
  return page.evaluate(async () => new Promise<string>((resolve, reject) => {
    const request = indexedDB.open("firebaseLocalStorageDb");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("firebaseLocalStorage", "readonly");
      const values = transaction.objectStore("firebaseLocalStorage").getAll();
      values.onerror = () => reject(values.error);
      values.onsuccess = () => {
        const token = values.result
          .map((entry) => entry?.value?.stsTokenManager?.accessToken)
          .find((value) => typeof value === "string");
        database.close();
        if (token) resolve(token);
        else reject(new Error("Jeton Staging Firebase introuvable."));
      };
    };
  }));
}

async function deleteSchool(page: Page, baseURL: string, token: string, schoolId: string) {
  const response = await page.request.post(new URL("/api/manage-school", baseURL).toString(), {
    headers: { Authorization: `Bearer ${token}` },
    data: { action: "delete", schoolId, confirmation: "SUPPRIMER ECOLE" },
    timeout: 120_000,
  });
  if (response.status() === 429) {
    const { config } = await import("dotenv");
    config({ path: ".env.staging.local", quiet: true });
    const rawCredential = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!rawCredential) throw new Error("Nettoyage E2E bloqué : credential Firebase Admin Staging absent.");
    const credential = JSON.parse(rawCredential) as { project_id?: string };
    expect(credential.project_id).toBe(stagingProjectId);
    const { initAdmin } = await import("../api/_lib/firebaseAdmin.js");
    const { deleteSchoolCompletely } = await import("../api/_lib/schoolDeletion.js");
    const { auth, db, bucket } = initAdmin();
    const schoolSnapshot = await db.doc(`schools/${schoolId}`).get();
    if (schoolSnapshot.exists) {
      await deleteSchoolCompletely({
        auth,
        db,
        bucket,
        schoolId,
        schoolData: schoolSnapshot.data(),
        actor: { uid: "codex-staging-e2e-cleanup", role: "super_admin" },
      });
    }
    return;
  }
  expect(response.status(), await response.text()).toBe(200);
}

async function cleanupPreviousFixtureSchools(page: Page, baseURL: string, token: string) {
  const response = await page.request.get(
    `https://firestore.googleapis.com/v1/projects/${stagingProjectId}/databases/(default)/documents/schools?pageSize=300`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(response.status(), await response.text()).toBe(200);
  const payload = await response.json() as {
    documents?: Array<{ name?: string; fields?: { name?: { stringValue?: string } } }>;
  };
  const fixtureIds = (payload.documents ?? [])
    .filter((document) => /^École (primaire|secondaire) E2E /.test(document.fields?.name?.stringValue ?? ""))
    .map((document) => document.name?.split("/").at(-1) ?? "")
    .filter(Boolean);
  for (const schoolId of fixtureIds) await deleteSchool(page, baseURL, token, schoolId);
}

async function openStudentForm(page: Page) {
  await page.getByRole("button", { name: "Élèves", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter un élève", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Ajouter un élève" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function assertOnlyExpectedSchoolOption(dialog: Locator, expected: string) {
  const optionSelect = dialog.getByRole("combobox", { name: "Option", exact: true });
  await expect(optionSelect).toContainText(expected);
  const values = await optionSelect.locator("option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  expect(values.filter((value) => value && value !== "__add_option__")).toEqual([expected]);
}

async function closeContextSafely(context: Awaited<ReturnType<Browser["newContext"]>> | undefined) {
  await context?.close().catch(() => undefined);
}

test("propage le niveau canonique et les options jusqu'aux formulaires Admin et Secrétaire", async ({ browser, baseURL }) => {
  const marker = Date.now().toString();
  const schoolName = `École secondaire E2E ${marker}`;
  const adminEmail = `admin.secondaire.${marker}@staging.acadea.test`;
  const adminPassword = "AcadeaE2E2026!";
  const secretaryEmail = `secretaire.secondaire.${marker}@staging.acadea.test`;
  const secretaryPassword = "AcadeaE2E2026!";
  const expectedOption = "Sciences";
  const createdSchoolIds: string[] = [];
  let superContext: Awaited<ReturnType<Browser["newContext"]>> | undefined;
  let adminContext: Awaited<ReturnType<Browser["newContext"]>> | undefined;
  let secretaryContext: Awaited<ReturnType<Browser["newContext"]>> | undefined;
  let superPage: Page | undefined;
  let superToken = "";

  try {
    superContext = await browser.newContext({ baseURL });
    superPage = await superContext.newPage();
    await login(superPage, superAdminEmail!, superAdminPassword!, /\/platform/);
    superToken = await currentIdToken(superPage);
    await test.step("nettoyer les éventuelles fixtures d'une exécution interrompue", async () => {
      await cleanupPreviousFixtureSchools(superPage!, baseURL!, superToken);
    });

    await superPage.getByRole("button", { name: "Menu", exact: true }).click();
    await superPage.getByRole("button", { name: /^Créer une école/ }).click();
    const drawer = superPage.getByRole("dialog", { name: "Créer une école" });
    await expect(drawer).toBeVisible();
    const level = drawer.locator("label").filter({ hasText: "Niveau de l'école" }).locator("select");
    await expect(level.locator("option")).toHaveCount(7);
    await level.selectOption("Primaire uniquement");
    await expect(drawer.getByRole("group", { name: "Options scolaires" })).toHaveCount(0);
    await level.selectOption("Secondaire");
    await expect(drawer.getByRole("group", { name: "Options scolaires" })).toBeVisible();
    await level.selectOption("Secondaire uniquement");
    await expect(drawer.getByRole("group", { name: "Options scolaires" })).toBeVisible();

    await drawer.getByLabel("Nom de l'école").fill(schoolName);
    await drawer.getByLabel("Nom de l'Administrateur").fill("Administrateur secondaire E2E");
    await drawer.getByLabel("Email admin école").fill(adminEmail);
    await drawer.getByLabel("Mot de passe admin").fill(adminPassword);
    await drawer.getByLabel(expectedOption, { exact: true }).check();

    const responsePromise = superPage.waitForResponse((response) => response.url().includes("/api/provision-school-admin") && response.request().method() === "POST");
    await drawer.getByRole("button", { name: "Créer", exact: true }).click();
    const response = await responsePromise;
    expect(response.status(), await response.text()).toBe(200);
    const provisioned = await response.json() as {
      school: { id: string; schoolType: string; educationLevels: string[]; schoolOptions: string[] };
      schoolYear: { id: string };
    };
    createdSchoolIds.push(provisioned.school.id);
    expect(provisioned.school).toMatchObject({
      schoolType: "Secondaire uniquement",
      educationLevels: ["Secondaire"],
      schoolOptions: [expectedOption],
    });

    adminContext = await browser.newContext({ baseURL });
    const adminPage = await adminContext.newPage();
    await login(adminPage, adminEmail, adminPassword, /\/dashboard/);
    await adminPage.getByRole("button", { name: "Menu", exact: true }).click();
    await adminPage.getByRole("button", { name: /^Paramètres école/ }).click();
    const settings = adminPage.getByRole("dialog", { name: "Paramètres école" });
    await expect(settings.getByText(expectedOption, { exact: true })).toBeVisible();
    await settings.getByRole("button", { name: /Fermer/ }).click();

    const adminStudentForm = await openStudentForm(adminPage);
    await assertOnlyExpectedSchoolOption(adminStudentForm, expectedOption);
    await adminStudentForm.getByRole("button", { name: /Fermer/ }).click();

    const adminToken = await currentIdToken(adminPage);
    const secretaryResponse = await adminPage.request.post(new URL("/api/provision-school-account", baseURL!).toString(), {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        role: "secretary",
        schoolId: provisioned.school.id,
        schoolYearId: provisioned.schoolYear.id,
        name: "Secrétaire secondaire E2E",
        email: secretaryEmail,
        password: secretaryPassword,
        phone: "+243810000000",
        section: "Secondaire",
        sectionIds: ["Secondaire"],
      },
    });
    expect(secretaryResponse.status(), await secretaryResponse.text()).toBe(200);

    secretaryContext = await browser.newContext({ baseURL });
    const secretaryPage = await secretaryContext.newPage();
    await login(secretaryPage, secretaryEmail, secretaryPassword, /\/dashboard/);
    const secretaryStudentForm = await openStudentForm(secretaryPage);
    await assertOnlyExpectedSchoolOption(secretaryStudentForm, expectedOption);
  } finally {
    if (superPage && superToken) {
      for (const schoolId of createdSchoolIds.reverse()) {
        await deleteSchool(superPage, baseURL!, superToken, schoolId);
      }
    }
    await closeContextSafely(secretaryContext);
    await closeContextSafely(adminContext);
    await closeContextSafely(superContext);
  }
});
