// Reprise des Valves existantes : ajout du public lisible par les règles (audienceAll,
// audienceParentIds), calculé comme l'écran le fait aujourd'hui.
//
// 1) LECTURE SEULE (par défaut) : compte les Valves, ce qui sera ajouté, et les cas douteux.
//    Staging :    node scripts/valvesAudienceBackfill.mjs [--school=<id>]
//      Variables : GOOGLE_CLOUD_PROJECT=acadea-staging, ACADEA_VALVES_AUDIENCE_STAGING=YES, ACADEA_STAGING_ACCESS_TOKEN.
//    Production : node scripts/valvesAudienceBackfill.mjs --project=acadea-production --confirm-production=acadea-production
//      Variables : GOOGLE_CLOUD_PROJECT=acadea-production, ACADEA_PRODUCTION_MIGRATION=YES, ACADEA_PRODUCTION_ACCESS_TOKEN.
// 2) ÉCRITURE : ajouter --ecrire (production : --projet acadea-production --ecrire, plus la
//    confirmation et les variables ci-dessus). La sauvegarde JSON complète des Valves touchées est
//    écrite (par défaut dans AC-sauvegardes-donnees/valves-public-reprise) et relue AVANT toute
//    modification ; la commande de retour arrière est affichée à la fin :
//    node scripts/valvesAudienceRestore.mjs --sauvegarde=<fichier> (mêmes variables).
// Aucun identifiant de parent n'est affiché ; les jetons ne sont jamais affichés ni écrits.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Firestore } from "@google-cloud/firestore";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { applyValvesAudiencePlan, planValvesAudienceBackfill } from "../api/_lib/valvesAudienceBackfill.js";
import { parseMigrationArgs, resolveMigrationTarget } from "./migrationTarget.mjs";

// Accepte « --option=valeur » et « --option valeur » ; --projet est l'équivalent de --project.
const argv = process.argv.slice(2).flatMap((arg, index, all) => (/^--(projet|project|school|sauvegarde|confirm-production)$/.test(arg) && all[index + 1] && !all[index + 1].startsWith("--") ? [`${arg}=${all[index + 1]}`] : (index > 0 && /^--(projet|project|school|sauvegarde|confirm-production)$/.test(all[index - 1]) && !arg.startsWith("--") ? [] : [arg])));
const args = parseMigrationArgs(argv);
if (args.projet !== undefined && args.project === undefined) args.project = args.projet;
if (args.school === undefined) args.school = "toutes";
const DEFAULT_BACKUP_FOLDER = "C:/Users/Pacifique BILOMBI/Documents/AC-sauvegardes-donnees/valves-public-reprise";
const target = resolveMigrationTarget({ args, env: process.env, stagingFlag: "ACADEA_VALVES_AUDIENCE_STAGING" });
const write = args.ecrire === true;
if (write && args.sauvegarde === undefined) args.sauvegarde = DEFAULT_BACKUP_FOLDER;
if (write && (typeof args.sauvegarde !== "string" || !args.sauvegarde)) throw new Error("--ecrire exige un dossier de sauvegarde.");
const authClient = new OAuth2Client({ quotaProjectId: target.projectId });
authClient.setCredentials({ access_token: target.token });
const db = new Firestore({ projectId: target.projectId, preferRest: true, auth: new GoogleAuth({ projectId: target.projectId, authClient }) });
try {
  const plan = await planValvesAudienceBackfill({ db, schoolId: args.school });
  const summary = { projet: target.label, mode: write ? "écriture" : "lecture seule", ecole: args.school, totaux: plan.totals, ecoles: plan.schools, douteuses: plan.douteuses.slice(0, 100) };
  if (!write) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    mkdirSync(args.sauvegarde, { recursive: true });
    const file = join(args.sauvegarde, `valves-avant-public-${target.label}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    const backup = { projet: target.projectId, creeLe: new Date().toISOString(), ecole: args.school, valves: plan.ecritures.map((item) => item.original) };
    writeFileSync(file, JSON.stringify(backup, null, 2), { mode: 0o600 });
    const reread = JSON.parse(readFileSync(file, "utf8"));
    if (reread.valves?.length !== plan.ecritures.length) throw new Error("Sauvegarde incomplète : aucune écriture faite.");
    const result = await applyValvesAudiencePlan({ db, plan });
    const after = await planValvesAudienceBackfill({ db, schoolId: args.school });
    const confirmation = target.label === "production" ? " --projet acadea-production --confirm-production=acadea-production" : "";
    const retourArriere = `node scripts/valvesAudienceRestore.mjs --sauvegarde="${file}"${confirmation}`;
    console.log(JSON.stringify({ ...summary, sauvegarde: file, ecrites: result.ecrites, ignorees: result.ignorees, resteAprès: after.totals.aCompleter, retourArriere }, null, 2));
    if (result.ignorees.length || after.totals.aCompleter) process.exitCode = 1;
  }
} finally {
  await db.terminate();
}
