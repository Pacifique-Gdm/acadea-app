import "dotenv/config";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { normalizeSchoolOptions, reconcileSchoolOptionsFromStudents } from "../src/utils/schoolOptions";
import { PRODUCTION_PROJECT, STAGING_PROJECT, validateReconciliationPolicy } from "./reconcileSchoolOptionsPolicy";

type SchoolRecord = { id: string; schoolOptions?: unknown };
type StudentRecord = { schoolId?: unknown; option?: unknown };

function serviceAccount(project: string) {
  const raw = process.env[project === PRODUCTION_PROJECT ? "FIREBASE_SERVICE_ACCOUNT_JSON_PRODUCTION" : "FIREBASE_SERVICE_ACCOUNT_JSON"];
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON est requis.");
  const parsed = JSON.parse(raw) as { project_id?: string; client_email?: string; private_key?: string };
  if (parsed.project_id !== project) throw new Error("Le project_id du credential ne correspond pas au projet demandé.");
  if (!parsed.client_email || !parsed.private_key) throw new Error("Credential Firebase Admin incomplet.");
  return { projectId: parsed.project_id, clientEmail: parsed.client_email, privateKey: parsed.private_key };
}

function hasApplyConfirmation(args: string[]) {
  return args.includes("--apply");
}

async function main() {
  const args = process.argv.slice(2);
  const requestedSchoolId = args.find((arg) => arg.startsWith("--school-id="))?.slice("--school-id=".length);
  const apply = hasApplyConfirmation(args);
  const project = args.find((arg) => arg.startsWith("--project="))?.slice("--project=".length) ?? STAGING_PROJECT;
  const confirmation = args.find((arg) => arg.startsWith("--confirm="))?.slice("--confirm=".length);
  validateReconciliationPolicy({ project, schoolId: requestedSchoolId, apply, confirmation });
  const account = serviceAccount(project);
  const app = getApps()[0] ?? initializeApp({ credential: cert(account) });
  const db = getFirestore(app);
  const schoolsSnapshot = await db.collection("schools").get();
  const schools = schoolsSnapshot.docs
    .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() } as SchoolRecord))
    .filter((school) => !requestedSchoolId || school.id === requestedSchoolId);
  if (requestedSchoolId && schools.length === 0) throw new Error("École introuvable dans le projet Staging.");

  for (const school of schools) {
    const studentsSnapshot = await db.collection("students").where("schoolId", "==", school.id).get();
    const students = studentsSnapshot.docs.map((snapshot) => snapshot.data() as StudentRecord);
    const existingOptions = normalizeSchoolOptions(school.schoolOptions);
    const schoolOptions = reconcileSchoolOptionsFromStudents(existingOptions, students, school.id);
    const changed = JSON.stringify(schoolOptions) !== JSON.stringify(existingOptions);
    const historicalOptions = normalizeSchoolOptions(students.map((student) => typeof student.option === "string" ? student.option : ""));
    const addedOptions = schoolOptions.filter((option) => !existingOptions.includes(option));
    console.log(JSON.stringify({ project, schoolId: school.id, studentsInspected: students.length, existingOptions, historicalOptions, addedOptions, changed, optionCount: schoolOptions.length, mode: apply ? "apply" : "dry-run" }));
    if (apply && changed) await db.doc(`schools/${school.id}`).update({ schoolOptions });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Réconciliation impossible.");
  process.exitCode = 1;
});
