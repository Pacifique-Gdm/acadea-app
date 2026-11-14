// Migration de l'index des identités d'élèves (lot 8) — STAGING UNIQUEMENT.
//
// Simulation (par défaut, n'écrit rien) :
//   node scripts/studentIdentityIndexMigration.mjs --school=<id>
// Application :
//   node scripts/studentIdentityIndexMigration.mjs --school=<id> --apply
//
// Variables requises : GOOGLE_CLOUD_PROJECT=acadea-staging, ACADEA_IDENTITY_INDEX_STAGING=YES,
// ACADEA_STAGING_ACCESS_TOKEN (jeton OAuth court, jamais affiché ni écrit).
// La migration lit seulement les noms des élèves, crée les verrous manquants,
// complète le champ de tri, puis pose le marqueur « complete » de l'école. Elle n'efface rien.
import { Firestore } from "@google-cloud/firestore";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { migrateStudentIdentityIndex } from "../api/_lib/studentIdentityIndex.js";

const projectId = "acadea-staging";
const args = Object.fromEntries(process.argv.slice(2).map((arg) => { const [key, ...rest] = arg.replace(/^--/, "").split("="); return [key, rest.length ? rest.join("=") : true]; }));
if (process.env.GOOGLE_CLOUD_PROJECT !== projectId || process.env.ACADEA_IDENTITY_INDEX_STAGING !== "YES" || !process.env.ACADEA_STAGING_ACCESS_TOKEN
  || process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Migration réservée au projet acadea-staging avec autorisation explicite.");
if (typeof args.school !== "string" || !args.school) throw new Error("Indiquez --school=<identifiant de l'école de test>.");

const authClient = new OAuth2Client({ quotaProjectId: projectId });
authClient.setCredentials({ access_token: process.env.ACADEA_STAGING_ACCESS_TOKEN });
const db = new Firestore({ projectId, preferRest: true, auth: new GoogleAuth({ projectId, authClient }) });
try {
  const school = await db.doc(`schools/${args.school}`).get();
  if (!school.exists) throw new Error("École introuvable sur le staging.");
  const result = await migrateStudentIdentityIndex({ db, schoolId: args.school, apply: args.apply === true });
  console.log(JSON.stringify({ mode: args.apply === true ? "application" : "simulation", ...result }, null, 2));
} finally {
  await db.terminate();
}
