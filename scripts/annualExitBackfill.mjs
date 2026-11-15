// Rattrapage du lot 20 : archive (avec motif) les élèves restés « actifs » dans une
// année archivée sans avoir été repris dans l'année suivante.
//
// Staging (par défaut) — simulation puis application :
//   node scripts/annualExitBackfill.mjs --school=<id> [--apply] [--include-without-import]
//   Variables : GOOGLE_CLOUD_PROJECT=acadea-staging, ACADEA_ANNUAL_EXIT_STAGING=YES, ACADEA_STAGING_ACCESS_TOKEN.
// Production — confirmation explicite obligatoire (voir scripts/migrationTarget.mjs),
// et JAMAIS --apply sans l'accord du propriétaire après lecture de la simulation :
//   node scripts/annualExitBackfill.mjs --project=acadea-production --confirm-production=acadea-production --school=<id>
//   Variables : GOOGLE_CLOUD_PROJECT=acadea-production, ACADEA_PRODUCTION_MIGRATION=YES, ACADEA_PRODUCTION_ACCESS_TOKEN.
// Catégories : after-import (import terminé : archivables), import-pending / import-in-progress
// (jamais touchées), archived-without-import (seulement avec --include-without-import).
import { Firestore } from "@google-cloud/firestore";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { planAnnualExitBackfill } from "../api/_lib/annualExitBackfill.js";
import { parseMigrationArgs, resolveMigrationTarget } from "./migrationTarget.mjs";

const args = parseMigrationArgs(process.argv.slice(2));
const target = resolveMigrationTarget({ args, env: process.env, stagingFlag: "ACADEA_ANNUAL_EXIT_STAGING" });
const { projectId } = target;
const authClient = new OAuth2Client({ quotaProjectId: projectId });
authClient.setCredentials({ access_token: target.token });
const db = new Firestore({ projectId, preferRest: true, auth: new GoogleAuth({ projectId, authClient }) });
try {
  const result = await planAnnualExitBackfill({ db, schoolId: args.school, apply: args.apply === true, includeWithoutImport: args["include-without-import"] === true });
  console.log(JSON.stringify({ project: target.label, mode: args.apply === true ? "application" : "simulation", ...result }, null, 2));
} finally {
  await db.terminate();
}
