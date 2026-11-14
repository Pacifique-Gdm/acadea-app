// Retrait des anciennes photos intégrées aux fiches d'élèves (lot 9, étape 2) — STAGING UNIQUEMENT.
//
// Simulation (par défaut, n'écrit rien) :
//   node scripts/studentPhotoLegacyCleanup.mjs --school=<id>
// Application (sauvegarde locale écrite AVANT tout retrait) :
//   node scripts/studentPhotoLegacyCleanup.mjs --school=<id> --apply
//
// Variables requises : GOOGLE_CLOUD_PROJECT=acadea-staging, ACADEA_PHOTO_MIGRATION_STAGING=YES,
// ACADEA_STAGING_ACCESS_TOKEN (jeton OAuth court, jamais affiché ni écrit).
// Les fichiers Storage ne sont jamais touchés.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FieldValue, Firestore } from "@google-cloud/firestore";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { removeLegacyStudentPhotos } from "../api/_lib/studentPhotoLegacyCleanup.js";

const projectId = "acadea-staging";
const bucketName = "acadea-staging.firebasestorage.app";
const args = Object.fromEntries(process.argv.slice(2).map((arg) => { const [key, ...rest] = arg.replace(/^--/, "").split("="); return [key, rest.length ? rest.join("=") : true]; }));
if (process.env.GOOGLE_CLOUD_PROJECT !== projectId || process.env.ACADEA_PHOTO_MIGRATION_STAGING !== "YES" || !process.env.ACADEA_STAGING_ACCESS_TOKEN
  || process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error("Retrait réservé au projet acadea-staging avec autorisation explicite.");
if (typeof args.school !== "string" || !args.school) throw new Error("Indiquez --school=<identifiant de l'école de test>.");

const authClient = new OAuth2Client({ quotaProjectId: projectId });
authClient.setCredentials({ access_token: process.env.ACADEA_STAGING_ACCESS_TOKEN });
const auth = new GoogleAuth({ projectId, authClient });
const db = new Firestore({ projectId, preferRest: true, auth });
// Lecture des informations du fichier Storage (taille), sans le télécharger.
const statObject = async (name) => {
  const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucketName}/o/${encodeURIComponent(name)}?fields=size`, { headers: { Authorization: `Bearer ${process.env.ACADEA_STAGING_ACCESS_TOKEN}`, "x-goog-user-project": projectId } });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Lecture Storage refusée (HTTP ${response.status}).`);
  return response.json();
};
// Sauvegarde locale (dossier tmp/ ignoré par Git), lisible par l'utilisateur seulement.
const backup = async (content) => {
  const directory = path.resolve("tmp/backups");
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `photos-legacy-${content.schoolId}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(content), { mode: 0o600 });
  console.log(`Sauvegarde : ${path.relative(process.cwd(), file)} (${content.photos.length} photo(s))`);
};
try {
  const school = await db.doc(`schools/${args.school}`).get();
  if (!school.exists) throw new Error("École introuvable sur le staging.");
  const countStudents = async () => (await db.collection("students").where("schoolId", "==", args.school).count().get()).data().count;
  const result = await removeLegacyStudentPhotos({ db, statObject, deleteField: () => FieldValue.delete(), schoolId: args.school, apply: args.apply === true, backup, countStudents });
  console.log(JSON.stringify({ mode: args.apply === true ? "application" : "simulation", ...result }, null, 2));
} finally {
  await db.terminate();
}
