// Logo de l'école rangé à part : sauvegarde, copie, retrait de l'ancien champ, retour arrière.
//
// Toujours en simulation sans --apply. Étapes (--step=) :
//   backup   sauvegarde complète des logos dans --backup-dir (aucune écriture Firestore, --apply inutile) ;
//   copy     copie chaque logo dans schoolLogos/{id} (exige --backup-file d'une sauvegarde) ;
//   cleanup  retire l'ancien champ logoUrl, seulement si chaque logo est vérifié identique
//            (exige --backup-file) ;
//   restore  retour arrière depuis --backup-file (remet logoUrl et logoVersion d'origine).
//
// Staging (par défaut) : GOOGLE_CLOUD_PROJECT=acadea-staging, ACADEA_LOGO_MIGRATION_STAGING=YES,
//   ACADEA_STAGING_ACCESS_TOKEN.
// Production : --project=acadea-production --confirm-production=acadea-production,
//   GOOGLE_CLOUD_PROJECT=acadea-production, ACADEA_PRODUCTION_MIGRATION=YES, ACADEA_PRODUCTION_ACCESS_TOKEN.
// Jetons OAuth courts, jamais affichés ni écrits.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { Firestore } from "@google-cloud/firestore";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { cleanupLegacySchoolLogos, copySchoolLogos, readSchoolLogoInventory, restoreSchoolLogos } from "../api/_lib/schoolLogoMigration.js";
import { MIGRATION_TARGETS, parseMigrationArgs } from "./migrationTarget.mjs";

const args = parseMigrationArgs(process.argv.slice(2));
const env = process.env;
if (env.FIRESTORE_EMULATOR_HOST) throw new Error("Émulateur configuré : migration refusée.");
const target = MIGRATION_TARGETS[args.project ?? "acadea-staging"];
if (!target) throw new Error("Projet inconnu : seuls acadea-staging et acadea-production sont acceptés.");
if (target.label === "staging" && (env.GOOGLE_CLOUD_PROJECT !== target.projectId || env.ACADEA_LOGO_MIGRATION_STAGING !== "YES" || !env[target.tokenVariable])) {
  throw new Error("Migration réservée au projet acadea-staging avec autorisation explicite.");
}
if (target.label === "production" && (env.GOOGLE_CLOUD_PROJECT !== target.projectId || env.ACADEA_PRODUCTION_MIGRATION !== "YES" || args["confirm-production"] !== target.projectId || !env[target.tokenVariable])) {
  throw new Error("Migration de production refusée : confirmation explicite manquante.");
}
const step = args.step;
if (!["backup", "copy", "cleanup", "restore"].includes(step)) throw new Error("Indiquez --step=backup|copy|cleanup|restore.");
const apply = args.apply === true;

function readBackup() {
  const file = typeof args["backup-file"] === "string" ? path.resolve(args["backup-file"]) : "";
  if (!file || !existsSync(file)) throw new Error("Indiquez --backup-file=<sauvegarde complète des logos>.");
  const backup = JSON.parse(readFileSync(file, "utf8"));
  if (backup.projectId !== target.projectId || !Array.isArray(backup.schools)) throw new Error("Cette sauvegarde ne correspond pas au projet visé.");
  return { file, backup };
}

const authClient = new OAuth2Client({ quotaProjectId: target.projectId });
authClient.setCredentials({ access_token: env[target.tokenVariable] });
const db = new Firestore({ projectId: target.projectId, preferRest: true, auth: new GoogleAuth({ projectId: target.projectId, authClient }) });

try {
  let output;
  if (step === "backup") {
    const directory = typeof args["backup-dir"] === "string" ? path.resolve(args["backup-dir"]) : path.resolve("tmp/backups");
    const inventory = await readSchoolLogoInventory(db);
    const content = { kind: "acadea-school-logos", projectId: target.projectId, createdAt: new Date().toISOString(), ...inventory };
    const serialized = JSON.stringify(content);
    const logos = inventory.schools.filter((entry) => entry.logoUrl).length;
    output = { step, project: target.label, schools: inventory.schoolCount, logos, bytes: Buffer.byteLength(serialized) };
    // La sauvegarde n'écrit rien dans Firestore : elle est toujours enregistrée.
    mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `logos-ecoles-${target.label}-${content.createdAt.replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, serialized, { mode: 0o600 });
    // Relecture immédiate : la sauvegarde doit être complète et identique.
    const reread = readFileSync(file, "utf8");
    if (reread !== serialized) throw new Error("Sauvegarde relue différente : arrêt.");
    output.file = file;
    output.sha256 = createHash("sha256").update(reread, "utf8").digest("hex");
  } else if (step === "restore") {
    const { file, backup } = readBackup();
    output = { step, project: target.label, backupFile: file, ...(await restoreSchoolLogos({ db, backup, apply, force: args.force === true })) };
  } else {
    const { file, backup } = readBackup();
    const current = await readSchoolLogoInventory(db);
    const saved = new Map(backup.schools.map((entry) => [entry.schoolId, entry]));
    // Chaque logo présent aujourd'hui doit figurer, identique, dans la sauvegarde.
    const notSaved = current.schools.filter((entry) => entry.logoUrl && saved.get(entry.schoolId)?.logoUrl !== entry.logoUrl).map((entry) => entry.schoolId);
    if (notSaved.length) throw new Error(`Logo absent ou différent de la sauvegarde pour ${notSaved.length} école(s) : refaites une sauvegarde.`);
    const run = step === "copy" ? copySchoolLogos : cleanupLegacySchoolLogos;
    output = { step, project: target.label, backupFile: file, ...(await run({ db, apply })) };
  }
  console.log(JSON.stringify(output, null, 2));
} finally {
  await db.terminate();
}
