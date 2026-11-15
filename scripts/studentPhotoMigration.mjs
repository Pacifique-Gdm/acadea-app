// Copie des photos d'élèves vers Firebase Storage (lot 9).
//
// Staging (par défaut) — simulation puis application :
//   node scripts/studentPhotoMigration.mjs --school=<id> [--apply]
//   Variables : GOOGLE_CLOUD_PROJECT=acadea-staging, ACADEA_PHOTO_MIGRATION_STAGING=YES, ACADEA_STAGING_ACCESS_TOKEN.
// Production — confirmation explicite obligatoire (voir scripts/migrationTarget.mjs) :
//   node scripts/studentPhotoMigration.mjs --project=acadea-production --confirm-production=acadea-production --school=<id> [--apply]
//   Variables : GOOGLE_CLOUD_PROJECT=acadea-production, ACADEA_PRODUCTION_MIGRATION=YES, ACADEA_PRODUCTION_ACCESS_TOKEN.
// Jetons OAuth courts, jamais affichés ni écrits. Sauvegarde locale écrite AVANT toute copie.
// L'ancienne photo intégrée n'est jamais effacée : son effacement est une étape séparée.
// Une lecture incomplète des fiches (comptage différent) arrête tout avant écriture.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Firestore } from "@google-cloud/firestore";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { migrateStudentPhotos } from "../api/_lib/studentPhotoMigration.js";
import { parseMigrationArgs, resolveMigrationTarget } from "./migrationTarget.mjs";

const args = parseMigrationArgs(process.argv.slice(2));
const target = resolveMigrationTarget({ args, env: process.env, stagingFlag: "ACADEA_PHOTO_MIGRATION_STAGING" });
const { projectId, bucketName, token } = target;

const authClient = new OAuth2Client({ quotaProjectId: projectId });
authClient.setCredentials({ access_token: token });
const auth = new GoogleAuth({ projectId, authClient });
const db = new Firestore({ projectId, preferRest: true, auth });
// Envoi direct par l'API REST de Storage (la bibliothèque n'accepte pas ce jeton court).
const bucket = {
  file: (name) => ({
    save: async (bytes, { contentType, metadata }) => {
      const boundary = `acadea-${Date.now()}`;
      const crlf = "\r\n";
      const head = Buffer.from([`--${boundary}`, "Content-Type: application/json; charset=UTF-8", "", JSON.stringify({ name, contentType, metadata: metadata?.metadata }),
        `--${boundary}`, `Content-Type: ${contentType}`, "", ""].join(crlf));
      const body = Buffer.concat([head, bytes, Buffer.from(`${crlf}--${boundary}--`)]);
      const response = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${bucketName}/o?uploadType=multipart&ifGenerationMatch=0`, {
        method: "POST", body, headers: { Authorization: `Bearer ${token}`, "x-goog-user-project": projectId, "Content-Type": `multipart/related; boundary=${boundary}` },
      });
      if (!response.ok) throw new Error(`Envoi Storage refusé (HTTP ${response.status}).`);
    },
    // Retrait d'une copie devenue inutile (fiche modifiée pendant la migration).
    delete: async () => {
      const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucketName}/o/${encodeURIComponent(name)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}`, "x-goog-user-project": projectId } });
      if (!response.ok && response.status !== 404) throw new Error(`Retrait Storage refusé (HTTP ${response.status}).`);
    },
  }),
};
// Sauvegarde locale (dossier tmp/ ignoré par Git), lisible par l'utilisateur seulement.
const backup = async (content) => {
  const directory = path.resolve("tmp/backups");
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `photos-${target.label}-${content.schoolId}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(content), { mode: 0o600 });
  console.log(`Sauvegarde : ${path.relative(process.cwd(), file)} (${content.photos.length} photo(s))`);
};
try {
  const school = await db.doc(`schools/${args.school}`).get();
  if (!school.exists) throw new Error(`École introuvable sur le projet ${target.label}.`);
  const countStudents = async () => (await db.collection("students").where("schoolId", "==", args.school).count().get()).data().count;
  const result = await migrateStudentPhotos({ db, bucket, schoolId: args.school, apply: args.apply === true, backup, countStudents });
  console.log(JSON.stringify({ project: target.label, mode: args.apply === true ? "application" : "simulation", ...result }, null, 2));
} finally {
  await db.terminate();
}
