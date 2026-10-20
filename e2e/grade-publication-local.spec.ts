import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { expect, test, type Browser, type Page } from "@playwright/test";
import handler from "../api/manage-teacher-grading.js";
import publishedHandler from "../api/manage-teacher-availability-request.js";
import { executeTeacherGrading } from "../api/_lib/teacherGrading.js";
import { managePersonnel } from "../api/provision-school-account.js";

// No remote credentials or session injection: all logins use the real login
// form and the Auth emulator. The actual API handler validates the ID token.
const origin = "http://127.0.0.1:5173";
const tag = `e2e-publication-${randomUUID().slice(0, 8)}`;
const schoolId = `${tag}-school`, foreign = `${tag}-foreign`;
const year = `${schoolId}__2027-2028`, archived = `${schoolId}__2026-2027`;
const classId = `${tag}-class`, fee = `${tag}-fee`;
const roles = ["study_director", "teacher", "parent", "cashier", "secretary", "discipline_director"] as const;
const password = `LocalOnly-${randomUUID()}!`;
const uid = (role: string) => `${tag}-${role}`;
const student = (index: number) => `${tag}-child-${index}`;
const subject = (index: number) => `${tag}-subject-${index}`;
const teacher = (index: number) => `${tag}-profile-${index}`;
const assignment = (index: number) => `${tag}-assignment-${index}`;
const app = initializeApp({ projectId: "demo-acadea" });
const db = getFirestore(app), auth = getAuth(app);
const createdAuth: string[] = [];
const paths = new Set<string>();
const collections = ["schoolYears", "users", "teachers", "classes", "subjects", "students", "parents", "pedagogicalAssignments", "classTitulars", "courseGradingConfigs", "gradeEntries", "feeTypes", "payments", "expenses", "disciplineSanctions", "gradePublicationRuns", "publishedGradeResults", "notifications", "auditLogs"];
function guard() {
  if (process.env.ACADEA_E2E_LOCAL_EMULATORS !== "YES" || process.env.VITE_FIREBASE_PROJECT_ID !== "demo-acadea"
    || process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" || process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
    || process.env.FIREBASE_STORAGE_EMULATOR_HOST !== "127.0.0.1:9199" || process.env.ACADEA_E2E_BASE_URL !== origin) throw new Error("Émulateurs locaux exclusivement");
}
async function put(path: string, data: Record<string, unknown>) {
  guard();
  expect((await db.doc(path).get()).exists).toBe(false);
  await db.doc(path).create({ ...data, fixtureId: tag });
  paths.add(path);
}

async function browserFor(browser: Browser, role: string) {
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } });
  const state = { authorization: "", loseResponse: false, lost: false, remote: [] as string[], errors: [] as string[] };
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (["http:", "https:"].includes(url.protocol) && !["127.0.0.1", "localhost"].includes(url.hostname)) {
      state.remote.push(url.hostname); return route.abort();
    }
    return route.continue();
  });
  await context.route("**/api/**", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === "/api/manage-teacher-availability-request") {
      let statusCode = 200, body = "";
      await publishedHandler({ method: request.method(), headers: request.headers(), query: Object.fromEntries(url.searchParams) }, {
        get statusCode() { return statusCode; }, set statusCode(value: number) { statusCode = value; }, setHeader() {}, end(value: string) { body = value; },
      });
      return route.fulfill({ status: statusCode, contentType: "application/json", body });
    }
    if (url.pathname !== "/api/manage-teacher-grading") return route.fulfill({ status: 404, body: "API hors parcours local" });
    if (request.headers().authorization) state.authorization = request.headers().authorization;
    let status = 200, payload: unknown;
    const response = { status(value: number) { status = value; return this; }, json(value: unknown) { payload = value; } };
    const body = request.postDataJSON();
    await handler({ method: request.method(), headers: request.headers(), body }, response);
    if (body?.action === "grades-publish" && status === 200 && state.loseResponse && !state.lost) {
      state.lost = true; return route.abort("connectionreset");
    }
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => state.errors.push(error.stack ?? error.message));
  await page.goto("/login");
  await page.getByPlaceholder("email@ecole.com").fill(`${uid(role)}@local-e2e.invalid`);
  await page.getByPlaceholder("Votre mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 30000 });
  await page.getByRole("button", { name: "Menu", exact: true }).last().click();
  return { context, page, state };
}
async function fit(page: Page) {
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    const box = await page.getByRole("dialog").last().boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  }
}
async function api(page: Page, authorization: string, body: Record<string, unknown>) {
  return page.evaluate(async ({ authorization, body }) => {
    const response = await fetch("/api/manage-teacher-grading", { method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }, { authorization, body });
}

test.describe("Publication et archives : chaîne authentifiée isolée", () => {
  test.setTimeout(180000);
  test.beforeAll(async () => {
    guard();
    await put(`schools/${schoolId}`, { id: schoolId, name: "E2E Publication fictive", status: "active", schoolType: "CTEB et Secondaire", educationLevels: ["CTEB", "Secondaire"], activeSchoolYearId: year, currency: "CDF", timeZone: "Africa/Kinshasa" });
    await put(`schools/${foreign}`, { id: foreign, name: "E2E École étrangère", status: "active", activeSchoolYearId: `${foreign}-year` });
    for (const [id, sid, name, status] of [[year, schoolId, "2027-2028", "active"], [archived, schoolId, "2026-2027", "archived"], [`${foreign}-year`, foreign, "2026-2027", "archived"]]) {
      await put(`schoolYears/${id}`, { id, schoolId: sid, name, status, currency: "CDF", startsAt: `${name.slice(0, 4)}-09-01`, endsAt: `${name.slice(5)}-07-31` });
    }
    for (const role of [...roles, "teacher2", "other-parent"]) {
      const actualRole = role === "teacher2" ? "teacher" : role === "other-parent" ? "parent" : role;
      await auth.createUser({ uid: uid(role), email: `${uid(role)}@local-e2e.invalid`, password });
      createdAuth.push(uid(role));
      await auth.setCustomUserClaims(uid(role), { role: actualRole, schoolId, ...(actualRole === "parent" ? { parentId: `${tag}-${role}-profile` } : {}) });
      await put(`users/${uid(role)}`, { id: uid(role), role: actualRole, schoolId, email: `${uid(role)}@local-e2e.invalid`, name: `E2E ${role}`, firstName: "Test", lastName: role, status: "active", active: true, activeSchoolYearId: year, section: "Secondaire", sectionIds: ["Secondaire"], ...(actualRole === "parent" ? { parentId: `${tag}-${role}-profile` } : {}) });
    }
    await put(`classes/${classId}`, { id: classId, schoolId, schoolYearId: year, name: "1ère Humanité", section: "Secondaire", active: true });
    for (let i = 1; i <= 3; i++) await put(`students/${student(i)}`, { id: student(i), schoolId, schoolYearId: year, classId, className: "1ère Humanité", section: "Secondaire", status: "ACTIVE", nom: `Fictif${i}`, prenom: "Enfant" });
    await put(`parents/${tag}-parent-profile`, { schoolId, schoolYearId: year, userId: uid("parent"), fullName: "Parent fictif", email: `${uid("parent")}@local-e2e.invalid`, phone: "", address: "", status: "active", studentIds: [student(1), `${tag}-archived-child`] });
    await put(`parents/${tag}-other-parent-profile`, { schoolId, schoolYearId: year, userId: uid("other-parent"), fullName: "Autre Parent fictif", email: `${uid("other-parent")}@local-e2e.invalid`, phone: "", address: "", status: "active", studentIds: [student(2), student(3)] });
    for (let i = 1; i <= 2; i++) {
      await put(`teachers/${teacher(i)}`, { id: teacher(i), schoolId, schoolYearId: year, userId: uid(i === 1 ? "teacher" : "teacher2"), firstName: "Test", lastName: `Prof${i}`, status: "active", active: true });
      await put(`subjects/${subject(i)}`, { id: subject(i), schoolId, schoolYearId: year, name: i === 1 ? "Mathématiques" : "Français", active: true });
      await put(`pedagogicalAssignments/${assignment(i)}`, { id: assignment(i), schoolId, schoolYearId: year, teacherId: teacher(i), classId, subjectId: subject(i), active: true, weeklyPeriods: 3 });
      for (const [slot, max] of [["period_1", i === 1 ? 20 : 30], ["period_2", i === 1 ? 40 : 60]] as const) {
        const input = { schoolId, schoolYearId: year, classId, subjectId: subject(i), assignmentId: assignment(i), gradingSlot: slot };
        const caller = { uid: uid(i === 1 ? "teacher" : "teacher2"), role: "teacher", schoolId };
        await executeTeacherGrading({ db, caller, body: { ...input, action: "save-config", maxScore: max, confirmation: "ENREGISTRER LA CÔTE MAXIMALE" } });
        await executeTeacherGrading({ db, caller, body: { ...input, action: "save-entries", entries: [1, 2, 3].map((n) => ({ studentId: student(n), gradingSlot: slot, status: "graded", score: max * (n === 1 ? .8 : n === 2 ? .6 : .4) })) } });
      }
    }
    await put(`classTitulars/${tag}-titular`, { schoolId, schoolYearId: year, classId, teacherId: teacher(1), active: true });
    await put(`feeTypes/${fee}`, { id: fee, schoolId, schoolYearId: year, name: "Minerval E2E", amount: 100, currency: "CDF" });
    for (let i = 1; i <= 3; i++) await put(`payments/${tag}-payment-${i}`, { schoolId, schoolYearId: year, studentId: student(i), feeTypeId: fee, status: "validated", currency: "CDF", amount: i === 2 ? 10 : 100 });
    await put(`classes/${tag}-archived-class`, { schoolId, schoolYearId: archived, name: "Classe archivée E2E", section: "Secondaire" });
    await put(`students/${tag}-archived-child`, { schoolId, schoolYearId: archived, className: "Classe archivée E2E", section: "Secondaire", nom: "Enfant archivé fictif" });
    await put(`teachers/${tag}-archived-teacher`, { schoolId, schoolYearId: archived, userId: uid("teacher") });
    await put(`subjects/${tag}-archived-subject`, { schoolId, schoolYearId: archived, name: "Cours archivé E2E" });
    await put(`pedagogicalAssignments/${tag}-archived-assignment`, { schoolId, schoolYearId: archived, teacherId: `${tag}-archived-teacher`, classId: `${tag}-archived-class`, subjectId: `${tag}-archived-subject` });
    await put(`payments/${tag}-archived-payment`, { schoolId, schoolYearId: archived, amount: 12, currency: "CDF", feeName: "Frais archivés E2E" });
    await put(`disciplineSanctions/${tag}-archived-sanction`, { schoolId, schoolYearId: archived, studentId: `${tag}-archived-child`, studentName: "Enfant archivé fictif", sanctionType: "Avertissement E2E", reason: "Fictif" });
  });
  test.afterAll(async () => {
    guard();
    for (const collection of collections) {
      for (const sid of [schoolId, foreign]) {
        const snapshot = await db.collection(collection).where("schoolId", "==", sid).get();
        for (const doc of snapshot.docs) {
          expect(doc.data().schoolId).toBe(sid);
          if (doc.data().fixtureId) expect(doc.data().fixtureId).toBe(tag);
          paths.add(doc.ref.path);
        }
      }
    }
    for (const path of paths) {
      const ref = db.doc(path), snapshot = await ref.get();
      const data = snapshot.data();
      if (snapshot.exists && data?.fixtureId !== tag && ![schoolId, foreign].includes(data?.schoolId)) throw new Error("Identité de fixture non confirmée");
      await ref.delete();
      expect((await ref.get()).exists).toBe(false);
    }
    for (const id of createdAuth) {
      expect(id.startsWith(`${tag}-`)).toBe(true);
      await auth.deleteUser(id);
      await expect(auth.getUser(id)).rejects.toMatchObject({ code: "auth/user-not-found" });
    }
    for (const collection of collections) for (const sid of [schoolId, foreign]) expect((await db.collection(collection).where("schoolId", "==", sid).get()).empty).toBe(true);
    await deleteApp(app);
  });

  test("Enseignant : profil valide, maxima par période, titulariat et deux tableaux sur mobile/desktop", async ({ browser }) => {
    const { context, page, state } = await browserFor(browser, "teacher");
    try {
      await page.getByRole("button", { name: /Fiche de cotation/ }).click();
      const dialog = page.getByRole("dialog", { name: "Fiche de cotation" });
      await expect(dialog.getByLabel("Cote maximale", { exact: true })).toHaveValue("20");
      await dialog.getByRole("combobox", { name: /^Période/ }).selectOption("period_2");
      await expect(dialog.getByLabel("Cote maximale", { exact: true })).toHaveValue("40");
      await dialog.getByRole("combobox", { name: /^Période/ }).selectOption("period_3");
      await dialog.getByLabel("Cote maximale", { exact: true }).fill("25");
      await dialog.getByRole("button", { name: "Enregistrer maximum", exact: true }).click();
      await dialog.getByLabel("Phrase de confirmation").fill("ENREGISTRER LA CÔTE MAXIMALE");
      await dialog.getByRole("button", { name: "Confirmer", exact: true }).click();
      await expect(dialog.getByLabel("Cote maximale", { exact: true })).toHaveAttribute("readonly", "");
      await dialog.getByLabel("Cote de Fictif1", { exact: true }).fill("20");
      await dialog.getByLabel("Cote de Fictif2", { exact: true }).fill("15");
      await dialog.getByLabel("Cote de Fictif3", { exact: true }).fill("10");
      await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await page.getByRole("button", { name: /Fiche de cotation/ }).click();
      await dialog.getByRole("combobox", { name: /^Période/ }).selectOption("period_3");
      await expect(dialog.getByLabel("Cote de Fictif1", { exact: true })).toHaveValue("20");
      await dialog.getByRole("button", { name: "Ma classe titulaire", exact: true }).click();
      const button = dialog.getByRole("button", { name: "Voir la fiche consolidée", exact: true });
      await expect(button.locator("..")).toContainText("1ère Humanité");
      await button.click();
      const consolidated = page.getByRole("dialog", { name: "Fiche consolidée" });
      await expect(dialog).toHaveCount(0);
      await expect(consolidated.getByRole("region", { name: "Tableau de cotes", exact: true })).toBeVisible();
      await expect(consolidated.locator("table")).toHaveCount(1);
      const filterType = consolidated.getByRole("combobox", { name: "Type de filtre" });
      const filterChoice = consolidated.getByRole("combobox", { name: "Choix correspondant" });
      await expect(filterChoice.locator("option").first()).toHaveText("Toutes les périodes");
      await expect(consolidated.locator("thead")).toContainText("Mathématiques");
      await expect(consolidated.locator("thead")).toContainText("Français");
      await filterChoice.selectOption("period_1");
      await expect(consolidated.locator("thead")).not.toContainText("2ème Période");
      await filterChoice.selectOption("");
      await expect(consolidated.locator("thead")).toContainText("2ème Période");
      await filterType.selectOption("course");
      await expect(filterChoice.locator("option").first()).toHaveText("Tous les cours");
      await filterChoice.selectOption({ label: "Mathématiques" });
      await expect(consolidated.locator("thead")).not.toContainText("Français");
      await consolidated.getByRole("button", { name: "Exporter PDF" }).click();
      await expect(page.locator(".acadea-pdf-viewer [data-pdf-download]")).toHaveAttribute("href", /^blob:/, { timeout: 60000 });
      expect(await page.locator(".acadea-pdf-viewer [data-pdf-download]").evaluate(async (link: HTMLAnchorElement) =>
        (await (await fetch(link.href)).blob()).type)).toBe("application/pdf");
      await page.locator(".acadea-pdf-viewer [data-pdf-close]").click();
      await filterChoice.selectOption("");
      await expect(consolidated.locator("thead")).toContainText("Français");
      await filterType.selectOption("student");
      await expect(filterChoice).toHaveValue("");
      await filterChoice.selectOption({ index: 1 });
      await expect(consolidated.locator("tbody tr")).toHaveCount(1);
      await consolidated.getByRole("tab", { name: "PALMARÈS" }).click();
      await expect(consolidated.getByRole("region", { name: "Palmarès", exact: true })).toContainText("80");
      await expect(consolidated.locator("table")).toHaveCount(1);
      await expect(filterChoice.locator("option").first()).toHaveText("Toutes les périodes");
      await filterType.selectOption("place");
      await expect(consolidated.getByText("Période de référence")).toBeVisible();
      await filterChoice.selectOption({ index: 1 });
      await expect(consolidated.locator("tbody tr")).toHaveCount(1);
      await consolidated.getByRole("button", { name: "Exporter PDF" }).click();
      await expect(page.locator(".acadea-pdf-viewer [data-pdf-download]")).toHaveAttribute("href", /^blob:/, { timeout: 60000 });
      await page.locator(".acadea-pdf-viewer [data-pdf-close]").click();
      await consolidated.getByRole("button", { name: "Revenir à Ma classe titulaire" }).click();
      await expect(dialog.getByRole("button", { name: "Voir la fiche consolidée" })).toBeVisible();
      await fit(page);
      expect(state.errors).toEqual([]);
    } finally { await context.close(); }
  });

  test("Consolidation → critères → publication → notification → Parent → retrait, avec réponse perdue", async ({ browser }) => {
    const director = await browserFor(browser, "study_director");
    let parent: Awaited<ReturnType<typeof browserFor>> | undefined;
    try {
      const { page, state } = director;
      await page.getByRole("button", { name: "Publication des cotes", exact: true }).click();
      await page.getByRole("button", { name: "Voir la fiche consolidée", exact: true }).click();
      await page.getByRole("tab", { name: "PALMARÈS" }).click();
      await expect(page.getByRole("region", { name: "Palmarès", exact: true })).toContainText("80");
      await page.getByRole("button", { name: "Revenir aux classes", exact: true }).click();
      await page.getByRole("button", { name: "Option de publication", exact: true }).click();
      await page.getByRole("combobox", { name: /^Période/ }).selectOption("period_2");
      await page.getByLabel("Comparaison du pourcentage").selectOption("gte");
      await page.getByLabel("Valeur du pourcentage").fill("50");
      await page.getByLabel("Type de frais et comparaison").selectOption(JSON.stringify([fee, "gte"]));
      await page.getByLabel("Montant payé").fill("100");
      state.loseResponse = true;
      await page.getByRole("button", { name: "Publier", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("Connexion Internet indisponible.");
      await expect(page.getByRole("alert")).not.toContainText("Failed to fetch");
      expect(state.lost).toBe(true);
      await page.getByRole("button", { name: "Publier", exact: true }).click();
      await expect(page.getByText("Publication confirmée : 1 élève(s), 1 notification(s).")).toBeVisible();
      const runs = await db.collection("gradePublicationRuns").where("schoolId", "==", schoolId).get();
      const notices = await db.collection("notifications").where("schoolId", "==", schoolId).get();
      expect(runs.size).toBe(1); expect(notices.size).toBe(1);
      expect(notices.docs[0].data().recipientUserId).toBe(uid("parent"));
      expect(notices.docs[0].data().body).not.toMatch(/80\s*%|100\s*CDF/);
      await fit(page);
      parent = await browserFor(browser, "parent");
      await parent.page.getByRole("button", { name: "Boîte à Messagerie", exact: true }).click();
      await expect(parent.page.getByRole("dialog", { name: "Boîte à Messagerie", exact: true })).toContainText("Publication des cotes");
      await parent.page.getByRole("button", { name: "Ouvrir les cotes de mon enfant", exact: true }).click();
      await expect(parent.page.getByRole("region", { name: "Cotes publiées de l'enfant" })).toContainText("32 / 40");
      await parent.page.getByRole("button", { name: "Fermer les cotes de mes enfants", exact: true }).click();
      await parent.page.getByRole("button", { name: /Côtes de mes enfants/ }).click();
      await parent.page.getByRole("button", { name: /Consulter les cotes/ }).click();
      await expect(parent.page.getByRole("region", { name: "Cotes publiées de l'enfant" })).toContainText("32 / 40");
      await fit(parent.page);
      const read = { action: "grades-parent-read", schoolId, schoolYearId: year, studentId: student(1), slot: "period_2" };
      expect((await api(parent.page, parent.state.authorization, { ...read, studentId: student(2) })).status).toBe(403);
      expect((await api(parent.page, parent.state.authorization, { ...read, slot: "period_1" })).status).toBe(404);
      expect((await api(parent.page, "", read)).status).toBe(401);
      await page.getByLabel(/Pour retirer cette publication/).fill("RETIRER CETTE PUBLICATION");
      await page.getByRole("button", { name: "Retirer cette publication", exact: true }).click();
      await expect(page.getByText(/Publication confirmée/)).toHaveCount(0);
      expect((await api(parent.page, parent.state.authorization, read)).status).toBe(404);
      expect(director.state.errors).toEqual([]); expect(parent.state.errors).toEqual([]);
    } finally { await director.context.close(); await parent?.context.close(); }
  });

  for (const role of roles) test(`Archives authentifiées, lecture seule et isolation : ${role}`, async ({ browser }) => {
    const { context, page, state } = await browserFor(browser, role);
    try {
      const yearButton = page.getByRole("button", { name: /^Année scolaire/i });
      const logoutButton = yearButton.locator("xpath=following::button[contains(normalize-space(.), 'Déconnexion')][1]");
      await expect(logoutButton).toBeVisible();
      await expect(yearButton).toBeVisible();
      expect(await yearButton.evaluate((button) => {
        const buttons = Array.from(document.querySelectorAll("button"));
        return buttons[buttons.indexOf(button as HTMLButtonElement) + 1]?.textContent?.trim();
      })).toBe("Déconnexion");
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect.poll(async () => {
          const yearBox = await yearButton.boundingBox();
          const logoutBox = await logoutButton.boundingBox();
          return Boolean(yearBox && logoutBox
            && Math.abs(yearBox.x - logoutBox.x) <= 1
            && Math.abs(yearBox.width - logoutBox.width) <= 1
            && yearBox.y < logoutBox.y);
        }).toBe(true);
      }
      await yearButton.click();
      const dialog = page.getByRole("dialog", { name: "Année Scolaire", exact: true });
      await dialog.getByRole("button", { name: /2026-2027/ }).click();
      await expect(dialog.getByRole("heading", { level: 3 })).toContainText("2026-2027");
      await expect(dialog.getByText(/Aucune donnée historique autorisée/)).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: /Enregistrer|Supprimer|Modifier|Publier/ })).toHaveCount(0);
      await fit(page);
      expect((await api(page, state.authorization, { action: "archive-summary", schoolId, schoolYearId: `${foreign}-year` })).status).toBe(403);
      expect((await api(page, state.authorization, { action: "archive-summary", schoolId: foreign, schoolYearId: `${foreign}-year` })).status).toBe(403);
      expect((await api(page, state.authorization, { action: "archive-save", schoolId, schoolYearId: archived })).status).toBe(400);
      expect((await api(page, state.authorization, { action: "grades-publish", schoolId, schoolYearId: archived, classId, slot: "period_1", requestId: "archived-request-forbidden" })).status).toBe(403);
      expect(state.errors).toEqual([]);
    } finally { await context.close(); }
  });

  test("archivage d'un Enseignant connecté, message de suspension et réactivation sans ancien poste", async ({ browser }) => {
    const current = await browserFor(browser, "teacher");
    const admin = { uid: uid("study_director"), role: "study_director", schoolId };
    const originalAuth = await auth.getUser(uid("teacher"));
    const gradesBefore = (await db.collection("gradeEntries").where("schoolId", "==", schoolId).get()).size;
    try {
      await managePersonnel({ auth, db, caller: admin, body: { schoolId, personnelId: uid("teacher") }, action: "archive-personnel" });
      await expect(current.page.getByRole("heading", { name: "Accès à votre compte suspendu" })).toBeVisible({ timeout: 20000 });
      await expect(current.page.getByRole("button", { name: "Retour à la connexion" })).toBeVisible();
      expect((await db.doc(`pedagogicalAssignments/${assignment(1)}`).get()).data()?.active).toBe(false);
      expect((await db.doc(`pedagogicalAssignments/${assignment(2)}`).get()).data()?.active).toBe(true);
      expect((await db.collection("gradeEntries").where("schoolId", "==", schoolId).get()).size).toBe(gradesBefore);

      const archivedContext = await browser.newContext({ baseURL: origin });
      try {
        const archivedPage = await archivedContext.newPage();
        await archivedPage.goto("/login");
        await archivedPage.getByPlaceholder("email@ecole.com").fill(`${uid("teacher")}@local-e2e.invalid`);
        await archivedPage.getByPlaceholder("Votre mot de passe").fill(password);
        await archivedPage.getByRole("button", { name: "Se connecter" }).click();
        await expect(archivedPage.getByRole("heading", { name: "Accès à votre compte suspendu" })).toBeVisible();
        await archivedPage.getByRole("button", { name: "Retour à la connexion" }).click();
        await expect(archivedPage.getByRole("heading", { name: "Connexion" })).toBeVisible();
      } finally { await archivedContext.close(); }

      await managePersonnel({ auth, db, caller: admin, body: { schoolId, personnelId: uid("teacher") }, action: "reactivate-personnel" });
      const restoredAuth = await auth.getUser(uid("teacher"));
      expect(restoredAuth.uid).toBe(originalAuth.uid);
      expect(restoredAuth.email).toBe(originalAuth.email);
      expect(restoredAuth.disabled).toBe(false);
      expect((await db.doc(`pedagogicalAssignments/${assignment(1)}`).get()).data()?.active).toBe(false);
      expect((await db.doc(`pedagogicalAssignments/${assignment(2)}`).get()).data()?.active).toBe(true);

      const restored = await browserFor(browser, "teacher");
      try {
        await expect(restored.page.getByRole("heading", { name: "Aucune affectation pour l'année scolaire en cours" })).toBeVisible();
        await put(`subjects/${subject(3)}`, { id: subject(3), schoolId, schoolYearId: year, name: "Nouveau cours fictif", active: true });
        await put(`pedagogicalAssignments/${assignment(3)}`, { id: assignment(3), schoolId, schoolYearId: year, teacherId: teacher(1), classId, subjectId: subject(3), active: true, weeklyPeriods: 1 });
        await restored.page.getByRole("button", { name: "Mes cours", exact: true }).last().click();
        await expect(restored.page.getByText("Nouveau cours fictif")).toBeVisible();
        await expect(restored.page.getByText("Mathématiques")).toHaveCount(0);
      } finally { await restored.context.close(); }
    } finally { await current.context.close(); }
  });
});
