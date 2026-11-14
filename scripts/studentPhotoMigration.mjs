// Copie des photos d'élèves vers Firebase Storage (lot 9) — STAGING UNIQUEMENT.
//
// Simulation (par défaut, n'écrit rien) :
//   node scripts/studentPhotoMigration.mjs --school=<id>
// Application (sauvegarde locale écrite AVANT toute copie) :
//   node scripts/studentPhotoMigration.mjs --school=<id> --apply
//
// Variables requises : GOOGLE_CLOUD_PROJECT=acadea-staging, ACADEA_PHOTO_MIGRATION_STAGING=YES,
// ACADEA_STAGING_ACCESS_TOKEN (jeton OAuth court, jamais affiché ni écrit).
// L'ancienne photo intégrée n'est jamais effacée : son effacement sera une étape séparée.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Firestore } from "@google-cloud/firestore";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { migrateStudentPhotos } from "../api/_lib/studentPhotoMigration.js";

const projectId = "acadea-staging";
const bucketName = "acadea-staging.firebasestorage.app";
const args = Object.fromEntries(process.argv.slice(2).map((arg) => { const [key, ...rest] = arg.replace(/^--/, "").split("="); return [key, rest.length ? rest.join("=") : true]; }));
if (process.env.GOOGLE_CLOUD_PROJECT !== projectId || process.env.ACADEA_PHOTO_MIGRATION_STAGING !== "YES" || !process.env.ACADEA_STAGING_ACCESS_TOKEN
  || process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error("Migration réservée au projet acadea-staging avec autorisation explicite.");
if (typeof args.school !== "string" || !args.school) throw new Error("Indiquez --school=<identifiant de l'école de test>.");

const authClient = new OAuth2Client({ quotaProjectId: projectId });
authClient.setCredentials({ access_token: process.env.ACADEA_STAGING_ACCESS_TOKEN });
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
        method: "POST", body, headers: { Authorization: `Bearer ${process.env.ACADEA_STAGING_ACCESS_TOKEN}`, "x-goog-user-project": projectId, "Content-Type": `multipart/related; boundary=${boundary}` },
      });
      if (!response.ok) throw new Error(`Envoi Storage refusé (HTTP ${response.status}).`);
    },
  }),
};
// Sauvegarde locale (dossier tmp/ ignoré par Git), lisible par l'utilisateur seulement.
const backup = async (content) => {
  const directory = path.resolve("tmp/backups");
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `photos-${content.schoolId}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(content), { mode: 0o600 });
  console.log(`Sauvegarde : ${path.relative(process.cwd(), file)} (${content.photos.length} photo(s))`);
};
try {
  const school = await db.doc(`schools/${args.school}`).get();
  if (!school.exists) throw new Error("École introuvable sur le staging.");
  const result = await migrateStudentPhotos({ db, bucket, schoolId: args.school, apply: args.apply === true, backup });
  console.log(JSON.stringify({ mode: args.apply === true ? "application" : "simulation", ...result }, null, 2));
} finally {
  await db.terminate();
}
