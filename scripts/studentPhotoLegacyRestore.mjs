// Restauration des anciennes photos depuis une sauvegarde de retrait (lot 9).
//
//   node scripts/studentPhotoLegacyRestore.mjs --school=<id> --backup=tmp/backups/<fichier>.json [--apply]
//   (production : ajouter --project=acadea-production --confirm-production=acadea-production,
//    avec les variables décrites dans scripts/migrationTarget.mjs)
// Simulation par défaut. Une photo plus récente n'est jamais écrasée.
import { readFileSync } from "node:fs";
import { Firestore } from "@google-cloud/firestore";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { restoreLegacyStudentPhotos } from "../api/_lib/studentPhotoLegacyCleanup.js";
import { parseMigrationArgs, resolveMigrationTarget } from "./migrationTarget.mjs";

const args = parseMigrationArgs(process.argv.slice(2));
const target = resolveMigrationTarget({ args, env: process.env, stagingFlag: "ACADEA_PHOTO_MIGRATION_STAGING" });
if (typeof args.backup !== "string" || !args.backup.endsWith(".json")) throw new Error("Indiquez --backup=<fichier de sauvegarde .json>.");
const backupContent = JSON.parse(readFileSync(args.backup, "utf8"));
const { projectId } = target;

const authClient = new OAuth2Client({ quotaProjectId: projectId });
authClient.setCredentials({ access_token: target.token });
const db = new Firestore({ projectId, preferRest: true, auth: new GoogleAuth({ projectId, authClient }) });
try {
  const result = await restoreLegacyStudentPhotos({ db, backupContent, schoolId: args.school, apply: args.apply === true });
  console.log(JSON.stringify({ project: target.label, mode: args.apply === true ? "application" : "simulation", ...result }, null, 2));
} finally {
  await db.terminate();
}
