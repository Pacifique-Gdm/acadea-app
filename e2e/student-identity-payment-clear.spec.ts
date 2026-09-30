import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { parse } from "dotenv";
import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldPath, getFirestore, type DocumentReference } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { studentForPersistence } from "../src/utils/studentYearTransition.js";

test.setTimeout(300_000);

test("Admin/Secrétaire anti-doublon et Caissier A → × → B, fixtures Staging isolées", async ({ page, browser, baseURL }) => {
  expect(baseURL).toBe("https://acadea-staging.vercel.app");
  const expectedSha = process.env.E2E_EXPECTED_SHA;
  if (!expectedSha) throw new Error("SHA Staging attendu obligatoire.");
  const version = await page.request.get(`${baseURL}/version.json`);
  expect(version.ok()).toBe(true);
  expect((await version.json()).version).toBe(expectedSha);
  const environment = parse(readFileSync(".env.staging.local"));
  const credential = JSON.parse(environment.FIREBASE_SERVICE_ACCOUNT_JSON || "{}");
  expect(credential.project_id).toBe("acadea-staging");
  const app = initializeApp({ credential: cert(credential), projectId: "acadea-staging", storageBucket: "acadea-staging.firebasestorage.app" }, "student-identity-e2e");
  const db = getFirestore(app);
  db.settings({ preferRest: true });
  const auth = getAuth(app);
  const bucket = getStorage(app).bucket();
  const prefix = `e2e-student-identity-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const schoolId = `${prefix}-school`;
  const otherSchoolId = `${prefix}-other-school`;
  const yearId = `${prefix}-2027-2028`;
  const otherYearId = `${prefix}-other-2027-2028`;
  const oldAId = `${prefix}-2025-2026`;
  const oldBId = `${prefix}-2026-2027`;
  const classId = `${prefix}-class`;
  const studentAId = `${prefix}-student-a`;
  const studentBId = `${prefix}-student-b`;
  const oldStudentAId = `${prefix}-old-student-a`;
  const oldStudentBId = `${prefix}-old-student-b`;
  const oldFeeAId = `${prefix}-old-fee-a`;
  const oldFeeBId = `${prefix}-old-fee-b`;
  const accountRoles = ["school_admin", "secretary", "cashier", "other_school_admin"] as const;
  const accounts = accountRoles.map((role) => ({ role, uid: `${prefix}-${role}`, email: `${prefix}-${role}@example.test`, password: `E2e!${randomBytes(20).toString("hex")}` }));
  const errors: string[] = [];
  page.on("pageerror", () => errors.push("pageerror"));
  const otherContexts: BrowserContext[] = [];
  const student = (id: string, nom: string, schoolYearId = yearId, extra: Record<string, unknown> = {}) => studentForPersistence({
    id, schoolId, schoolYearId, matricule: id, nom, postnom: "TEST", prenom: "E2E", sexe: "F", birthDate: "2013-04-02", address: "", phone: "", className: "1ère Primaire", classId: schoolYearId === yearId ? classId : undefined, section: "Primaire", status: "ACTIVE", ...extra,
  });
  async function login(target: Page, account: (typeof accounts)[number]) {
    await target.goto("/login");
    await target.getByPlaceholder("email@ecole.com").fill(account.email);
    await target.getByPlaceholder("Votre mot de passe").fill(account.password);
    await target.getByRole("button", { name: "Se connecter", exact: true }).click();
    await expect(target).toHaveURL(/\/dashboard/, { timeout: 60_000 });
  }
  async function idToken(account: (typeof accounts)[number]) {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${environment.VITE_FIREBASE_API_KEY}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: account.email, password: account.password, returnSecureToken: true }),
    });
    if (!response.ok) throw new Error(`Authentification E2E Staging impossible (${response.status}).`);
    const payload = await response.json() as { idToken?: string };
    if (!payload.idToken) throw new Error("Token E2E Staging absent.");
    return payload.idToken;
  }
  async function manualApi(token: string, value: Record<string, unknown>) {
    return page.request.post(`${baseURL}/api/provision-school-account`, { headers: { Authorization: `Bearer ${token}` }, data: { action: "save-manual-student", student: value } });
  }
  async function openStudents(target: Page) {
    await target.getByRole("button", { name: "Élèves", exact: true }).last().click();
    await expect(target.getByRole("button", { name: "Ajouter un élève" })).toBeVisible({ timeout: 30_000 });
  }
  async function fillStudent(target: Page, nom: string, postnom: string, prenom: string) {
    await target.getByRole("button", { name: "Ajouter un élève" }).click();
    const drawer = target.getByRole("dialog", { name: "Ajouter un élève" });
    await drawer.getByLabel("Nom", { exact: true }).fill(nom);
    await drawer.getByLabel("Postnom", { exact: true }).fill(postnom);
    await drawer.getByLabel("Prénom", { exact: true }).fill(prenom);
    await drawer.getByPlaceholder("jj/mm/aaaa").fill("02/04/2013");
    await drawer.getByLabel("Classe", { exact: true }).selectOption("1ère Primaire");
    return drawer;
  }
  try {
    for (const account of accounts) {
      const tenant = account.role === "other_school_admin" ? otherSchoolId : schoolId;
      const role = account.role === "other_school_admin" ? "school_admin" : account.role;
      await auth.createUser({ uid: account.uid, email: account.email, password: account.password });
      await auth.setCustomUserClaims(account.uid, { role, schoolId: tenant });
      await db.doc(`users/${account.uid}`).set({ id: account.uid, name: `Compte E2E ${role}`, email: account.email, role, schoolId: tenant, status: "active", active: true, activeSchoolYearId: tenant === schoolId ? yearId : otherYearId });
    }
    for (const [id, activeYearId] of [[schoolId, yearId], [otherSchoolId, otherYearId]]) {
      await db.doc(`schools/${id}`).set({ id, name: `École ${id}`, schoolType: "Primaire", educationLevels: ["Maternelle", "Primaire"], activeSchoolYearId: activeYearId, status: "active", subscriptionPlan: "Premium", subscriptionStatus: "active", subscriptionAmount: 0, mainAdminId: accounts[id === schoolId ? 0 : 3].uid });
    }
    for (const [id, tenant, name, status] of [[yearId, schoolId, "2027-2028", "active"], [otherYearId, otherSchoolId, "2027-2028", "active"], [oldAId, schoolId, "2025-2026", "archived"], [oldBId, schoolId, "2026-2027", "archived"]]) {
      await db.doc(`schoolYears/${id}`).set({ id, schoolId: tenant, name, status, startsAt: name.slice(0, 4) + "-09-01", endsAt: name.slice(5) + "-07-31", currency: "CDF" });
    }
    await db.doc(`classes/${classId}`).set({ id: classId, schoolId, schoolYearId: yearId, name: "1ère Primaire", section: "Primaire", active: true });
    await db.doc(`students/${oldStudentAId}`).set(student(oldStudentAId, "E2EVA", oldAId));
    await db.doc(`students/${oldStudentBId}`).set(student(oldStudentBId, "E2EVB", oldBId));
    await db.doc(`students/${studentAId}`).set(student(studentAId, "E2EVA", yearId, { importedFromStudentId: oldStudentAId, importedFromSchoolYearId: oldAId }));
    await db.doc(`students/${studentBId}`).set(student(studentBId, "E2EVB", yearId, { importedFromStudentId: oldStudentBId, importedFromSchoolYearId: oldBId }));
    await db.doc(`feeTypes/${oldFeeAId}`).set({ id: oldFeeAId, schoolId, schoolYearId: oldAId, name: "Minerval", amount: 111, className: "1ère Primaire" });
    await db.doc(`feeTypes/${oldFeeBId}`).set({ id: oldFeeBId, schoolId, schoolYearId: oldBId, name: "Frais scolaires", amount: 222, className: "1ère Primaire" });

    await login(page, accounts[0]);
    await openStudents(page);
    const adminDrawer = await fillStudent(page, "E2EDOUBLON", "KABAMBA", "JEAN");
    await adminDrawer.getByRole("button", { name: "Sauver" }).click();
    await expect(adminDrawer).toHaveCount(0, { timeout: 30_000 });
    const created = await db.collection("students").where("schoolId", "==", schoolId).where("nom", "==", "E2EDOUBLON").get();
    expect(created.size).toBe(1);

    const secretaryContext = await browser.newContext(); otherContexts.push(secretaryContext);
    const secretaryPage = await secretaryContext.newPage();
    await login(secretaryPage, accounts[1]);
    await openStudents(secretaryPage);
    const secretaryDrawer = await fillStudent(secretaryPage, " e2edoublon ", " kabamba ", " jean ");
    await secretaryDrawer.getByRole("button", { name: "Sauver" }).click();
    await expect(secretaryDrawer.getByRole("alert")).toContainText("Un élève avec le même nom, post-nom et prénom existe déjà.");
    await expect(secretaryDrawer.getByLabel("Nom", { exact: true })).toHaveValue(" e2edoublon ");
    expect((await db.collection("students").where("schoolId", "==", schoolId).where("nom", "==", "E2EDOUBLON").get()).size).toBe(1);

    const adminToken = await idToken(accounts[0]);
    const secretaryToken = await idToken(accounts[1]);
    const candidate = (id: string) => studentForPersistence({ ...student(id, "E2ECONCURRENT"), postnom: "SIMULTANE", prenom: "A" });
    const attempts = await Promise.all([manualApi(adminToken, candidate(`student-${prefix}-admin`)), manualApi(secretaryToken, candidate(`student-${prefix}-secretary`))]);
    expect(attempts.map((response) => response.status()).sort()).toEqual([200, 409]);
    expect((await db.collection("students").where("schoolId", "==", schoolId).where("nom", "==", "E2ECONCURRENT").get()).size).toBe(1);
    const ownEdit = await manualApi(adminToken, { ...created.docs[0].data(), address: "Adresse E2E modifiée" });
    expect(ownEdit.status()).toBe(200);
    const duplicateEdit = await manualApi(adminToken, { ...created.docs[0].data(), nom: "E2EVA", postnom: "TEST", prenom: "E2E" });
    expect(duplicateEdit.status()).toBe(409);
    const otherToken = await idToken(accounts[3]);
    const otherCreate = await manualApi(otherToken, studentForPersistence({ ...student(`student-${prefix}-other`, "E2EDOUBLON"), schoolId: otherSchoolId, schoolYearId: otherYearId, classId: undefined, postnom: "KABAMBA", prenom: "JEAN" }));
    expect(otherCreate.status()).toBe(200);

    const cashierContext = await browser.newContext(); otherContexts.push(cashierContext);
    const cashierPage = await cashierContext.newPage();
    cashierPage.on("pageerror", () => errors.push("cashier-pageerror"));
    await login(cashierPage, accounts[2]);
    await cashierPage.getByRole("button", { name: "Contrôle", exact: true }).last().click();
    await cashierPage.getByRole("button", { name: "Enregistrer", exact: true }).first().click();
    const paymentDrawer = cashierPage.getByRole("dialog", { name: /Enregistrer/ });
    for (const width of [1440, 768, 390]) {
      await cashierPage.setViewportSize({ width, height: 900 });
      const search = paymentDrawer.getByPlaceholder("Rechercher par nom, postnom, prénom ou matricule");
      await search.fill("E2EVA");
      await paymentDrawer.getByRole("button", { name: /E2EVA TEST E2E/ }).click();
      await expect(paymentDrawer.getByRole("button", { name: "Effacer l’élève sélectionné" })).toBeVisible();
      const feeSelect = paymentDrawer.getByRole("combobox", { name: "Type de frais" });
      await expect(feeSelect.locator(`option[value='${oldFeeAId}']`)).toHaveCount(1, { timeout: 30_000 });
      await feeSelect.selectOption(oldFeeAId);
      await expect(paymentDrawer.getByText(/Créance de 2025-2026/)).toBeVisible({ timeout: 30_000 });
      await paymentDrawer.getByPlaceholder("Montant").fill("10");
      await paymentDrawer.getByPlaceholder("Écrivez la description").fill("Note temporaire A");
      expect(await paymentDrawer.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await paymentDrawer.getByRole("button", { name: "Effacer l’élève sélectionné" }).click();
      await expect(search).toHaveValue("");
      await expect(paymentDrawer.getByText(/Élève sélectionné/)).toHaveCount(0);
      await expect(feeSelect).toBeDisabled();
      await expect(paymentDrawer.getByPlaceholder("Montant")).toHaveValue("");
      await expect(paymentDrawer.getByPlaceholder("Écrivez la description")).toHaveValue("");
      await expect(paymentDrawer.getByText(/Créance de 2025-2026/)).toHaveCount(0);
      await search.fill("E2EVB");
      await paymentDrawer.getByRole("button", { name: /E2EVB TEST E2E/ }).click();
      await expect(feeSelect.locator(`option[value='${oldFeeBId}']`)).toHaveCount(1, { timeout: 30_000 });
      await expect(feeSelect.locator(`option[value='${oldFeeAId}']`)).toHaveCount(0);
      await feeSelect.selectOption(oldFeeBId);
      await expect(paymentDrawer.getByText(/Créance de 2026-2027/)).toBeVisible({ timeout: 30_000 });
      await expect(paymentDrawer.getByText(/Créance de 2025-2026/)).toHaveCount(0);
      await paymentDrawer.getByRole("button", { name: "Effacer l’élève sélectionné" }).click();
    }
    expect((await db.collection("payments").where("schoolId", "==", schoolId).get()).size).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    for (const context of otherContexts) await context.close().catch(() => undefined);
    for (const collection of await db.listCollections()) {
      const refs = new Map<string, DocumentReference>();
      for (const tenant of [schoolId, otherSchoolId]) (await collection.where("schoolId", "==", tenant).get()).docs.forEach((snapshot) => refs.set(snapshot.ref.path, snapshot.ref));
      (await collection.where(FieldPath.documentId(), ">=", prefix).where(FieldPath.documentId(), "<", `${prefix}\uf8ff`).get()).docs.forEach((snapshot) => refs.set(snapshot.ref.path, snapshot.ref));
      for (const ref of refs.values()) await ref.delete();
    }
    for (const action of ["students.save-manual", "finance.list-arrears"]) {
      for (const tenant of [schoolId, otherSchoolId]) {
        const hash = createHash("sha256").update(`school\u001f${tenant}\u001f${action}`).digest("hex");
        for (const snapshot of (await db.collection("_rateLimits").where("schoolIdHash", "==", hash).get()).docs) await snapshot.ref.delete();
      }
    }
    for (const account of accounts) {
      await auth.deleteUser(account.uid).catch((error: { code?: string }) => {
        if (error.code !== "auth/user-not-found") return Promise.reject(error);
      });
    }
    let firestoreResidues = 0;
    for (const collection of await db.listCollections()) {
      for (const tenant of [schoolId, otherSchoolId]) firestoreResidues += (await collection.where("schoolId", "==", tenant).get()).size;
      firestoreResidues += (await collection.where(FieldPath.documentId(), ">=", prefix).where(FieldPath.documentId(), "<", `${prefix}\uf8ff`).get()).size;
    }
    for (const account of accounts) await expect(auth.getUser(account.uid)).rejects.toMatchObject({ code: "auth/user-not-found" });
    const [files] = await bucket.getFiles({ prefix });
    expect({ firestoreResidues, storageResidues: files.length }).toEqual({ firestoreResidues: 0, storageResidues: 0 });
    await deleteApp(app);
  }
});
