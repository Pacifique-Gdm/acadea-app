import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const local = process.env.ACADEA_E2E_LOCAL_EMULATORS === "YES";
const projectId = local ? "demo-acadea" : "acadea-staging";
const manifestPath = resolve("test-results/offline-staging-fixture.json");
const collections = [
  "gradeEntries", "attendance", "students", "payments", "offlineOperationReceipts",
  "financialIdempotency", "financialCounters", "financialCashLocks",
  "studentMatriculeCounters", "studentIdentityLocks", "auditLogs", "notifications",
  "pedagogicalActivityLogs", "courseGradingConfigs", "pedagogicalAssignments",
  "feeTypes", "teachers", "subjects", "classes", "users", "schoolYears", "schools",
];

function guard() {
  if (local) {
    if (process.env.VITE_FIREBASE_PROJECT_ID !== projectId
      || process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
      || process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080"
      || process.env.FIREBASE_STORAGE_EMULATOR_HOST !== "127.0.0.1:9199"
      || process.env.ACADEA_E2E_BASE_URL !== "http://127.0.0.1:4173"
      || process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      throw new Error("Émulateurs locaux sans identifiants distants obligatoires.");
    }
    return;
  }
  if (process.env.ACADEA_STAGING_E2E !== "YES" || process.env.GITHUB_ACTIONS !== "true"
    || process.env.GITHUB_REPOSITORY !== "Pacifique-Gdm/acadea-app"
    || process.env.GITHUB_REF !== "refs/heads/codex/offline-staging-e2e-20261028"
    || process.env.GOOGLE_CLOUD_PROJECT !== projectId
    || process.env.VITE_FIREBASE_PROJECT_ID !== projectId
    || ["FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST"]
      .some((name) => process.env[name])) throw new Error("Recette limitée à GitHub Actions et acadea-staging.");
  const file = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!file || !existsSync(file) || JSON.parse(readFileSync(file, "utf8")).type !== "external_account") {
    throw new Error("Identité fédérée Google Cloud obligatoire; clé privée refusée.");
  }
}

function ids(tag) {
  return Object.fromEntries(["school", "year", "class", "subject", "teacher", "assignment", "student", "fee", "feeConflict",
    "teacherUser", "disciplineUser", "secretaryUser", "cashierUser"].map((key) => [key, `${tag}-${key}`]));
}

async function absent(db, auth, fixture) {
  const paths = [
    `schools/${fixture.ids.school}`, `schoolYears/${fixture.ids.year}`, `classes/${fixture.ids.class}`,
    `subjects/${fixture.ids.subject}`, `teachers/${fixture.ids.teacher}`,
    `pedagogicalAssignments/${fixture.ids.assignment}`, `students/${fixture.ids.student}`,
    `feeTypes/${fixture.ids.fee}`, `feeTypes/${fixture.ids.feeConflict}`, `courseGradingConfigs/${fixture.configId}`,
    ...Object.values(fixture.users).map((user) => `users/${user.uid}`),
  ];
  for (const path of paths) if ((await db.doc(path).get()).exists) throw new Error(`Chemin de fixture déjà occupé : ${path}`);
  for (const user of Object.values(fixture.users)) {
    try { await auth.getUser(user.uid); throw new Error("UID de fixture déjà occupé."); }
    catch (error) { if (error?.code !== "auth/user-not-found") throw error; }
  }
}

async function prepare(db, auth) {
  if (!process.env.ACADEA_E2E_PASSWORD || process.env.ACADEA_E2E_PASSWORD.length < 40) throw new Error("Mot de passe éphémère manquant.");
  if (existsSync(manifestPath)) throw new Error("Manifeste de fixture déjà présent.");
  const tag = `e2e-offline-${process.env.GITHUB_RUN_ID || Date.now()}-${process.env.GITHUB_RUN_ATTEMPT || 1}-${randomUUID().slice(0, 8)}`;
  const fixture = { projectId, tag, ids: ids(tag), configId: "", users: {} };
  fixture.configId = [fixture.ids.school, fixture.ids.year, fixture.ids.class, fixture.ids.subject].join("__");
  for (const role of ["teacher", "discipline_director", "secretary", "cashier"]) {
    const key = role === "discipline_director" ? "disciplineUser" : `${role}User`;
    fixture.users[role] = { uid: fixture.ids[key], email: `${tag}-${role}@example.invalid`, role };
  }
  await absent(db, auth, fixture);
  mkdirSync(resolve("test-results"), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(fixture), { mode: 0o600 });
  const { school, year, class: classId, subject, teacher, assignment, student, fee, feeConflict } = fixture.ids;
  const put = async (collection, id, data) => db.doc(`${collection}/${id}`).create({ id, schoolId: school, fixtureId: tag, ...data });
  await put("schools", school, { name: `École fictive ${tag}`, status: "active", activeSchoolYearId: year, currency: "CDF" });
  await put("schoolYears", year, { name: "2027-2028", status: "active", currency: "CDF" });
  await put("classes", classId, { schoolYearId: year, name: "1ère Primaire", section: "Primaire", active: true });
  await put("subjects", subject, { schoolYearId: year, name: "Mathématiques E2E", active: true });
  await put("students", student, { schoolYearId: year, classId, className: "1ère Primaire", section: "Primaire", status: "ACTIVE",
    nom: "Élève", postnom: "Fictif", prenom: "Alice", matricule: `${tag}-001`, sexe: "F", birthDate: "2015-04-05" });
  await put("feeTypes", fee, { schoolYearId: year, name: "Frais E2E", amount: 1000, currency: "CDF", active: true });
  await put("feeTypes", feeConflict, { schoolYearId: year, name: "Frais conflit E2E", amount: 500, currency: "CDF", active: true });
  for (const user of Object.values(fixture.users)) {
    await auth.createUser({ uid: user.uid, email: user.email, password: process.env.ACADEA_E2E_PASSWORD, emailVerified: true });
    await auth.setCustomUserClaims(user.uid, { role: user.role, schoolId: school });
    await put("users", user.uid, { role: user.role, name: `Compte fictif ${user.role}`, email: user.email,
      activeSchoolYearId: year, status: "active", active: true,
      ...(user.role === "discipline_director" ? { sectionIds: ["Primaire"] } : {}) });
  }
  await put("teachers", teacher, { schoolYearId: year, userId: fixture.users.teacher.uid, fullName: "Professeur E2E", status: "active", active: true });
  await put("pedagogicalAssignments", assignment, { schoolYearId: year, teacherId: teacher, classId, subjectId: subject, active: true });
  await put("courseGradingConfigs", fixture.configId, { schoolYearId: year, classId, subjectId: subject, maxScore: 20, active: true });
  console.log(local ? "Fixture émulateurs isolée créée." : "Fixture Staging isolée créée.");
}

async function cleanup(db, auth) {
  if (!existsSync(manifestPath)) { console.log("Aucune fixture à nettoyer."); return; }
  const fixture = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (fixture.projectId !== projectId || !/^e2e-offline-[0-9]+-[0-9]+-[0-9a-f]{8}$/.test(fixture.tag)
    || fixture.ids.school !== `${fixture.tag}-school`) throw new Error("Manifeste de fixture invalide.");
  const schoolRow = await db.doc(`schools/${fixture.ids.school}`).get();
  if (schoolRow.exists && schoolRow.data()?.fixtureId !== fixture.tag) throw new Error("École de fixture ambiguë : nettoyage arrêté.");
  for (const collection of collections) {
    const rows = await db.collection(collection).where("schoolId", "==", fixture.ids.school).get();
    for (const row of rows.docs) {
      if (row.data()?.schoolId !== fixture.ids.school) throw new Error("Document hors établissement : nettoyage arrêté.");
      if (["schools", "schoolYears", "users", "classes", "teachers", "subjects", "pedagogicalAssignments", "feeTypes", "courseGradingConfigs"]
        .includes(collection) && row.data()?.fixtureId !== fixture.tag) throw new Error("Document de fixture ambigu : nettoyage arrêté.");
      await row.ref.delete();
    }
    if (!(await db.collection(collection).where("schoolId", "==", fixture.ids.school).get()).empty) {
      throw new Error(`Résidu Firestore : ${collection}`);
    }
  }
  for (const [role, actions] of Object.entries({
    discipline_director: ["offline.attendance"],
    secretary: ["students.save-manual"],
    cashier: ["finance.create-payment"],
  })) {
    const actor = fixture.users[role];
    for (const action of actions) {
      const hash = createHash("sha256").update(`${actor.uid}\u001f${fixture.ids.school}\u001f${action}`).digest("hex");
      const schoolHash = createHash("sha256").update(`school\u001f${fixture.ids.school}\u001f${action}`).digest("hex");
      const ref = db.doc(`_rateLimits/${hash}`), row = await ref.get();
      if (row.exists) {
        if (row.data()?.schoolIdHash !== schoolHash || row.data()?.action !== action) throw new Error("Limiteur de débit ambigu : nettoyage arrêté.");
        await ref.delete();
      }
      if ((await ref.get()).exists) throw new Error("Limiteur de débit résiduel.");
    }
  }
  for (const user of Object.values(fixture.users)) {
    try {
      const record = await auth.getUser(user.uid);
      if (record.email !== user.email || (record.customClaims?.schoolId && record.customClaims.schoolId !== fixture.ids.school)) {
        throw new Error("Compte Auth ambigu : nettoyage arrêté.");
      }
      await auth.deleteUser(user.uid);
    } catch (error) { if (error?.code !== "auth/user-not-found") throw error; }
    try { await auth.getUser(user.uid); throw new Error("Compte Auth résiduel."); }
    catch (error) { if (error?.code !== "auth/user-not-found") throw error; }
  }
  console.log("Fixture Firestore/Auth supprimée et absence de résidus vérifiée. Aucun objet Storage créé.");
}

guard();
const app = initializeApp({ ...(local ? {} : { credential: applicationDefault() }), projectId });
const db = getFirestore(app), auth = getAuth(app);
const command = process.argv[2];
if (command === "prepare") await prepare(db, auth);
else if (command === "cleanup") await cleanup(db, auth);
else throw new Error("Commande attendue : prepare ou cleanup.");
