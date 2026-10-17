import { randomUUID } from "node:crypto";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { expect, test, type Browser, type Page, type Route } from "@playwright/test";
import publishedHandler from "../api/manage-teacher-availability-request.js";

const origin = "http://127.0.0.1:5173";
const projectId = "demo-acadea";
const suffix = randomUUID().slice(0, 8);
const schoolId = `e2e-library-school-${suffix}`;
const foreignSchoolId = `e2e-library-foreign-${suffix}`;
const yearId = `${schoolId}__2026-2027`;
const otherYearId = `${schoolId}__2027-2028`;
const foreignYearId = `${foreignSchoolId}__2026-2027`;
const teacherId = `e2e-library-teacher-${suffix}`;
const otherTeacherId = `e2e-library-other-teacher-${suffix}`;
const timetableId = `e2e-library-timetable-${suffix}`;
const password = `LocalOnly${randomUUID().replace(/-/g, "").slice(0, 16)}!`;
const accounts = {
  admin: { uid: `e2e-library-admin-${suffix}`, role: "school_admin", route: "/dashboard" },
  studies: { uid: `e2e-library-studies-${suffix}`, role: "study_director", route: "/studies" },
  teacher: { uid: `e2e-library-teacher-user-${suffix}`, role: "teacher", route: "/teacher" },
  cashier: { uid: `e2e-library-cashier-${suffix}`, role: "cashier", route: "/dashboard" },
} as const;
const app = initializeApp({ projectId });
const auth = getAuth(app);
const db = getFirestore(app);
const fixturePaths: string[] = [];
const fixtureBatch = db.batch();

function assertLocalOnly() {
  if (process.env.ACADEA_E2E_LOCAL_EMULATORS !== "YES"
    || process.env.VITE_FIREBASE_PROJECT_ID !== projectId
    || process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
    || process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080"
    || process.env.FIREBASE_STORAGE_EMULATOR_HOST !== "127.0.0.1:9199"
    || process.env.ACADEA_E2E_BASE_URL !== origin) throw new Error("E2E réservé aux émulateurs demo-acadea.");
}

function put(path: string, data: Record<string, unknown>) {
  fixtureBatch.set(db.doc(path), data);
  fixturePaths.push(path);
}

async function invokePublished(request: { method: string; headers: Record<string, string>; query: Record<string, string> }) {
  let statusCode = 200;
  let body = "";
  const headers: Record<string, string> = {};
  const response = {
    get statusCode() { return statusCode; },
    set statusCode(value: number) { statusCode = value; },
    setHeader(name: string, value: string) { headers[name] = value; },
    end(value: string) { body = value; },
  };
  await publishedHandler(request, response);
  return { statusCode, body, headers };
}

async function contextFor(browser: Browser, options: { colorScheme?: "light" | "dark"; time?: string } = {}) {
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 900 }, colorScheme: options.colorScheme ?? "light" });
  const remote: string[] = [];
  const browserErrors: string[] = [];
  const routeState = { mode: "normal" as "normal" | "delay" | "error", authorization: "" };
  await context.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseio\.com|firebasestorage\.app)/, (route) => {
    remote.push(new URL(route.request().url()).hostname);
    return route.abort();
  });
  await context.route("**/api/**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname !== "/api/manage-teacher-availability-request") return route.fulfill({ status: 404, body: "API locale indisponible" });
    routeState.authorization = request.headers().authorization ?? "";
    if (routeState.mode === "delay") await new Promise((resolve) => setTimeout(resolve, 800));
    if (routeState.mode === "error") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Indisponibilité de test" }) });
    const result = await invokePublished({ method: request.method(), headers: request.headers(), query: Object.fromEntries(url.searchParams) });
    return route.fulfill({ status: result.statusCode, contentType: "application/json", headers: result.headers, body: result.body });
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  if (options.time) await page.clock.install({ time: new Date(options.time) });
  return { context, page, remote, routeState, browserErrors };
}

async function login(page: Page, account: typeof accounts[keyof typeof accounts]) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("email@ecole.com").fill(`${account.uid}@local-e2e.invalid`);
  await page.getByPlaceholder("Votre mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click({ noWaitAfter: true });
  await page.waitForURL((url) => url.pathname === account.route, { timeout: 30_000 });
}

async function openLibrary(page: Page) {
  await page.getByRole("button", { name: "Menu", exact: true }).last().click();
  await page.getByRole("button", { name: /^Bibliothèque/ }).last().click();
  const dialog = page.getByRole("dialog", { name: "Bibliothèque" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function fit(page: Page) {
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    for (const dialog of await page.getByRole("dialog").all()) {
      const box = await dialog.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(-1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    }
  }
}

test.describe("Bibliothèque et horaires — navigateur local isolé", () => {
  test.setTimeout(180_000);
  test.beforeAll(async () => {
    assertLocalOnly();
    await put(`schools/${schoolId}`, { id: schoolId, name: "École locale", acronym: "LOC", status: "active", schoolType: "CTEB et Secondaire", educationLevels: ["CTEB", "Secondaire"], activeSchoolYearId: yearId, currency: "CDF", timeZone: "Africa/Kinshasa" });
    await put(`schools/${foreignSchoolId}`, { id: foreignSchoolId, name: "Autre école locale", status: "active", activeSchoolYearId: foreignYearId });
    for (const [id, scopedSchool, name] of [[yearId, schoolId, "2026-2027"], [otherYearId, schoolId, "2027-2028"], [foreignYearId, foreignSchoolId, "2026-2027"]]) {
      await put(`schoolYears/${id}`, { id, schoolId: scopedSchool, name, status: id === yearId ? "active" : "future", startsAt: id === otherYearId ? "2027-09-01" : "2026-09-01", endsAt: id === otherYearId ? "2028-07-31" : "2027-07-31" });
    }
    await put(`schoolCalendars/${yearId}`, { schoolId, schoolYearId: yearId, status: "validated", events: [{ id: "legacy-holiday", title: "Congé historique", kind: "holiday", startsAt: "2026-10-16", endsAt: "2026-10-16", origin: "local" }], updatedAt: "2026-10-13T00:00:00Z", updatedBy: accounts.studies.uid });
    for (const account of Object.values(accounts)) {
      await auth.createUser({ uid: account.uid, email: `${account.uid}@local-e2e.invalid`, password });
      await auth.setCustomUserClaims(account.uid, { role: account.role, schoolId });
      await put(`users/${account.uid}`, { id: account.uid, name: account.role === "teacher" ? "Aline Test" : account.role, ...(account.role === "teacher" ? { firstName: "Aline", lastName: "Test" } : {}), email: `${account.uid}@local-e2e.invalid`, role: account.role, schoolId, activeSchoolYearId: yearId, status: "active", active: true });
    }
    await put(`teachers/${teacherId}`, { id: teacherId, schoolId, schoolYearId: yearId, userId: accounts.teacher.uid, firstName: "Aline", lastName: "Test", fullName: "Aline Test", status: "active", active: true });
    await put(`teachers/${otherTeacherId}`, { id: otherTeacherId, schoolId, schoolYearId: yearId, userId: "other-user", firstName: "Bruno", lastName: "Fictif", fullName: "Bruno Fictif", status: "active", active: true });
    await put(`classes/${schoolId}-class`, { id: `${schoolId}-class`, schoolId, schoolYearId: yearId, name: "4ème Humanité", option: "Littéraire", active: true });
    await put(`subjects/${schoolId}-subject`, { id: `${schoolId}-subject`, schoolId, schoolYearId: yearId, name: "Géographie", active: true });
    for (const [id, label, startTime, endTime, order] of [["early", "Première période", "08:00", "09:00", 1], ["late", "Deuxième période", "10:00", "11:00", 2]] as const) {
      await put(`schedulePeriods/${schoolId}-${id}`, { id: `${schoolId}-${id}`, schoolId, schoolYearId: yearId, label, startTime, endTime, order, active: true });
    }
    await put(`pedagogicalAssignments/${schoolId}-assignment`, { id: `${schoolId}-assignment`, schoolId, schoolYearId: yearId, classId: `${schoolId}-class`, subjectId: `${schoolId}-subject`, teacherId, active: true, weeklyPeriods: 2 });
    await put(`timetables/${timetableId}`, { id: timetableId, schoolId, schoolYearId: yearId, status: "PUBLISHED", activeDraft: false, activePublished: true, version: 3, persistenceState: "COMPLETE", createdBy: accounts.studies.uid, createdAt: "2026-10-13T00:00:00.000Z", updatedAt: "2026-10-13T00:00:00.000Z", generationMetadata: { algorithm: "deterministic-backtracking", exploredBranches: 4, durationMs: 10, maxSameAssignmentPeriodsPerDay: 2, sourceFingerprint: "e2e-fingerprint" } });
    for (const [id, dayOfWeek, periodId, entryTeacherId] of [["later", "wednesday", "late", teacherId], ["earlier", "wednesday", "early", teacherId], ["saturday", "saturday", "early", teacherId], ["other", "monday", "early", otherTeacherId]] as const) {
      await put(`timetableEntries/${schoolId}-${id}`, { id: `${schoolId}-${id}`, schoolId, schoolYearId: yearId, scheduleId: timetableId, classId: `${schoolId}-class`, subjectId: `${schoolId}-subject`, teacherId: entryTeacherId, assignmentId: `${schoolId}-assignment`, periodId: `${schoolId}-${periodId}`, dayOfWeek, active: true });
    }
    await fixtureBatch.commit();
  });
  test.afterAll(async () => {
    assertLocalOnly();
    for (const reference of await db.collection(`schoolCalendars/${yearId}/events`).listDocuments()) await reference.delete();
    for (const path of fixturePaths.reverse()) await db.doc(path).delete();
    for (const account of Object.values(accounts)) await auth.deleteUser(account.uid);
    await deleteApp(app);
  });

  test("Études : les options d'affectation suivent uniquement la classe choisie, y compris en modification", async ({ browser }) => {
    const firstClass = `${schoolId}-option-base-a`;
    const secondClass = `${schoolId}-option-base-b`;
    const firstOption = `${firstClass}::sciences`;
    const secondOption = `${firstClass}::pedagogie`;
    const otherOption = `${secondClass}::commerciale`;
    const optionAssignmentId = `${schoolId}-option-assignment`;
    const created = [
      `classes/${firstClass}`, `classes/${secondClass}`, `classes/${firstOption}`, `classes/${secondOption}`, `classes/${otherOption}`,
      `students/${schoolId}-option-student-a`, `students/${schoolId}-option-student-b`, `students/${schoolId}-option-student-c`,
      `pedagogicalAssignments/${optionAssignmentId}`,
    ];
    const teacherUser = db.doc(`users/${accounts.teacher.uid}`);
    const testBrowser = await contextFor(browser);
    try {
      await teacherUser.update({ section: "Secondaire", sectionIds: ["Secondaire"] });
      const records = [
        [created[0], { id: firstClass, schoolId, schoolYearId: yearId, name: "3ème Humanité", section: "Secondaire", active: true }],
        [created[1], { id: secondClass, schoolId, schoolYearId: yearId, name: "2ème Humanité", section: "Secondaire", active: true }],
        [created[2], { id: firstOption, schoolId, schoolYearId: yearId, name: "3ème Sciences", parentClassId: firstClass, classOptionKey: firstOption, option: "Sciences", section: "Secondaire", active: true }],
        [created[3], { id: secondOption, schoolId, schoolYearId: yearId, name: "3ème Pédagogie", parentClassId: firstClass, classOptionKey: secondOption, option: "Pédagogie", section: "Secondaire", active: true }],
        [created[4], { id: otherOption, schoolId, schoolYearId: yearId, name: "2ème Commerciale", parentClassId: secondClass, classOptionKey: otherOption, option: "Commerciale", section: "Secondaire", active: true }],
        [created[5], { id: `${schoolId}-option-student-a`, schoolId, schoolYearId: yearId, classId: firstClass, className: "3ème Humanité", classOptionKey: firstOption, option: "Sciences", section: "Secondaire", status: "ACTIVE" }],
        [created[6], { id: `${schoolId}-option-student-b`, schoolId, schoolYearId: yearId, classId: firstClass, className: "3ème Humanité", classOptionKey: secondOption, option: "Pédagogie", section: "Secondaire", status: "ACTIVE" }],
        [created[7], { id: `${schoolId}-option-student-c`, schoolId, schoolYearId: yearId, classId: secondClass, className: "2ème Humanité", classOptionKey: otherOption, option: "Commerciale", section: "Secondaire", status: "ACTIVE" }],
        [created[8], { id: optionAssignmentId, schoolId, schoolYearId: yearId, teacherId, subjectId: `${schoolId}-subject`, classId: firstClass, courseScope: "option", targetOptionIds: [firstOption], weeklyPeriods: 2, active: true }],
      ] as const;
      const batch = db.batch();
      records.forEach(([path, value]) => batch.set(db.doc(path), value));
      await batch.commit();

      await login(testBrowser.page, accounts.studies);
      await testBrowser.page.getByRole("button", { name: "Enseignants", exact: true }).last().click();
      await testBrowser.page.getByRole("button", { name: "Aline Test", exact: true }).click();
      const teacherDrawer = testBrowser.page.getByRole("dialog", { name: "Fiche pédagogique — Aline Test" });
      await teacherDrawer.getByRole("button", { name: "Ajouter affectation" }).click();
      let assignmentDrawer = testBrowser.page.getByRole("dialog", { name: "Ajouter une affectation" });
      const selectClass = async (name: string) => {
        await assignmentDrawer.locator('button[aria-haspopup="listbox"]').nth(1).click();
        await testBrowser.page.getByRole("listbox").getByRole("option", { name, exact: true }).click();
        await testBrowser.page.keyboard.press("Escape");
      };
      await selectClass("3ème Humanité");
      const firstGroup = assignmentDrawer.getByRole("group", { name: "Organisation du cours — 3ème Humanité" });
      await firstGroup.getByLabel("Type de cours").selectOption("option");
      await expect(firstGroup.getByLabel("Option concernée").locator("option")).toHaveText(["Choisir", "Pédagogie", "Sciences"]);
      await firstGroup.getByLabel("Option concernée").selectOption(firstOption);
      await selectClass("3ème Humanité");
      await selectClass("2ème Humanité");
      const secondGroup = assignmentDrawer.getByRole("group", { name: "Organisation du cours — 2ème Humanité" });
      await secondGroup.getByLabel("Type de cours").selectOption("option");
      await expect(secondGroup.getByLabel("Option concernée").locator("option")).toHaveText(["Choisir", "Commerciale"]);
      await expect(secondGroup.getByLabel("Option concernée")).toHaveValue("");
      await assignmentDrawer.getByRole("button", { name: "Annuler", exact: true }).click();

      await teacherDrawer.locator("article", { hasText: "Sciences" }).getByRole("button", { name: "Modifier l’affectation" }).click();
      assignmentDrawer = testBrowser.page.getByRole("dialog", { name: "Modifier l’affectation" });
      const editingGroup = assignmentDrawer.getByRole("group", { name: "Organisation du cours — 3ème Humanité" });
      await expect(editingGroup.getByLabel("Option concernée")).toHaveValue(firstOption);
      await selectClass("3ème Humanité");
      await selectClass("2ème Humanité");
      const changedGroup = assignmentDrawer.getByRole("group", { name: "Organisation du cours — 2ème Humanité" });
      await changedGroup.getByLabel("Type de cours").selectOption("option");
      await expect(changedGroup.getByLabel("Option concernée").locator("option")).toHaveText(["Choisir", "Commerciale"]);
      await expect(changedGroup.getByLabel("Option concernée")).toHaveValue("");
      await testBrowser.page.reload();
      await testBrowser.page.getByRole("button", { name: "Enseignants", exact: true }).last().click();
      await testBrowser.page.getByRole("button", { name: "Aline Test", exact: true }).click();
      await testBrowser.page.getByRole("dialog", { name: "Fiche pédagogique — Aline Test" }).locator("article", { hasText: "Sciences" }).getByRole("button", { name: "Modifier l’affectation" }).click();
      await expect(testBrowser.page.getByRole("dialog", { name: "Modifier l’affectation" }).getByLabel("Option concernée")).toHaveValue(firstOption);
      expect(testBrowser.remote).toEqual([]);
    } finally {
      await testBrowser.context.close();
      for (const path of created.reverse()) await db.doc(path).delete();
      await teacherUser.update({ section: FieldValue.delete(), sectionIds: FieldValue.delete() });
    }
  });

  test("Administrateur : Bibliothèque identique aux Études, thème sombre et états HTTP", async ({ browser }) => {
    const admin = await contextFor(browser, { colorScheme: "dark" });
    const studies = await contextFor(browser);
    try {
      await login(admin.page, accounts.admin);
      const adminLibrary = await openLibrary(admin.page);
      await expect(adminLibrary.getByRole("status")).toContainText("20 ressources");
      const adminNames = await adminLibrary.locator("article h4").allTextContents();
      expect(adminNames).toHaveLength(20);
      const background = await adminLibrary.evaluate((element) => getComputedStyle(element).backgroundColor);
      expect(background).toBe("rgb(2, 6, 23)");
      await fit(admin.page);
      await login(studies.page, accounts.studies);
      const studiesLibrary = await openLibrary(studies.page);
      expect(await studiesLibrary.locator("article h4").allTextContents()).toEqual(adminNames);
      expect(admin.remote).toEqual([]);
      expect(studies.remote).toEqual([]);
    } finally { await admin.context.close(); await studies.context.close(); }

    const timetable = await contextFor(browser);
    try {
      await login(timetable.page, accounts.admin);
      await timetable.page.getByRole("button", { name: "Menu", exact: true }).last().click();
      timetable.routeState.mode = "delay";
      await timetable.page.getByRole("button", { name: "Horaire publié" }).click();
      const dialog = timetable.page.getByRole("dialog", { name: "Horaire publié" });
      await expect(dialog.getByText("Chargement de l’horaire publié…")).toBeVisible();
      await expect(dialog.getByRole("row"), `${await dialog.innerText()} / ${timetable.browserErrors.join(" | ")}`).toHaveCount(5, { timeout: 30_000 });
      const rows = await dialog.getByRole("row").allTextContents();
      expect(rows[1]).toContain("Lundi");
      expect(rows[2]).toContain("Mercredi");
      expect(rows[2]).toContain("Première période · 08:00–09:00");
      expect(rows[2]).toContain("4ème Littéraire");
      expect(rows[2]).toContain("Géographie");
      expect(rows[2]).toContain("Aline Test");
      expect(rows[3]).toContain("Deuxième période · 10:00–11:00");
      expect(rows[4]).toContain("Samedi");
      expect(rows.join(" ")).not.toContain(teacherId);
      await dialog.getByRole("combobox", { name: "Type de filtre" }).selectOption("teacher");
      await dialog.getByRole("combobox", { name: "Valeur du filtre" }).selectOption({ label: "Aline Test" });
      await expect(dialog.getByRole("row")).toHaveCount(4);
      await dialog.getByRole("combobox", { name: "Type de filtre" }).selectOption("day");
      await dialog.getByRole("combobox", { name: "Valeur du filtre" }).selectOption({ label: "Mercredi" });
      await expect(dialog.getByRole("row")).toHaveCount(3);
      await dialog.getByRole("button", { name: "Réinitialiser" }).click();
      await expect(dialog.getByRole("row")).toHaveCount(5, { timeout: 30_000 });
      await fit(timetable.page);
      await dialog.getByRole("button", { name: "Fermer l’horaire publié" }).click();
      timetable.routeState.mode = "error";
      await timetable.page.getByRole("button", { name: "Horaire publié" }).click();
      await expect(timetable.page.getByRole("dialog", { name: "Horaire publié" }).getByRole("alert")).toContainText("Impossible d’actualiser l’horaire publié : Indisponibilité de test");
      expect(timetable.remote).toEqual([]);
    } finally { await timetable.context.close(); }
  });

  test("Horaire publié : barre horizontale fixe en bas du drawer", async ({ browser }) => {
    const timetable = await contextFor(browser);
    try {
      await timetable.page.setViewportSize({ width: 390, height: 340 });
      await login(timetable.page, accounts.admin);
      await timetable.page.getByRole("button", { name: "Menu", exact: true }).last().click();
      await timetable.page.getByRole("button", { name: "Horaire publié" }).click();
      const dialog = timetable.page.getByRole("dialog", { name: "Horaire publié" });
      await expect(dialog.getByRole("row"), `${await dialog.innerText()} / ${timetable.browserErrors.join(" | ")}`).toHaveCount(5, { timeout: 30_000 });
      const controls = [dialog.getByRole("combobox", { name: "Type de filtre" }), dialog.getByRole("combobox", { name: "Valeur du filtre" }), dialog.getByRole("button", { name: "Réinitialiser" }), dialog.getByRole("button", { name: "PDF" })];
      const controlBoxes = await Promise.all(controls.map((control) => control.boundingBox()));
      expect(controlBoxes.every((box) => box && Math.abs((box.y + box.height / 2) - (controlBoxes[0]!.y + controlBoxes[0]!.height / 2)) < 3), JSON.stringify(controlBoxes)).toBe(true);
      const drawerBox = await dialog.boundingBox();
      expect(controlBoxes[3]!.x + controlBoxes[3]!.width).toBeLessThanOrEqual(drawerBox!.x + drawerBox!.width);
      const scrollbar = dialog.getByRole("region", { name: "Faire défiler le tableau horizontalement" });
      await expect(scrollbar).toBeInViewport();
      const region = dialog.getByRole("region", { name: "Tableau de l’horaire publié" });
      expect(await region.evaluate((element) => getComputedStyle(element).overflowX)).toBe("auto");
      const [scrollbarBox, dialogBox] = await Promise.all([scrollbar.boundingBox(), dialog.boundingBox()]);
      expect(scrollbarBox!.y + scrollbarBox!.height).toBeGreaterThan(dialogBox!.y + dialogBox!.height - 45);
      const content = dialog.locator(".overflow-y-auto").first();
      expect(await content.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0);
      const initialY = scrollbarBox!.y;
      await content.evaluate((element) => { element.scrollTop = element.scrollHeight / 2; });
      expect((await scrollbar.boundingBox())!.y).toBeCloseTo(initialY, 0);
      await content.evaluate((element) => { element.scrollTop = element.scrollHeight; });
      expect((await scrollbar.boundingBox())!.y).toBeCloseTo(initialY, 0);
      const maxScroll = await scrollbar.evaluate((element) => element.scrollWidth - element.clientWidth);
      expect(maxScroll).toBeGreaterThan(0);
      await scrollbar.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
      await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      await expect(region.getByRole("columnheader", { name: "Enseignant" })).toBeInViewport();
      await scrollbar.evaluate((element) => { element.scrollLeft = 0; });
      await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBe(0);
      await expect(region.getByRole("columnheader", { name: "Jour" })).toBeInViewport();
      await dialog.getByRole("combobox", { name: "Type de filtre" }).selectOption("day");
      await dialog.getByRole("combobox", { name: "Valeur du filtre" }).selectOption({ label: "Mercredi" });
      await expect(dialog.getByRole("row")).toHaveCount(3);
      await expect(scrollbar).toBeInViewport();
      await dialog.getByRole("button", { name: "Réinitialiser" }).click();
      await scrollbar.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
      await timetable.page.setViewportSize({ width: 768, height: 650 });
      await expect(scrollbar).toBeInViewport();
      await timetable.page.setViewportSize({ width: 1440, height: 900 });
      await expect(scrollbar).toBeInViewport();
      await dialog.getByRole("button", { name: "Fermer l’horaire publié" }).click();
      await timetable.page.setViewportSize({ width: 390, height: 550 });
      await timetable.page.getByRole("button", { name: "Horaire publié" }).click();
      await expect(timetable.page.getByRole("dialog", { name: "Horaire publié" }).getByRole("row")).toHaveCount(5);
      await expect(dialog).toBeVisible();
      expect(timetable.browserErrors).toEqual([]);
    } finally { await timetable.context.close(); }
  });

  test("Direction des études : horaire publié et références résolues", async ({ browser }) => {
    const studies = await contextFor(browser);
    try {
      await login(studies.page, accounts.studies);
      await studies.page.getByRole("button", { name: "Horaires" }).click();
      await expect(studies.page.getByRole("heading", { name: "Horaires" })).toBeVisible();
      try {
        await expect(studies.page.getByText("Version 3 · PUBLISHED")).toBeVisible({ timeout: 30_000 });
      } catch (cause) {
        const visibleText = await studies.page.locator("body").textContent({ timeout: 3_000 }).catch(() => "body unavailable");
        throw new Error(`${visibleText?.slice(0, 1500)} / remote=${studies.remote.join(",")} / errors=${studies.browserErrors.join(" | ")}`, { cause });
      }
      const studiesRows = await studies.page.getByRole("table").getByRole("row").allTextContents();
      expect(studiesRows.join(" ")).toContain("Géographie");
      expect(studiesRows.join(" ")).toContain("Aline Test");
      expect(studiesRows.join(" ")).not.toContain(teacherId);
      expect(studiesRows.join(" ")).not.toMatch(/Littéraire\s*Littéraire/);
      const classChoices = await studies.page.getByRole("combobox", { name: "Filtrer l’horaire" }).locator("option").allTextContents();
      expect(classChoices.filter((label) => label.includes("Littéraire"))).toEqual(["4ème Littéraire"]);
      await fit(studies.page);
      expect(studies.remote).toEqual([]);
    } finally { /* Playwright ferme le navigateur à la fin du test. */ }
  });

  test("Enseignant : prochain cours automatique et changement de publication", async ({ browser }) => {
    const teacher = await contextFor(browser);
    let publicationChanged = false;
    try {
      await login(teacher.page, accounts.teacher);
      await teacher.page.getByRole("button", { name: "Menu", exact: true }).click();
      await expect(teacher.page.getByRole("button", { name: /Fiche de cotation/ })).toBeVisible();
      await expect(teacher.page.getByText("Documents pédagogiques")).toHaveCount(0);
      await expect(teacher.page.getByText("Ma progression pédagogique")).toHaveCount(0);
      await teacher.page.getByRole("button", { name: "Dashboard" }).click();
      await teacher.page.clock.install({ time: new Date("2026-10-14T06:59:30Z") });
      await teacher.page.reload();
      await expect(teacher.page.getByText("Prochain cours le : MERCREDI – 14 octobre 2026")).toBeVisible();
      await teacher.page.clock.fastForward(70_000);
      await expect(teacher.page.getByText("Cours en cours")).toBeVisible();
      await teacher.page.getByRole("button", { name: "Mon horaire" }).click();
      const own = await teacher.page.locator("main").allTextContents();
      expect(own.join(" ")).toContain("Géographie");
      expect(own.join(" ")).not.toContain("Bruno Fictif");
      expect(own.join(" ")).not.toContain(otherTeacherId);
      await fit(teacher.page);
      await teacher.page.getByRole("button", { name: "Dashboard" }).click();
      await db.doc(`timetables/${timetableId}`).update({ activePublished: false });
      publicationChanged = true;
      await expect(teacher.page.getByText("Aucun horaire publié pour cette année scolaire.").first()).toBeVisible({ timeout: 15_000 });
      expect(teacher.remote).toEqual([]);
    } finally {
      if (publicationChanged) await db.doc(`timetables/${timetableId}`).update({ activePublished: true });
      // Playwright ferme le navigateur à la fin du test.
    }
  });

  test("Calendrier : minuit local, suspension validée et reprise sans rechargement", async ({ browser }) => {
    const teacher = await contextFor(browser, { time: "2026-10-13T22:59:30Z" });
    const studies = await contextFor(browser);
    try {
      await login(teacher.page, accounts.teacher);
      await expect(teacher.page.getByText("Aucun cours n'est programmé pour aujourd'hui.", { exact: true })).toBeVisible();
      await teacher.page.clock.fastForward(70_000);
      await expect(teacher.page.getByText("Géographie").first()).toBeVisible();
      const existingCalendar = await db.doc(`schoolCalendars/${yearId}`).get();
      await db.doc(`schoolCalendars/${yearId}`).delete();
      await expect(teacher.page.getByText("Géographie").first()).toBeVisible();
      await db.doc(`schoolCalendars/${yearId}`).set(existingCalendar.data()!);

      await db.doc(`schoolYears/${otherYearId}`).update({ status: "active", startsAt: "2026-09-01", endsAt: "2027-07-31" });
      await expect(teacher.page.getByText("Plusieurs années scolaires couvrent cette date.")).toHaveCount(0);
      await expect(teacher.page.getByText("Géographie").first()).toBeVisible();
      await db.doc(`schools/${schoolId}`).update({ activeSchoolYearId: otherYearId });
      await expect(teacher.page.getByText("Année scolaire 2027-2028")).toBeVisible();
      await expect(teacher.page.getByText("Géographie")).toHaveCount(0);
      await db.doc(`schools/${schoolId}`).update({ activeSchoolYearId: yearId });
      await expect(teacher.page.getByText("Géographie").first()).toBeVisible();
      await db.doc(`schoolYears/${otherYearId}`).update({ status: "future", startsAt: "2027-09-01", endsAt: "2028-07-31" });

      await login(studies.page, accounts.studies);
      await studies.page.getByRole("button", { name: "Menu", exact: true }).last().click();
      await studies.page.getByRole("button", { name: "Calendrier scolaire" }).click();
      const calendar = studies.page.getByRole("dialog", { name: "Calendrier scolaire" });
      await expect(calendar).toBeVisible();
      await expect(calendar.getByText("Congé historique")).toBeVisible();
      for (const width of [375, 390, 768, 1440]) {
        await studies.page.setViewportSize({ width, height: 900 });
        const [draft, validate] = await Promise.all([calendar.getByRole("button", { name: "Enregistrer le brouillon" }).boundingBox(), calendar.getByRole("button", { name: "Valider pour l’établissement" }).boundingBox()]);
        expect(draft && validate && Math.abs(draft.width - validate.width)).toBeLessThanOrEqual(1);
        expect(await studies.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
      }
      await calendar.getByRole("button", { name: "Ajouter un événement" }).click();
      await calendar.getByRole("textbox", { name: "Titre de l’événement" }).fill("Suspension locale contrôlée");
      await calendar.getByRole("combobox", { name: "Type d’événement" }).selectOption("meeting");
      await expect(calendar.getByRole("checkbox", { name: "Suspendre les cours pendant cet événement" })).not.toBeChecked();
      await calendar.getByRole("combobox", { name: "Type d’événement" }).selectOption("suspension");
      await calendar.locator('input[type="date"]').nth(0).fill("2026-10-14");
      await calendar.locator('input[type="date"]').nth(1).fill("2026-10-14");
      await expect(calendar.getByRole("checkbox", { name: "Suspendre les cours pendant cet événement" })).toBeChecked();
      for (const width of [375, 390, 768, 1440]) {
        await studies.page.setViewportSize({ width, height: 900 });
        const [add, cancel] = await Promise.all([calendar.getByRole("button", { name: "Ajouter à la liste" }).boundingBox(), calendar.getByRole("button", { name: "Annuler" }).boundingBox()]);
        expect(add && cancel && Math.abs(add.width - cancel.width)).toBeLessThanOrEqual(1);
        expect(await studies.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
      }
      await calendar.getByRole("button", { name: "Ajouter à la liste" }).click();
      await calendar.getByRole("button", { name: "Enregistrer le brouillon" }).click();
      await expect(teacher.page.getByText("Suspendu", { exact: true })).toHaveCount(0);
      await expect(teacher.page.getByText("Géographie").first()).toBeVisible();
      studies.page.once("dialog", (dialog) => void dialog.accept());
      await calendar.getByRole("button", { name: "Valider pour l’établissement" }).click();
      await expect(teacher.page.getByText("Suspendu", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
      await expect(teacher.page.getByText("Prochain cours le", { exact: false })).toBeVisible();

      studies.page.once("dialog", (dialog) => void dialog.accept());
      await calendar.getByText("Suspension locale contrôlée").locator("..").getByRole("button", { name: "Supprimer" }).click();
      studies.page.once("dialog", (dialog) => void dialog.accept());
      await calendar.getByRole("button", { name: "Valider pour l’établissement" }).click();
      await expect(teacher.page.getByText("Géographie").first()).toBeVisible({ timeout: 15_000 });
      await expect(teacher.page.getByText("Suspendu", { exact: true })).toHaveCount(0);
      const migrated = await db.collection(`schoolCalendars/${yearId}/events`).get();
      expect(migrated.docs.map((item) => item.id)).toEqual(["legacy-holiday"]);
      expect((await db.doc(`schoolCalendars/${yearId}`).get()).data()).not.toHaveProperty("events");
      await fit(studies.page);
      await fit(teacher.page);
      expect(teacher.remote).toEqual([]);
      expect(studies.remote).toEqual([]);
    } finally {
      await teacher.context.close();
      await studies.context.close();
    }
  });

  test("HTTP : authentification, rôle, école et année sont refusés hors périmètre", async () => {
    const unauthenticated = await invokePublished({ method: "GET", headers: {}, query: { view: "published-timetable", schoolYearId: yearId } });
    expect(unauthenticated.statusCode).toBe(401);
    const signIn = async (uid: string) => {
      const response = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-test", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${uid}@local-e2e.invalid`, password, returnSecureToken: true }),
      });
      expect(response.ok).toBe(true);
      return (await response.json() as { idToken: string }).idToken;
    };
    const adminToken = await signIn(accounts.admin.uid);
    const teacherToken = await signIn(accounts.teacher.uid);
    const cashierToken = await signIn(accounts.cashier.uid);
    const invoke = (token: string, schoolYearId: string) => invokePublished({ method: "GET", headers: { authorization: `Bearer ${token}` }, query: { view: "published-timetable", schoolYearId } });
    expect((await invoke("invalid-local-token", yearId)).statusCode).toBe(401);
    expect((await invoke(cashierToken, yearId)).statusCode).toBe(403);
    expect((await invoke(adminToken, foreignYearId)).statusCode).toBe(403);
    const otherYear = await invoke(adminToken, otherYearId);
    expect(otherYear.statusCode).toBe(200);
    expect(JSON.parse(otherYear.body).timetable).toBeNull();
    const teacherSchedule = await invoke(teacherToken, yearId);
    expect(teacherSchedule.statusCode).toBe(200);
    const body = JSON.parse(teacherSchedule.body) as { timetable: { rows: Array<{ teacherDisplayName: string }> } };
    expect(body.timetable.rows).toHaveLength(3);
    expect(body.timetable.rows.every((row) => row.teacherDisplayName === "Aline Test")).toBe(true);
    expect(teacherSchedule.body).not.toContain(otherTeacherId);
  });
});
