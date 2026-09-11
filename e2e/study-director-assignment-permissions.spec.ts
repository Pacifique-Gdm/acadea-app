import { expect, test, type Page } from "@playwright/test";
import { config as loadEnvironment } from "dotenv";
import { cert, deleteApp, initializeApp, type App, type ServiceAccount } from "firebase-admin/app";
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore";

const directorEmail = process.env.E2E_STUDY_DIRECTOR_EMAIL;
const directorPassword = process.env.E2E_STUDY_DIRECTOR_PASSWORD;
const stagingProjectId = "acadea-staging";

test.skip(!directorEmail || !directorPassword, "Identifiants Directeur des études Staging manquants.");
test.setTimeout(300_000);
test.use({ actionTimeout: 20_000 });

async function login(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const emailField = page.getByRole("textbox", { name: "Email", exact: true });
  await expect(emailField).toBeEditable({ timeout: 60_000 });
  await emailField.fill(directorEmail!);
  await page.getByPlaceholder("Votre mot de passe").fill(directorPassword!);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/studies/, { timeout: 60_000 });
}

async function openTeacherAssignment(page: Page, teacherName: string) {
  await page.getByRole("button", { name: "Enseignants", exact: true }).last().click();
  await expect(page.getByRole("heading", { name: "Enseignants", exact: true })).toBeVisible();
  await page.getByRole("button", { name: teacherName, exact: true }).click();
  const teacherDrawer = page.getByRole("dialog", { name: `Fiche pédagogique — ${teacherName}` });
  await teacherDrawer.getByRole("button", { name: "Ajouter affectation", exact: true }).click();
  const assignmentDrawer = page.getByRole("dialog", { name: "Ajouter une affectation" });
  await expect(assignmentDrawer).toBeVisible();
  return { teacherDrawer, assignmentDrawer };
}

test("enregistre atomiquement les affectations sur classes legacy sans permission-denied", async ({ page }) => {
  loadEnvironment({ path: ".env.staging.local", override: false, quiet: true });
  const rawCredential = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!rawCredential) throw new Error("Credential Firebase Admin Staging absent.");
  const serviceAccount = JSON.parse(rawCredential) as { project_id?: string; client_email?: string; private_key?: string };
  expect(serviceAccount.project_id).toBe(stagingProjectId);

  let adminApp: App | undefined;
  let adminDb: Firestore | undefined;
  let teacherUserId = "";
  let teacherName = "";
  let subjectId = "";
  let originalSection: unknown;
  let originalSectionIds: unknown;
  const createdClassIds = new Set<string>();
  const createdAssignmentIds = new Set<string>();
  const preexistingClassIds = new Set<string>();
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  try {
    adminApp = initializeApp({ credential: cert(serviceAccount as ServiceAccount) }, `study-assignment-e2e-${Date.now()}`);
    adminDb = getFirestore(adminApp);
    const schoolId = "staging-school-001";
    const activeYears = await adminDb.collection("schoolYears").where("schoolId", "==", schoolId).where("status", "==", "active").limit(1).get();
    expect(activeYears.empty).toBe(false);
    const schoolYearId = activeYears.docs[0].id;
    const preexistingClasses = await adminDb.collection("classes").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).get();
    preexistingClasses.docs.forEach((item) => preexistingClassIds.add(item.id));
    const teachers = await adminDb.collection("teachers").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).limit(1).get();
    expect(teachers.empty).toBe(false);
    const teacher = teachers.docs[0];
    teacherUserId = String(teacher.data().userId ?? "");
    expect(teacherUserId).not.toBe("");
    const teacherUserRef = adminDb.doc(`users/${teacherUserId}`);
    const teacherUser = await teacherUserRef.get();
    expect(teacherUser.exists).toBe(true);
    teacherName = String(teacherUser.data()?.name ?? "");
    originalSection = teacherUser.data()?.section;
    originalSectionIds = teacherUser.data()?.sectionIds;
    await teacherUserRef.update({ section: "Secondaire", sectionIds: ["Secondaire"] });

    const marker = Date.now().toString(36);
    subjectId = `${schoolId}__${schoolYearId}__affectation-e2e-${marker}`;
    const subjectName = `Cours affectation E2E ${marker}`;
    const now = new Date().toISOString();
    await adminDb.doc(`subjects/${subjectId}`).set({ id: subjectId, schoolId, schoolYearId, name: subjectName, active: true, createdAt: now, updatedAt: now, createdBy: "codex-staging-e2e" });

    await login(page);
    const { assignmentDrawer } = await openTeacherAssignment(page, teacherName);
    await expect(assignmentDrawer.getByText("Section(s) attribuée(s) : Secondaire", { exact: true })).toBeVisible();
    const selectors = assignmentDrawer.locator('button[aria-haspopup="listbox"]');
    await selectors.nth(0).click();
    await page.getByRole("listbox").getByRole("option", { name: subjectName, exact: true }).click();
    await page.keyboard.press("Escape");
    await selectors.nth(1).click();
    const classOptions = page.getByRole("listbox").getByRole("option");
    await expect.poll(() => classOptions.count()).toBeGreaterThanOrEqual(2);
    await classOptions.nth(0).click();
    await classOptions.nth(1).click();
    await page.keyboard.press("Escape");
    await assignmentDrawer.getByLabel("Nombre de périodes hebdomadaires").fill("2");
    await assignmentDrawer.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(assignmentDrawer).toBeHidden({ timeout: 30_000 });

    await expect.poll(async () => {
      const snapshot = await adminDb!.collection("pedagogicalAssignments").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).where("teacherId", "==", teacher.id).where("subjectId", "==", subjectId).get();
      snapshot.docs.forEach((item) => {
        createdAssignmentIds.add(item.id);
        createdClassIds.add(String(item.data().classId));
      });
      return snapshot.size;
    }, { timeout: 30_000 }).toBe(2);
    expect(createdClassIds.size).toBe(2);

    await page.reload();
    await expect(page).toHaveURL(/\/studies/);
    const afterRefresh = await openTeacherAssignment(page, teacherName);
    await afterRefresh.assignmentDrawer.getByRole("button", { name: "Annuler", exact: true }).click();
    await expect(afterRefresh.teacherDrawer.getByText(subjectName, { exact: true })).toBeVisible();

    await afterRefresh.teacherDrawer.getByRole("button", { name: "Fermer la fiche pédagogique" }).click();
    await page.getByRole("button", { name: "Menu", exact: true }).last().click();
    await page.getByRole("button", { name: "Déconnexion", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    await login(page);
    await page.getByRole("button", { name: "Enseignants", exact: true }).last().click();
    await page.getByRole("button", { name: teacherName, exact: true }).click();
    await expect(page.getByRole("dialog", { name: `Fiche pédagogique — ${teacherName}` }).getByText(subjectName, { exact: true })).toBeVisible();
    expect(consoleErrors.filter((message) => /permission-denied|missing or insufficient permissions/i.test(message))).toEqual([]);
  } finally {
    if (adminDb) {
      for (const assignmentId of createdAssignmentIds) await adminDb.doc(`pedagogicalAssignments/${assignmentId}`).delete().catch(() => undefined);
      for (const classId of createdClassIds) {
        const remaining = await adminDb.collection("pedagogicalAssignments").where("classId", "==", classId).limit(1).get();
        if (remaining.empty && !preexistingClassIds.has(classId)) await adminDb.doc(`classes/${classId}`).delete().catch(() => undefined);
      }
      if (subjectId) await adminDb.doc(`subjects/${subjectId}`).delete().catch(() => undefined);
      if (teacherUserId) await adminDb.doc(`users/${teacherUserId}`).update({
        section: originalSection === undefined ? FieldValue.delete() : originalSection,
        sectionIds: originalSectionIds === undefined ? FieldValue.delete() : originalSectionIds,
      }).catch(() => undefined);
    }
    if (adminApp) await deleteApp(adminApp).catch(() => undefined);
  }
});
