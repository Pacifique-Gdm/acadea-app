const fs = require("node:fs");
const path = require("node:path");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const EXPECTED_PROJECT = "acadea-staging";
const COLLECTIONS = [
  "schools", "users", "students", "classes", "teachers", "subjects", "courses",
  "pedagogicalAssignments", "timetables", "timetableEntries", "schedulePeriods",
  "vacations", "statistics", "configurations", "notifications",
];

function canonicalSection(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "maternelle") return "Maternelle";
  if (normalized === "primaire") return "Primaire";
  if (normalized === "cteb" || normalized === "cetb") return "CTEB";
  if (normalized === "secondaire") return "Secondaire";
  return undefined;
}

function loadCredential() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const envPath = path.resolve(".env.staging.local");
    if (fs.existsSync(envPath)) require("dotenv").config({ path: envPath, quiet: true });
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON est absent.");
  const credential = JSON.parse(raw);
  if (credential.project_id !== EXPECTED_PROJECT) throw new Error(`Projet refuse: ${credential.project_id ?? "inconnu"}.`);
  return credential;
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (apply && process.env.CONFIRM_SECTION_MIGRATION !== EXPECTED_PROJECT) {
    throw new Error(`Migration refusee: definir CONFIRM_SECTION_MIGRATION=${EXPECTED_PROJECT}.`);
  }
  const db = getFirestore(initializeApp({ credential: cert(loadCredential()) }));
  let inspected = 0;
  let affected = 0;
  for (const collectionName of COLLECTIONS) {
    const snapshot = await db.collection(collectionName).get();
    const changes = [];
    for (const document of snapshot.docs) {
      const data = document.data();
      const update = {};
      if (typeof data.section === "string") {
        const canonical = canonicalSection(data.section);
        if (canonical && canonical !== data.section) update.section = canonical;
      }
      if (Array.isArray(data.sectionIds)) {
        const canonical = [...new Set(data.sectionIds.map(canonicalSection).filter(Boolean))];
        if (canonical.length && JSON.stringify(canonical) !== JSON.stringify(data.sectionIds)) update.sectionIds = canonical;
      }
      if (Object.keys(update).length) {
        const fields = Object.entries(update).map(([field, nextValue]) => ({
          field,
          previousValue: data[field],
          nextValue,
        }));
        changes.push({
          id: document.id,
          schoolId: typeof data.schoolId === "string" ? data.schoolId : null,
          schoolYearId: typeof data.schoolYearId === "string" ? data.schoolYearId : null,
          fields,
          update,
        });
      }
    }
    inspected += snapshot.size;
    affected += changes.length;
    console.log(JSON.stringify({
      collection: collectionName,
      inspected: snapshot.size,
      affected: changes.length,
      documents: changes.map(({ id, schoolId, schoolYearId, fields }) => ({ id, schoolId, schoolYearId, fields })),
    }));
    if (apply) {
      for (let offset = 0; offset < changes.length; offset += 450) {
        const batch = db.batch();
        changes.slice(offset, offset + 450).forEach(({ id, update }) => batch.update(db.collection(collectionName).doc(id), update));
        await batch.commit();
      }
    }
  }
  console.log(JSON.stringify({ projectId: EXPECTED_PROJECT, mode: apply ? "apply" : "read-only", inspected, affected }));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
