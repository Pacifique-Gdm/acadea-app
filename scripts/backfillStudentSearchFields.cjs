const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");
const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { FieldPath, getFirestore } = require("firebase-admin/firestore");

const EXPECTED_PROJECT = "acadea-staging";
const args = new Map(process.argv.slice(2).map((argument) => {
  const separator = argument.indexOf("=");
  return separator === -1 ? [argument, "true"] : [argument.slice(0, separator), argument.slice(separator + 1)];
}));

if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  const environmentPath = path.resolve(process.cwd(), ".env.staging.local");
  if (fs.existsSync(environmentPath)) dotenv.config({ path: environmentPath, quiet: true });
}
const rawCredential = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!rawCredential) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON Staging est absent.");
const credential = JSON.parse(rawCredential);
if (credential.project_id !== EXPECTED_PROJECT) throw new Error(`Projet Firebase refusé : ${credential.project_id ?? "inconnu"}.`);
if (args.get("--project") !== EXPECTED_PROJECT) throw new Error("--project=acadea-staging est obligatoire.");

const apply = args.get("--apply") === "true";
if (apply && args.get("--confirm") !== "BACKFILL_STUDENT_SEARCH_STAGING") throw new Error("Confirmation de backfill Staging absente.");
const selectedSchool = args.get("--school") ?? "";
const selectedYear = args.get("--year") ?? "";
if (Boolean(selectedSchool) !== Boolean(selectedYear)) throw new Error("--school et --year doivent être fournis ensemble.");

async function run() {
  const { studentSearchFields } = await import("../src/utils/studentSearch.js");
  const app = getApps()[0] ?? initializeApp({ credential: cert(credential), projectId: EXPECTED_PROJECT });
  const database = getFirestore(app);
  const scopes = [];
  if (selectedSchool && selectedYear) {
    scopes.push({ schoolId: selectedSchool, schoolYearId: selectedYear });
  } else {
    const years = await database.collection("schoolYears").get();
    for (const snapshot of years.docs) {
      const value = snapshot.data();
      if (typeof value.schoolId === "string" && value.schoolId && snapshot.id) scopes.push({ schoolId: value.schoolId, schoolYearId: snapshot.id });
    }
  }

  let inspected = 0;
  let changed = 0;
  for (const scope of scopes) {
    let cursor;
    do {
      let request = database.collection("students")
        .where("schoolId", "==", scope.schoolId)
        .where("schoolYearId", "==", scope.schoolYearId)
        .orderBy(FieldPath.documentId())
        .limit(400);
      if (cursor) request = request.startAfter(cursor);
      const snapshot = await request.get();
      if (snapshot.empty) break;
      const updates = [];
      for (const document of snapshot.docs) {
        inspected += 1;
        const current = document.data();
        const next = studentSearchFields(current);
        const samePrefixes = Array.isArray(current.searchPrefixes)
          && current.searchPrefixes.length === next.searchPrefixes.length
          && current.searchPrefixes.every((value, index) => value === next.searchPrefixes[index]);
        if (!samePrefixes || current.searchArchived !== next.searchArchived) updates.push({ reference: document.ref, next });
      }
      changed += updates.length;
      if (apply && updates.length) {
        const batch = database.batch();
        updates.forEach(({ reference, next }) => batch.update(reference, next));
        await batch.commit();
      }
      cursor = snapshot.docs.at(-1);
    } while (cursor);
  }
  process.stdout.write(JSON.stringify({ projectId: EXPECTED_PROJECT, mode: apply ? "apply" : "dry-run", scopes: scopes.length, inspected, changed }) + "\n");
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
