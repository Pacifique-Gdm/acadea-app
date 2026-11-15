// Retrait des anciennes photos intégrées aux fiches d'élèves (lot 9, étape 2).
//
// Staging (par défaut) — simulation puis application :
//   node scripts/studentPhotoLegacyCleanup.mjs --school=<id> [--apply]
//   Variables : GOOGLE_CLOUD_PROJECT=acadea-staging, ACADEA_PHOTO_MIGRATION_STAGING=YES, ACADEA_STAGING_ACCESS_TOKEN.
// Production — confirmation explicite obligatoire (voir scripts/migrationTarget.mjs) :
//   node scripts/studentPhotoLegacyCleanup.mjs --project=acadea-production --confirm-production=acadea-production --school=<id> [--apply]
//   Variables : GOOGLE_CLOUD_PROJECT=acadea-production, ACADEA_PRODUCTION_MIGRATION=YES, ACADEA_PRODUCTION_ACCESS_TOKEN.
// Jetons OAuth courts, jamais affichés ni écrits. Sauvegarde locale écrite AVANT tout retrait ;
// restauration possible avec scripts/studentPhotoLegacyRestore.mjs. Les fichiers Storage ne sont jamais touchés.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FieldValue, Firestore } from "@google-cloud/firestore";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { removeLegacyStudentPhotos } from "../api/_lib/studentPhotoLegacyCleanup.js";
import { parseMigrationArgs, resolveMigrationTarget } from "./migrationTarget.mjs";

const args = parseMigrationArgs(process.argv.slice(2));
const target = resolveMigrationTarget({ args, env: process.env, stagingFlag: "ACADEA_PHOTO_MIGRATION_STAGING" });
const { projectId, bucketName, token } = target;

const authClient = new OAuth2Client({ quotaProjectId: projectId });
authClient.setCredentials({ access_token: token });
const auth = new GoogleAuth({ projectId, authClient });
const db = new Firestore({ projectId, preferRest: true, auth });
// Lecture des informations du fichier Storage (taille), sans le télécharger.
const statObject = async (name) => {
  const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucketName}/o/${encodeURIComponent(name)}?fields=size`, { headers: { Authorization: `Bearer ${token}`, "x-goog-user-project": projectId } });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Lecture Storage refusée (HTTP ${response.status}).`);
  return response.json();
};
// Sauvegarde locale (dossier tmp/ ignoré par Git), lisible par l'utilisateur seulement.
const backup = async (content) => {
  const directory = path.resolve("tmp/backups");
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `photos-legacy-${target.label}-${content.schoolId}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(content), { mode: 0o600 });
  console.log(`Sauvegarde : ${path.relative(process.cwd(), file)} (${content.photos.length} photo(s))`);
};
try {
  const school = await db.doc(`schools/${args.school}`).get();
  if (!school.exists) throw new Error(`École introuvable sur le projet ${target.label}.`);
  const countStudents = async () => (await db.collection("students").where("schoolId", "==", args.school).count().get()).data().count;
  const result = await removeLegacyStudentPhotos({ db, statObject, deleteField: () => FieldValue.delete(), schoolId: args.school, apply: args.apply === true, backup, countStudents });
  console.log(JSON.stringify({ project: target.label, mode: args.apply === true ? "application" : "simulation", ...result }, null, 2));
} finally {
  await db.terminate();
}
