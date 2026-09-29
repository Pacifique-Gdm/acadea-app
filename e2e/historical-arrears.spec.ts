import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { parse } from "dotenv";
import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldPath, getFirestore, type DocumentReference } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { studentForPersistence } from "../src/utils/studentYearTransition.js";

test.setTimeout(300_000);

test("un arriéré est encaissé dans l'année active sans déplacer la créance ni le frais courant", async ({ page, baseURL }) => {
  expect(baseURL).toBe("https://acadea-staging.vercel.app");
  const expectedSHA = process.env.E2E_EXPECTED_SHA;
  if (!expectedSHA) throw new Error("SHA E2E attendu obligatoire.");
  const version = await page.request.get(`${baseURL}/version.json`);
  expect(version.ok()).toBe(true);
  expect((await version.json()).version).toBe(expectedSHA);

  const config = parse(readFileSync(".env.staging.local"));
  const credential = JSON.parse(config.FIREBASE_SERVICE_ACCOUNT_JSON || "{}");
  expect(credential.project_id).toBe("acadea-staging");
  const app = initializeApp({ credential: cert(credential), projectId: "acadea-staging", storageBucket: "acadea-staging.firebasestorage.app" }, "historical-arrears-e2e");
  const db = getFirestore(app);
  db.settings({ preferRest: true });
  const auth = getAuth(app);
  const prefix = `e2e-arrears-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const schoolId = `${prefix}-school`;
  const otherSchoolId = `${prefix}-other-school`;
  const currentYearId = `${prefix}-2027-2028`;
  const olderYearId = `${prefix}-2026-2027`;
  const oldestYearId = `${prefix}-2025-2026`;
  const currentStudentId = `${prefix}-student-current`;
  const olderStudentId = `${prefix}-student-older`;
  const oldestStudentId = `${prefix}-student-oldest`;
  const cashierUid = `${prefix}-cashier`;
  const teacherUid = `${prefix}-teacher`;
  const email = `${prefix}@example.test`;
  const password = `E2e!${randomBytes(20).toString("hex")}`;
  const teacherEmail = `${prefix}-teacher@example.test`;
  const teacherPassword = `E2e!${randomBytes(20).toString("hex")}`;
  const foreignStudentId = `${prefix}-foreign-student`;
  const matricule = `${prefix}-matricule`;
  const currentFeeId = `${prefix}-fee-current`;
  const oldMinervalId = `${prefix}-fee-old-minerval`;
  const oldSchoolFeeId = `${prefix}-fee-old-school`;
  const settledFeeId = `${prefix}-fee-old-settled`;
  const oldestFeeId = `${prefix}-fee-oldest-minerval`;
  const schoolIds = [schoolId, otherSchoolId];
  const errors: string[] = [];
  page.on("pageerror", () => errors.push("pageerror"));
  async function signInToken(loginEmail: string, loginPassword: string) {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${config.VITE_FIREBASE_API_KEY}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: loginEmail, password: loginPassword, returnSecureToken: true }),
    });
    if (!response.ok) throw new Error(`Authentification E2E Staging échouée (${response.status}).`);
    const result = await response.json() as { idToken?: string };
    if (!result.idToken) throw new Error("Token E2E Staging absent.");
    return result.idToken;
  }
  async function financialApi(token: string, body: Record<string, unknown>) {
    return page.request.post(`${baseURL}/api/manage-financial-transaction`, {
      headers: { Authorization: `Bearer ${token}` }, data: body,
    });
  }

  try {
    await auth.createUser({ uid: cashierUid, email, password });
    await auth.setCustomUserClaims(cashierUid, { role: "cashier", schoolId });
    await db.doc(`users/${cashierUid}`).set({ id: cashierUid, name: "Caissier E2E Arriérés", email, role: "cashier", schoolId, status: "active", active: true });
    await auth.createUser({ uid: teacherUid, email: teacherEmail, password: teacherPassword });
    await auth.setCustomUserClaims(teacherUid, { role: "teacher", schoolId });
    await db.doc(`users/${teacherUid}`).set({ id: teacherUid, name: "Enseignant E2E Arriérés", email: teacherEmail, role: "teacher", schoolId, status: "active", active: true });
    await db.doc(`schools/${schoolId}`).set({ id: schoolId, name: "École E2E Arriérés", schoolType: "Mixte", educationLevels: ["Primaire", "CTEB"], activeSchoolYearId: currentYearId, status: "active", subscriptionPlan: "Premium", subscriptionStatus: "active", subscriptionAmount: 0, mainAdminId: cashierUid });
    await db.doc(`schools/${otherSchoolId}`).set({ id: otherSchoolId, name: "Autre école E2E Arriérés", schoolType: "Mixte", educationLevels: ["Primaire"], activeSchoolYearId: `${prefix}-other-year`, status: "active", subscriptionPlan: "Premium", subscriptionStatus: "active", subscriptionAmount: 0 });
    await db.doc(`students/${foreignStudentId}`).set(studentForPersistence({ id: foreignStudentId, schoolId: otherSchoolId, schoolYearId: `${prefix}-other-year`, matricule: `${prefix}-foreign`, nom: "Étranger", postnom: "E2E", prenom: "Test", sexe: "F", className: "6ème Primaire", birthDate: "2012-06-01", status: "ACTIVE" }));
    for (const [id, name, status, start] of [
      [oldestYearId, "2025-2026", "archived", "2025-09-01"],
      [olderYearId, "2026-2027", "archived", "2026-09-01"],
      [currentYearId, "2027-2028", "active", "2027-09-01"],
    ]) {
      await db.doc(`schoolYears/${id}`).set({ id, schoolId, name, status, startsAt: start, endsAt: `${Number(start.slice(0, 4)) + 1}-07-31`, currency: "CDF" });
    }
    const common = { schoolId, matricule, nom: "Arriérés", postnom: "E2E", prenom: "Test", sexe: "F", birthDate: "2012-06-01", status: "ACTIVE" as const };
    for (const student of [
      { id: oldestStudentId, schoolYearId: oldestYearId, className: "5ème Primaire" as const },
      { id: olderStudentId, schoolYearId: olderYearId, className: "6ème Primaire" as const, importedFromStudentId: oldestStudentId },
      { id: currentStudentId, schoolYearId: currentYearId, className: "7ème CTEB" as const, importedFromStudentId: olderStudentId },
    ]) await db.doc(`students/${student.id}`).set(studentForPersistence({ ...common, ...student }));
    for (const fee of [
      { id: oldestFeeId, schoolYearId: oldestYearId, name: "Minerval", amount: 50, className: "5ème Primaire" },
      { id: oldMinervalId, schoolYearId: olderYearId, name: "Minerval", amount: 100, className: "6ème Primaire" },
      { id: oldSchoolFeeId, schoolYearId: olderYearId, name: "Frais scolaires", amount: 80, className: "6ème Primaire" },
      { id: settledFeeId, schoolYearId: olderYearId, name: "Transport", amount: 40, className: "6ème Primaire" },
      { id: currentFeeId, schoolYearId: currentYearId, name: "Minerval", amount: 200, className: "7ème CTEB" },
    ]) await db.doc(`feeTypes/${fee.id}`).set({ ...fee, schoolId });
    for (const payment of [
      { id: `${prefix}-paid-oldest`, schoolYearId: oldestYearId, studentId: oldestStudentId, feeTypeId: oldestFeeId, amount: 30 },
      { id: `${prefix}-paid-older`, schoolYearId: olderYearId, studentId: olderStudentId, feeTypeId: oldMinervalId, amount: 70 },
      { id: `${prefix}-paid-settled`, schoolYearId: olderYearId, studentId: olderStudentId, feeTypeId: settledFeeId, amount: 40 },
    ]) await db.doc(`payments/${payment.id}`).set({ ...payment, schoolId, paidAt: "2026-06-01", createdAt: "2026-06-01T12:00:00.000Z", cashierId: cashierUid, receiptNumber: `E2E-${payment.id}` });

    await page.goto("/login");
    await page.getByPlaceholder("email@ecole.com").fill(email);
    await page.getByPlaceholder("Votre mot de passe").fill(password);
    await page.getByRole("button", { name: "Se connecter", exact: true }).click();
    await expect(page.getByRole("button", { name: "Contrôle", exact: true }).last()).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Contrôle", exact: true }).last().click();
    await page.getByRole("button", { name: "Enregistrer", exact: true }).first().click();
    const drawer = page.getByRole("dialog", { name: /Enregistrer/ });
    await drawer.getByPlaceholder("Rechercher par nom, postnom, prénom ou matricule").fill(matricule);
    await drawer.getByRole("button", { name: /Arriérés E2E Test/ }).click();
    const feeSelect = drawer.getByRole("combobox", { name: "Type de frais" });
    await expect(feeSelect.locator("optgroup[label='Dettes antérieures'] option")).toHaveCount(3);
    await expect(feeSelect.locator(`option[value='${settledFeeId}']`)).toHaveCount(0);
    await expect(feeSelect.locator(`option[value='${currentFeeId}']`)).toContainText("2027-2028");
    await expect(feeSelect.locator(`option[value='${oldestFeeId}']`)).toContainText("2025-2026");
    await expect(feeSelect.locator(`option[value='${oldSchoolFeeId}']`)).toContainText("2026-2027");
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await drawer.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      expect(await feeSelect.evaluate((element) => element.getBoundingClientRect().right <= window.innerWidth + 1)).toBe(true);
    }
    await feeSelect.selectOption(oldMinervalId);
    await expect(drawer.getByText(/Créance de 2026-2027/)).toBeVisible();
    await drawer.getByPlaceholder("Montant").fill("20");
    await drawer.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect.poll(async () => (await db.collection("payments").where("schoolId", "==", schoolId).where("feeTypeId", "==", oldMinervalId).get()).size).toBe(2);
    const newPayments = (await db.collection("payments").where("schoolId", "==", schoolId).where("collectionSchoolYearId", "==", currentYearId).get()).docs;
    expect(newPayments).toHaveLength(1);
    expect(newPayments[0].data()).toMatchObject({ schoolYearId: olderYearId, studentId: olderStudentId, currentStudentId, feeTypeId: oldMinervalId, amount: 20 });
    expect((await db.doc(`feeTypes/${currentFeeId}`).get()).data()?.amount).toBe(200);
    expect((await db.collection("payments").where("studentId", "==", currentStudentId).get()).size).toBe(0);
    await expect(feeSelect.locator(`option[value='${oldMinervalId}']`)).toContainText(/10(?:,00)?/);
    await drawer.getByPlaceholder("Montant").fill("10");
    await drawer.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect.poll(async () => (await db.collection("payments").where("schoolId", "==", schoolId).where("collectionSchoolYearId", "==", currentYearId).get()).size).toBe(2);
    await expect(feeSelect.locator(`option[value='${oldMinervalId}']`)).toHaveCount(0);
    await expect(feeSelect.locator(`option[value='${oldSchoolFeeId}']`)).toHaveCount(1);
    await expect(feeSelect.locator(`option[value='${oldestFeeId}']`)).toHaveCount(1);
    expect((await db.collection("payments").where("studentId", "==", currentStudentId).get()).size).toBe(0);
    await drawer.getByRole("button", { name: "Fermer Enregistrer", exact: true }).click();
    await page.getByRole("textbox", { name: "Rechercher un élève dans le contrôle" }).fill(matricule);
    await page.getByRole("button", { name: "Arriérés Test", exact: true }).click();
    await expect(page.getByText("Dettes des années antérieures")).toBeVisible();
    await expect(page.getByText(/Minerval · 2026-2027 · Soldée/)).toBeVisible();
    await expect(page.getByText(/Frais scolaires · 2026-2027 · À payer/)).toBeVisible();
    await expect(page.getByText(/Minerval · 2025-2026 · À payer/)).toBeVisible();
    await expect(page.getByText("Règlements des arriérés encaissés cette année")).toBeVisible();
    const cashierToken = await signInToken(email, password);
    const teacherToken = await signInToken(teacherEmail, teacherPassword);
    expect((await financialApi(cashierToken, { action: "list-arrears", schoolYearId: currentYearId, studentId: foreignStudentId })).status()).toBe(400);
    expect((await financialApi(cashierToken, { action: "create-payment", schoolYearId: currentYearId, studentId: foreignStudentId, feeTypeId: oldSchoolFeeId, debtSchoolYearId: olderYearId, amount: 1, clientRequestId: `${prefix}-foreign-attempt` })).status()).toBe(400);
    expect((await financialApi(teacherToken, { action: "list-arrears", schoolYearId: currentYearId, studentId: currentStudentId })).status()).toBe(403);
    await db.doc(`users/${cashierUid}`).update({ status: "inactive", active: false });
    expect((await financialApi(cashierToken, { action: "list-arrears", schoolYearId: currentYearId, studentId: currentStudentId })).status()).toBe(403);
    expect(errors).toEqual([]);
  } finally {
    let deleted = 0;
    for (const root of await db.listCollections()) {
      const refs = new Map<string, DocumentReference>();
      for (const id of schoolIds) (await root.where("schoolId", "==", id).get()).docs.forEach((document) => refs.set(document.id, document.ref));
      (await root.where(FieldPath.documentId(), ">=", prefix).where(FieldPath.documentId(), "<", `${prefix}\uf8ff`).get()).docs.forEach((document) => refs.set(document.id, document.ref));
      for (const ref of refs.values()) { await ref.delete(); deleted += 1; }
    }
    for (const uid of [cashierUid, teacherUid]) {
      try { await auth.deleteUser(uid); } catch (error) { if ((error as { code?: string }).code !== "auth/user-not-found") errors.push("auth-cleanup-failed"); }
    }
    let firestoreResidues = 0;
    for (const root of await db.listCollections()) {
      for (const id of schoolIds) firestoreResidues += (await root.where("schoolId", "==", id).get()).size;
      firestoreResidues += (await root.where(FieldPath.documentId(), ">=", prefix).where(FieldPath.documentId(), "<", `${prefix}\uf8ff`).get()).size;
    }
    let authResidues = 0; let cursor: string | undefined;
    do { const result = await auth.listUsers(1000, cursor); authResidues += result.users.filter((user) => user.uid.startsWith(prefix)).length; cursor = result.pageToken; } while (cursor);
    const [storage] = await getStorage(app).bucket().getFiles({ prefix: `${prefix}/` });
    console.log(JSON.stringify({ cleanup: true, documentsDeleted: deleted, accountsDeleted: 2, firestoreResidues, authResidues, storageResidues: storage.length }));
    await deleteApp(app);
    expect(firestoreResidues).toBe(0);
    expect(authResidues).toBe(0);
    expect(storage.length).toBe(0);
    expect(errors).toEqual([]);
  }
});
