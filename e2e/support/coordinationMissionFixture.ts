import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldPath, getFirestore, type DocumentReference } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { expect, type Page } from "@playwright/test";
import { studentForPersistence } from "../../src/utils/studentYearTransition.js";

export async function coordinationMissionFixture(cleanupPrefix?: string) {
  if (cleanupPrefix && !/^e2e-coord-finance-\d{13}-[a-f0-9]{6}$/.test(cleanupPrefix)) throw new Error("Préfixe de nettoyage invalide.");
  const config = parse(readFileSync(".env.staging.local"));
  const credential = JSON.parse(config.FIREBASE_SERVICE_ACCOUNT_JSON || "{}");
  if (credential.project_id !== "acadea-staging") throw new Error("Fixture interdite hors Staging.");
  const prefix = cleanupPrefix ?? `e2e-coord-finance-${Date.now()}-${randomBytes(3).toString("hex")}`;
  const app = initializeApp({ credential: cert(credential), projectId: "acadea-staging", storageBucket: "acadea-staging.firebasestorage.app" }, prefix);
  const db = getFirestore(app);
  db.settings({ preferRest: true });
  const auth = getAuth(app);
  const schoolId = `${prefix}-school`, secondSchoolId = `${prefix}-second-school`, otherSchoolId = `${prefix}-other-school`;
  const coordinationId = `${prefix}-coord`, otherCoordinationId = `${prefix}-other-coord`, subCoordinationId = `${prefix}-sub`;
  const yearId = `${prefix}-year`, oldYearId = `${prefix}-old-year`, oldestYearId = `${prefix}-oldest-year`;
  const studentId = `${prefix}-student`, oldStudentId = `${prefix}-old-student`, oldestStudentId = `${prefix}-oldest-student`;
  const accounts = ["super_admin", "school_admin", "cashier", "coordination_admin", "sub_coordination_admin"].map((role) => ({
    uid: `${prefix}-${role}`, role, email: `${prefix}-${role}@example.test`, password: `E2e!${randomBytes(18).toString("hex")}`,
  }));
  const schoolIds = [schoolId, secondSchoolId, otherSchoolId], coordinationIds = [coordinationId, otherCoordinationId];
  const knownUserIds = new Set(accounts.map((row) => row.uid));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kinshasa", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const yesterday = new Date(`${today}T12:00:00Z`); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayKey = yesterday.toISOString().slice(0, 10);
  async function seed() {
    if (cleanupPrefix) throw new Error("Mode nettoyage uniquement.");
    for (const account of accounts) {
      const scope = account.role === "super_admin" ? {} : account.role.includes("coordination")
        ? { coordinationId, ...(account.role === "sub_coordination_admin" ? { subCoordinationId } : {}) } : { schoolId };
      await auth.createUser({ uid: account.uid, email: account.email, password: account.password });
      await auth.setCustomUserClaims(account.uid, { role: account.role, ...scope });
      await db.doc(`users/${account.uid}`).set({ id: account.uid, name: `Test ${account.role}`, email: account.email, role: account.role, status: "active", active: true, ...scope });
    }
    for (const [id, name, cid, activeYear] of [[schoolId, "École E2E Finance Coordination", coordinationId, yearId], [otherSchoolId, "École E2E Hors Périmètre", otherCoordinationId, `${prefix}-other-year`]]) {
      await db.doc(`schools/${id}`).set({ id, name, schoolType: "Mixte", educationLevels: ["Primaire", "CTEB"], activeSchoolYearId: activeYear, activeCoordinationId: cid, currency: "USD", status: "active", subscriptionPlan: "Premium", subscriptionStatus: "active", subscriptionAmount: 0 });
      await db.doc(`coordinationSchools/${cid}__${id}`).set({ id: `${cid}__${id}`, coordinationId: cid, schoolId: id, active: true, addedAt: new Date().toISOString() });
    }
    await db.doc(`coordinations/${coordinationId}`).set({ id: coordinationId, name: "Coordination E2E Finance", code: "CEF", status: "active", referenceSchoolYear: "2026-2027", principalCoordinatorUserId: accounts[3].uid });
    await db.doc(`coordinations/${otherCoordinationId}`).set({ id: otherCoordinationId, name: "Coordination E2E Isolée", status: "active" });
    await db.doc(`subCoordinations/${subCoordinationId}`).set({ id: subCoordinationId, coordinationId, coordinatorUserId: accounts[4].uid, status: "active", active: true, circumscription: "Zone Finance E2E" });
    await db.doc(`subCoordinationSchools/${subCoordinationId}__${schoolId}`).set({ id: `${subCoordinationId}__${schoolId}`, coordinationId, subCoordinationId, schoolId, active: true });
    await db.doc(`schoolYears/${prefix}-other-year`).set({ id: `${prefix}-other-year`, schoolId: otherSchoolId, name: "2026-2027", status: "active", startsAt: "2026-09-01", endsAt: "2027-07-31", currency: "USD" });
    await db.doc(`students/${prefix}-foreign-student`).set(studentForPersistence({ id: `${prefix}-foreign-student`, schoolId: otherSchoolId, schoolYearId: `${prefix}-other-year`, matricule: `${prefix}-foreign`, nom: "Hors", prenom: "Périmètre", postnom: "", birthDate: "2013-06-01", sexe: "F", status: "ACTIVE", className: "7ème CTEB" }));
    for (const [id, name, status, startsAt, currency] of [[yearId, "2026-2027", "active", "2026-09-01", "USD"], [oldYearId, "2025-2026", "archived", "2025-09-01", "USD"], [oldestYearId, "2024-2025", "archived", "2024-09-01", "CDF"]]) {
      await db.doc(`schoolYears/${id}`).set({ id, schoolId, name, status, startsAt, endsAt: `${Number(startsAt.slice(0, 4)) + 1}-07-31`, currency });
    }
    const identity = { schoolId, matricule: `${prefix}-M`, nom: "Finance", postnom: "E2E", prenom: "Élève", birthDate: "2013-06-01", sexe: "F", status: "ACTIVE" as const };
    for (const row of [
      { id: oldestStudentId, schoolYearId: oldestYearId, className: "5ème Primaire" as const },
      { id: oldStudentId, schoolYearId: oldYearId, className: "6ème Primaire" as const, importedFromStudentId: oldestStudentId },
      { id: studentId, schoolYearId: yearId, className: "7ème CTEB" as const, importedFromStudentId: oldStudentId },
    ]) await db.doc(`students/${row.id}`).set(studentForPersistence({ ...identity, ...row }));
    for (const fee of [
      { id: `${prefix}-fee-current`, schoolYearId: yearId, name: "Minerval", amount: 200, className: "7ème CTEB" },
      { id: `${prefix}-fee-old`, schoolYearId: oldYearId, name: "Minerval", amount: 100, className: "6ème Primaire" },
      { id: `${prefix}-fee-settled`, schoolYearId: oldYearId, name: "Transport", amount: 40, className: "6ème Primaire" },
      { id: `${prefix}-fee-oldest`, schoolYearId: oldestYearId, name: "Minerval", amount: 10000, className: "5ème Primaire" },
    ]) await db.doc(`feeTypes/${fee.id}`).set({ schoolId, ...fee });
    for (const payment of [
      { id: `${prefix}-current`, schoolYearId: yearId, studentId, feeTypeId: `${prefix}-fee-current`, amount: 25, paidAt: today, currency: "USD" },
      { id: `${prefix}-old-today`, schoolYearId: oldYearId, studentId: oldStudentId, feeTypeId: `${prefix}-fee-old`, amount: 20, paidAt: today, currency: "USD", collectionSchoolYearId: yearId, currentStudentId: studentId, debtSchoolYearName: "2025-2026", feeName: "Minerval" },
      { id: `${prefix}-old-yesterday`, schoolYearId: oldYearId, studentId: oldStudentId, feeTypeId: `${prefix}-fee-old`, amount: 10, paidAt: yesterdayKey, currency: "USD", collectionSchoolYearId: yearId, currentStudentId: studentId, debtSchoolYearName: "2025-2026", feeName: "Minerval" },
      { id: `${prefix}-old-iso`, schoolYearId: oldYearId, studentId: oldStudentId, feeTypeId: `${prefix}-fee-old`, amount: 5, paidAt: `${today}T14:00:00.000Z`, currency: "USD", collectionSchoolYearId: yearId, currentStudentId: studentId, debtSchoolYearName: "2025-2026", feeName: "Minerval" },
      { id: `${prefix}-settled`, schoolYearId: oldYearId, studentId: oldStudentId, feeTypeId: `${prefix}-fee-settled`, amount: 40, paidAt: "2025-10-01", currency: "USD" },
      { id: `${prefix}-cdf`, schoolYearId: oldestYearId, studentId: oldestStudentId, feeTypeId: `${prefix}-fee-oldest`, amount: 1000, paidAt: today, currency: "CDF", collectionSchoolYearId: yearId, currentStudentId: studentId, debtSchoolYearName: "2024-2025", feeName: "Minerval" },
    ]) await db.doc(`payments/${payment.id}`).set({ schoolId, cashierId: accounts[2].uid, cashierName: "Caissier E2E", createdAt: `${today}T12:00:00.000Z`, receiptNumber: `E2E-${payment.id}`, ...payment });
  }
  async function seedFilterDiscriminants() {
    if (cleanupPrefix) throw new Error("Mode nettoyage uniquement.");
    const secondYearId = `${prefix}-second-year`;
    const secondOldYearId = `${prefix}-second-old-year`;
    await db.doc(`schools/${schoolId}`).update({ educationLevels: ["Primaire", "CTEB", "Secondaire"], schoolOptions: ["Sciences", "Commerciale"] });
    await db.doc(`schools/${secondSchoolId}`).set({ id: secondSchoolId, name: "École E2E Littéraire", schoolType: "Secondaire", educationLevels: ["Secondaire"], schoolOptions: ["Littéraire"], activeSchoolYearId: secondYearId, activeCoordinationId: coordinationId, currency: "USD", status: "active", subscriptionPlan: "Premium", subscriptionStatus: "active", subscriptionAmount: 0 });
    await db.doc(`coordinationSchools/${coordinationId}__${secondSchoolId}`).set({ id: `${coordinationId}__${secondSchoolId}`, coordinationId, schoolId: secondSchoolId, active: true, addedAt: new Date().toISOString() });
    await db.doc(`subCoordinationSchools/${subCoordinationId}__${secondSchoolId}`).set({ id: `${subCoordinationId}__${secondSchoolId}`, coordinationId, subCoordinationId, schoolId: secondSchoolId, active: true });
    for (const [id, name, status, start] of [[secondYearId, "2026-2027", "active", "2026-09-01"], [secondOldYearId, "2025-2026", "archived", "2025-09-01"]]) {
      await db.doc(`schoolYears/${id}`).set({ id, schoolId: secondSchoolId, name, status, startsAt: start, endsAt: `${Number(start.slice(0, 4)) + 1}-07-31`, currency: "USD" });
    }
    const batch = db.batch();
    const classRows = [
      { id: `${prefix}-class-cteb`, schoolId, schoolYearId: yearId, name: "7ème CTEB", section: "CTEB" },
      { id: `${prefix}-class-humanites`, schoolId, schoolYearId: yearId, name: "1ère Humanité", section: "Secondaire" },
      { id: `${prefix}-class-sciences`, schoolId, schoolYearId: yearId, name: "1ère Humanité", section: "Secondaire", parentClassId: `${prefix}-class-humanites`, option: "Sciences" },
      { id: `${prefix}-class-commerciale`, schoolId, schoolYearId: yearId, name: "1ère Humanité", section: "Secondaire", parentClassId: `${prefix}-class-humanites`, option: "Commerciale" },
      { id: `${prefix}-class-old`, schoolId, schoolYearId: oldYearId, name: "6ème Primaire", section: "Primaire" },
      { id: `${prefix}-class-literature`, schoolId: secondSchoolId, schoolYearId: secondYearId, name: "2ème Humanité", section: "Secondaire" },
      { id: `${prefix}-class-literature-option`, schoolId: secondSchoolId, schoolYearId: secondYearId, name: "2ème Humanité", section: "Secondaire", parentClassId: `${prefix}-class-literature`, option: "Littéraire" },
      { id: `${prefix}-class-second-old`, schoolId: secondSchoolId, schoolYearId: secondOldYearId, name: "1ère Primaire", section: "Primaire" },
    ];
    for (const row of classRows) batch.set(db.doc(`classes/${row.id}`), { ...row, active: true });
    batch.set(db.doc(`students/${prefix}-humanites-student`), studentForPersistence({ id: `${prefix}-humanites-student`, schoolId, schoolYearId: yearId, matricule: `${prefix}-humanites`, nom: "Sciences", prenom: "Élève", postnom: "", birthDate: "2012-06-01", sexe: "F", status: "ACTIVE", className: "1ère Humanité", option: "Sciences" }));
    batch.set(db.doc(`students/${prefix}-literature-student`), studentForPersistence({ id: `${prefix}-literature-student`, schoolId: secondSchoolId, schoolYearId: secondYearId, matricule: `${prefix}-literature`, nom: "Littéraire", prenom: "Élève", postnom: "", birthDate: "2012-06-01", sexe: "F", status: "ACTIVE", className: "2ème Humanité", option: "Littéraire" }));
    for (let index = 0; index < 51; index++) {
      const id = `${prefix}-page-${String(index).padStart(2, "0")}`;
      batch.set(db.doc(`students/${id}`), studentForPersistence({ id, schoolId, schoolYearId: yearId, matricule: id, nom: `Pagination${String(index).padStart(2, "0")}`, prenom: "Élève", postnom: "", birthDate: "2013-06-01", sexe: "F", status: "ACTIVE", className: "7ème CTEB" }));
    }
    await batch.commit();
    return { secondYearId, secondOldYearId };
  }
  async function login(page: Page, role: string, credentials?: { email: string; password: string }) {
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(45000);
    const account = credentials ?? accounts.find((row) => row.role === role);
    if (!account) throw new Error("Compte fixture inconnu.");
    await page.goto("https://acadea-staging.vercel.app/login");
    await page.getByPlaceholder("email@ecole.com").fill(account.email);
    await page.getByPlaceholder("Votre mot de passe").evaluate((input, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, account.password);
    await page.getByRole("button", { name: "Se connecter", exact: true }).click();
    await expect(page.getByRole("button", { name: "Dashboard", exact: true }).last()).toBeVisible({ timeout: 60000 });
  }
  async function token(role: string) {
    const account = accounts.find((row) => row.role === role)!;
    return signIn(account);
  }
  async function signIn(account: { email: string; password: string }) {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${config.VITE_FIREBASE_API_KEY}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: account.email, password: account.password, returnSecureToken: true }) });
    if (!response.ok) throw new Error(`Authentification fixture: HTTP ${response.status}`);
    return (await response.json() as { idToken: string }).idToken;
  }
  async function ownedRefs() {
    const refs = new Map<string, DocumentReference>();
    const userDocs = await db.collection("users").where("coordinationId", "==", coordinationId).get();
    userDocs.docs.forEach((row) => knownUserIds.add(row.id));
    const uids = [...knownUserIds];
    for (const root of await db.listCollections()) {
      if (root.id === "_rateLimits") {
        for (const doc of (await root.get()).docs) {
          const row = doc.data();
          if (uids.some((uid) => createHash("sha256").update(`${uid}\u001factor\u001f${row.action}`).digest("hex") === row.actorIdHash)) refs.set(doc.ref.path, doc.ref);
        }
        continue;
      }
      await Promise.all(([ ["schoolId", schoolIds], ["coordinationId", coordinationIds], ["actorId", uids], ["createdBy", uids] ] as const).map(async ([field, values]) => {
        for (let index = 0; index < values.length; index += 30) {
          (await root.where(field, "in", values.slice(index, index + 30)).get()).docs.forEach((doc) => refs.set(doc.ref.path, doc.ref));
        }
      }));
      (await root.where(FieldPath.documentId(), ">=", prefix).where(FieldPath.documentId(), "<", `${prefix}\uf8ff`).get()).docs.forEach((doc) => refs.set(doc.ref.path, doc.ref));
    }
    return { refs, uids };
  }
  async function cleanup() {
    const owned = await ownedRefs();
    let deleted = 0;
    for (const ref of owned.refs.values()) { await ref.delete(); deleted++; }
    for (const uid of owned.uids) await auth.deleteUser(uid).catch((error: { code?: string }) => { if (error.code !== "auth/user-not-found") throw error; });
    const [files] = await getStorage(app).bucket().getFiles({ prefix });
    for (const file of files) await file.delete();
    const firestoreResidues = (await ownedRefs()).refs.size;
    let authResidues = 0, cursor: string | undefined;
    do { const result = await auth.listUsers(1000, cursor); authResidues += result.users.filter((user) => user.uid.startsWith(prefix) || user.email?.startsWith(prefix)).length; cursor = result.pageToken; } while (cursor);
    const [remainingFiles] = await getStorage(app).bucket().getFiles({ prefix });
    console.log(JSON.stringify({ cleanup: true, documentsDeleted: deleted, accountsDeleted: owned.uids.length, firestoreResidues, authResidues, storageResidues: remainingFiles.length }));
    await deleteApp(app);
    expect(firestoreResidues).toBe(0); expect(authResidues).toBe(0); expect(remainingFiles.length).toBe(0);
  }
  async function scanResidues() {
    const firestore = (await ownedRefs()).refs.size;
    let authCount = 0, cursor: string | undefined;
    do { const result = await auth.listUsers(1000, cursor); authCount += result.users.filter((user) => user.uid.startsWith(prefix) || user.email?.startsWith(prefix)).length; cursor = result.pageToken; } while (cursor);
    const [files] = await getStorage(app).bucket().getFiles({ prefix });
    return { firestore, auth: authCount, storage: files.length };
  }
  return { prefix, db, auth, seed, seedFilterDiscriminants, login, token, signIn, cleanup, scanResidues, close: () => deleteApp(app), accounts, schoolId, secondSchoolId, otherSchoolId, coordinationId, otherCoordinationId, subCoordinationId, yearId, oldYearId, oldestYearId, studentId, today, yesterdayKey };
}
