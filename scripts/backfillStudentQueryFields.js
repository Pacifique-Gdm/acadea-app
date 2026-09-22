/** One-off student query-field migration. Dry-run unless --apply is explicit. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { studentSearchFields } from "../src/utils/studentSearch.js";
import { planStudentQueryFields, rollbackStudentQueryFields, sameUpdateTime, virtualSecondRun } from "./studentQueryBackfillCore.js";

const allowedArguments = new Set(["--project", "--school", "--year", "--id-prefix", "--apply", "--confirm", "--backup-dir", "--rollback-file", "--production-authorized"]);
const argumentsMap = new Map(process.argv.slice(2).map((argument) => {
  const separator = argument.indexOf("=");
  const key = separator === -1 ? argument : argument.slice(0, separator);
  if (!allowedArguments.has(key)) throw new Error(`Argument inconnu : ${key}`);
  return [key, separator === -1 ? "true" : argument.slice(separator + 1)];
}));
const projectId = argumentsMap.get("--project");
if (projectId !== "acadea-staging" && projectId !== "acadea-production") throw new Error("Projet explicite Staging ou Production requis.");
const apply = argumentsMap.get("--apply") === "true";
const rollbackFile = argumentsMap.get("--rollback-file");
const schoolId = argumentsMap.get("--school") ?? "";
const schoolYearId = argumentsMap.get("--year") ?? "";
const idPrefix = argumentsMap.get("--id-prefix") ?? "";
if (Boolean(schoolId) !== Boolean(schoolYearId)) throw new Error("--school et --year doivent être fournis ensemble.");
if (rollbackFile && (schoolId || schoolYearId || idPrefix)) throw new Error("Rollback et filtres incompatibles.");
if (apply) {
  const action = rollbackFile ? "ROLLBACK" : "BACKFILL";
  const expected = `${action}_STUDENT_QUERY_FIELDS_${projectId === "acadea-production" ? "PRODUCTION" : "STAGING"}`;
  if (argumentsMap.get("--confirm") !== expected) throw new Error("Confirmation exacte de mutation absente.");
  if (projectId === "acadea-production" && argumentsMap.get("--production-authorized") !== "true") {
    throw new Error("Autorisation Production spécifique requise.");
  }
  if (!rollbackFile && projectId === "acadea-staging" && (!schoolId || !schoolYearId || !idPrefix)) {
    throw new Error("L'écriture Staging exige école, année et préfixe de fixture.");
  }
  if (!rollbackFile && projectId === "acadea-staging" && !idPrefix.startsWith("codex-student-query-fixture-")) {
    throw new Error("L'écriture Staging est limitée aux fixtures de cette validation.");
  }
}

const repoRoot = path.resolve(import.meta.dirname, "..");
function outsideRepository(value) {
  const resolved = path.resolve(value);
  const relative = path.relative(repoRoot, resolved);
  if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("Sauvegarde hors dépôt obligatoire.");
  }
  return resolved;
}

function timestampJson(value) {
  if (!value) throw new Error("updateTime requis.");
  return { seconds: value.seconds, nanoseconds: value.nanoseconds };
}

function timestampFromJson(value) {
  if (!Number.isInteger(value?.seconds) || !Number.isInteger(value?.nanoseconds)) throw new Error("updateTime de sauvegarde invalide.");
  return new Timestamp(value.seconds, value.nanoseconds);
}

function saveExclusive(file, value) {
  fs.writeFileSync(file, JSON.stringify(value), { encoding: "utf8", flag: "wx", mode: 0o600 });
}

function saveJournal(file, value) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, file);
}

function summary(entries, inspected, empty, secondRun, collisions) {
  const groups = {};
  const fields = { sortName: 0, searchPrefixes: 0, searchArchived: 0 };
  for (const entry of entries) {
    const key = `${entry.schoolId}/${entry.schoolYearId}`;
    groups[key] = (groups[key] ?? 0) + 1;
    for (const field of entry.changedFields) fields[field] += 1;
  }
  return { projectId, mode: apply ? "apply" : "dry-run", inspected, changed: entries.length, alreadyConformant: inspected - entries.length, emptyProjections: empty, secondRunChanges: secondRun, collisionGroups: collisions, fields, groups };
}

async function plan(database) {
  const snapshot = await database.collection("students").get();
  const entries = [];
  const collisionKeys = new Map();
  let inspected = 0;
  let empty = 0;
  let secondRun = 0;
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (idPrefix && !doc.id.startsWith(idPrefix)) continue;
    if ((schoolId && data.schoolId !== schoolId) || (schoolYearId && data.schoolYearId !== schoolYearId)) continue;
    inspected += 1;
    let planned;
    try { planned = planStudentQueryFields(data, studentSearchFields); }
    catch { empty += 1; continue; }
    secondRun += virtualSecondRun(data, planned, studentSearchFields);
    const collisionKey = `${data.schoolId}/${data.schoolYearId}/${planned.projected.sortName}`;
    collisionKeys.set(collisionKey, (collisionKeys.get(collisionKey) ?? 0) + 1);
    if (planned.changedFields.length) entries.push({
      path: doc.ref.path,
      schoolId: data.schoolId,
      schoolYearId: data.schoolYearId,
      beforeUpdateTime: timestampJson(doc.updateTime),
      original: planned.original,
      projected: planned.projected,
      changedFields: planned.changedFields,
    });
  }
  const collisions = [...collisionKeys.values()].filter((value) => value > 1).length;
  return { entries, inspected, empty, secondRun, collisions };
}

async function preflight(database, entries, timestampKey) {
  const conflicts = [];
  for (const entry of entries) {
    const current = await database.doc(entry.path).get();
    if (!current.exists || !sameUpdateTime(current.updateTime, timestampFromJson(entry[timestampKey]))) conflicts.push(entry.path);
  }
  return conflicts;
}

async function applyPlan(database, result) {
  if (result.empty || result.secondRun) throw new Error("Projection ambiguë ou non idempotente : écriture refusée.");
  const backupDirectory = outsideRepository(argumentsMap.get("--backup-dir") ?? "");
  if (!argumentsMap.has("--backup-dir") || !fs.statSync(backupDirectory).isDirectory()) throw new Error("Dossier de sauvegarde privé existant requis.");
  const tag = `${projectId}-${Date.now()}-${crypto.randomUUID()}`;
  const backupFile = path.join(backupDirectory, `${tag}.json`);
  const journalFile = path.join(backupDirectory, `${tag}.results.json`);
  saveExclusive(backupFile, { schemaVersion: 1, projectId, createdAt: new Date().toISOString(), entries: result.entries });
  const journal = { schemaVersion: 1, projectId, backupFile, completed: {} };
  saveExclusive(journalFile, journal);
  const conflicts = await preflight(database, result.entries, "beforeUpdateTime");
  if (conflicts.length) throw new Error(`CONFLICT avant écriture : ${conflicts.length} document(s).`);
  let written = 0;
  for (let index = 0; index < result.entries.length; index += 25) {
    const chunk = result.entries.slice(index, index + 25);
    const batch = database.batch();
    for (const entry of chunk) {
      const updates = Object.fromEntries(entry.changedFields.map((field) => [field, entry.projected[field]]));
      batch.update(database.doc(entry.path), updates, { lastUpdateTime: timestampFromJson(entry.beforeUpdateTime) });
    }
    const results = await batch.commit();
    for (let position = 0; position < chunk.length; position += 1) {
      journal.completed[chunk[position].path] = timestampJson(results[position].writeTime);
    }
    saveJournal(journalFile, journal);
    written += chunk.length;
  }
  return { written, conflicts: 0, backupFile, journalFile };
}

async function rollback(database) {
  const backupPath = outsideRepository(rollbackFile);
  const manifest = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  const journalPath = backupPath.replace(/\.json$/, ".results.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  if (manifest.schemaVersion !== 1 || journal.schemaVersion !== 1 || manifest.projectId !== projectId || journal.projectId !== projectId || journal.backupFile !== backupPath) {
    throw new Error("Manifeste/journal de rollback incompatibles.");
  }
  const completed = manifest.entries.filter((entry) => journal.completed[entry.path]);
  const unjournaled = manifest.entries.length - completed.length;
  if (!apply) return { projectId, mode: "rollback-dry-run", completed: completed.length, unjournaled };
  if (unjournaled) throw new Error("Écritures non journalisées possibles : rollback automatique refusé.");
  const conflicts = await preflight(database, completed.map((entry) => ({ ...entry, afterUpdateTime: journal.completed[entry.path] })), "afterUpdateTime");
  if (conflicts.length) throw new Error(`CONFLICT avant rollback : ${conflicts.length} document(s).`);
  let restored = 0;
  for (let index = 0; index < completed.length; index += 25) {
    const chunk = completed.slice(index, index + 25);
    const batch = database.batch();
    for (const entry of chunk) {
      batch.update(database.doc(entry.path), rollbackStudentQueryFields(entry.original, entry.changedFields, FieldValue.delete()), { lastUpdateTime: timestampFromJson(journal.completed[entry.path]) });
    }
    await batch.commit();
    restored += chunk.length;
  }
  return { projectId, mode: "rollback-apply", restored, conflicts: 0 };
}

async function main() {
  const envFile = path.resolve(repoRoot, projectId === "acadea-production" ? ".env.production.local" : ".env.staging.local");
  const raw = dotenv.parse(fs.readFileSync(envFile)).FIREBASE_SERVICE_ACCOUNT_JSON;
  const credential = JSON.parse(raw);
  if (credential.type !== "service_account" || credential.project_id !== projectId) throw new Error("Credential/projet non concordants.");
  const app = initializeApp({ credential: cert(credential), projectId }, `student-query-${Date.now()}`);
  try {
    const database = getFirestore(app);
    if (rollbackFile) return console.log(JSON.stringify(await rollback(database)));
    const result = await plan(database);
    const report = summary(result.entries, result.inspected, result.empty, result.secondRun, result.collisions);
    if (apply) console.log(JSON.stringify({ ...report, ...(await applyPlan(database, result)) }));
    else console.log(JSON.stringify(report));
  } finally { await deleteApp(app); }
}

main().catch((error) => {
  const message = String(error?.message ?? "");
  const safe = /^(?:CONFLICT avant (?:écriture|rollback) : \d+ document\(s\)\.|Projection ambiguë.*|Dossier de sauvegarde privé existant requis\.|Manifeste\/journal de rollback incompatibles\.|Écritures non journalisées possibles.*|Credential\/projet non concordants\.)$/.test(message);
  console.error(JSON.stringify({ failed: true, reason: safe ? message : "Erreur inattendue ; aucune donnée sensible affichée.", errorType: error?.name ?? "unknown" }));
  process.exitCode = 1;
});
