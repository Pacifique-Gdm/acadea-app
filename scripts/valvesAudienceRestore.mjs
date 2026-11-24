// Retour arrière de la reprise des Valves : remet chaque Valve de la sauvegarde comme avant
// (les champs audienceAll et audienceParentIds ajoutés sont retirés).
//   node scripts/valvesAudienceRestore.mjs --sauvegarde=<fichier JSON> [--project=… --confirm-production=…]
//   Mêmes variables que scripts/valvesAudienceBackfill.mjs.
import { readFileSync } from "node:fs";
import { FieldValue, Firestore } from "@google-cloud/firestore";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { restoreValvesAudience } from "../api/_lib/valvesAudienceBackfill.js";
import { parseMigrationArgs, resolveMigrationTarget } from "./migrationTarget.mjs";

const args = parseMigrationArgs(process.argv.slice(2));
if (args.school === undefined) args.school = "toutes";
const target = resolveMigrationTarget({ args, env: process.env, stagingFlag: "ACADEA_VALVES_AUDIENCE_STAGING" });
if (typeof args.sauvegarde !== "string") throw new Error("Indiquez --sauvegarde=<fichier JSON>.");
const backup = JSON.parse(readFileSync(args.sauvegarde, "utf8"));
if (backup.projet !== target.projectId) throw new Error(`Sauvegarde du projet ${backup.projet} : refusée pour ${target.projectId}.`);
const authClient = new OAuth2Client({ quotaProjectId: target.projectId });
authClient.setCredentials({ access_token: target.token });
const db = new Firestore({ projectId: target.projectId, preferRest: true, auth: new GoogleAuth({ projectId: target.projectId, authClient }) });
try {
  const result = await restoreValvesAudience({ db, backup, deleteField: () => FieldValue.delete() });
  console.log(JSON.stringify({ projet: target.label, sauvegarde: args.sauvegarde, valves: backup.valves?.length ?? 0, ...result }, null, 2));
} finally {
  await db.terminate();
}
