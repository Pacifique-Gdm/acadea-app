// Migration de l'index des identités d'élèves (lot 8).
//
// Staging (par défaut) — simulation puis application :
//   node scripts/studentIdentityIndexMigration.mjs --school=<id> [--apply]
//   Variables : GOOGLE_CLOUD_PROJECT=acadea-staging, ACADEA_IDENTITY_INDEX_STAGING=YES, ACADEA_STAGING_ACCESS_TOKEN.
// Production — confirmation explicite obligatoire (voir scripts/migrationTarget.mjs) :
//   node scripts/studentIdentityIndexMigration.mjs --project=acadea-production --confirm-production=acadea-production --school=<id> [--apply]
//   Variables : GOOGLE_CLOUD_PROJECT=acadea-production, ACADEA_PRODUCTION_MIGRATION=YES, ACADEA_PRODUCTION_ACCESS_TOKEN.
// Jetons OAuth courts, jamais affichés ni écrits.
// La migration lit seulement les noms des élèves, crée les verrous manquants,
// complète le champ de tri, puis pose le marqueur « complete » de l'école. Elle n'efface rien.
// Une lecture incomplète des fiches (comptage différent) arrête tout avant écriture.
import { Firestore } from "@google-cloud/firestore";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { migrateStudentIdentityIndex } from "../api/_lib/studentIdentityIndex.js";
import { parseMigrationArgs, resolveMigrationTarget } from "./migrationTarget.mjs";

const args = parseMigrationArgs(process.argv.slice(2));
const target = resolveMigrationTarget({ args, env: process.env, stagingFlag: "ACADEA_IDENTITY_INDEX_STAGING" });
const { projectId } = target;

const authClient = new OAuth2Client({ quotaProjectId: projectId });
authClient.setCredentials({ access_token: target.token });
const db = new Firestore({ projectId, preferRest: true, auth: new GoogleAuth({ projectId, authClient }) });
try {
  const school = await db.doc(`schools/${args.school}`).get();
  if (!school.exists) throw new Error(`École introuvable sur le projet ${target.label}.`);
  const countStudents = async () => (await db.collection("students").where("schoolId", "==", args.school).count().get()).data().count;
  const result = await migrateStudentIdentityIndex({ db, schoolId: args.school, apply: args.apply === true, countStudents });
  console.log(JSON.stringify({ project: target.label, mode: args.apply === true ? "application" : "simulation", ...result }, null, 2));
} finally {
  await db.terminate();
}
