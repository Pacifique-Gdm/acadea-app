// Lot 1 du Super administrateur : vignettes des logos (écoles et coordinations) et
// logo complet des coordinations rangé à part (coordinationLogos).
//
// TOUJOURS en simulation sans --apply. Étapes (--step=) :
//   backup   sauvegarde complète des logos dans --backup-dir (obligatoire ; aucune écriture Firestore) ;
//   migrate  crée les vignettes et déplace les logos des coordinations (exige --backup-file) ;
//   verify   vérifie chaque logo de la sauvegarde (aucune écriture) ;
//   restore  retour arrière depuis --backup-file.
//
// Staging (par défaut) : GOOGLE_CLOUD_PROJECT=acadea-staging, ACADEA_LOGO_MIGRATION_STAGING=YES,
//   ACADEA_STAGING_ACCESS_TOKEN.
// Production : refusée sans --production-autorisee=OUI, en plus de --project=acadea-production
//   --confirm-production=acadea-production, GOOGLE_CLOUD_PROJECT=acadea-production,
//   ACADEA_PRODUCTION_MIGRATION=YES et ACADEA_PRODUCTION_ACCESS_TOKEN.
// Jetons OAuth courts, jamais affichés ni écrits.
//
// À lancer seulement APRÈS la mise en ligne de la version qui lit coordinationLogos :
// une ancienne version de l'application ne trouverait plus le logo des coordinations.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Firestore } from "@google-cloud/firestore";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { migrateLogos, readLogoInventory, restoreLogos, verifyLogoMigration } from "../api/_lib/logoThumbnailMigration.js";
import { MIGRATION_TARGETS, parseMigrationArgs } from "./migrationTarget.mjs";

export const LOGO_MIGRATION_KIND = "acadea-logos-vignettes";

/** Vérifie le projet visé ; lève une erreur sans rien écrire. */
export function resolveLogoMigrationTarget(args, env) {
  if (env.FIRESTORE_EMULATOR_HOST) throw new Error("Émulateur configuré : migration refusée.");
  const requested = args.project === undefined ? "acadea-staging" : args.project;
  const target = typeof requested === "string" && Object.hasOwn(MIGRATION_TARGETS, requested) ? MIGRATION_TARGETS[requested] : undefined;
  if (!target) throw new Error("Projet inconnu : seuls acadea-staging et acadea-production sont acceptés.");
  if (target.label === "staging") {
    if (env.GOOGLE_CLOUD_PROJECT !== target.projectId || env.ACADEA_LOGO_MIGRATION_STAGING !== "YES" || !env[target.tokenVariable]) throw new Error("Migration réservée au projet acadea-staging avec autorisation explicite.");
  } else {
    if (args["production-autorisee"] !== "OUI") throw new Error("Production refusée : il faut le drapeau --production-autorisee=OUI (accord du propriétaire).");
    if (env.GOOGLE_CLOUD_PROJECT !== target.projectId || env.ACADEA_PRODUCTION_MIGRATION !== "YES" || args["confirm-production"] !== target.projectId || !env[target.tokenVariable]) throw new Error("Migration de production refusée : confirmation explicite manquante.");
  }
  const step = args.step;
  if (!["backup", "migrate", "verify", "restore"].includes(step)) throw new Error("Indiquez --step=backup|migrate|verify|restore.");
  if (step === "backup" && typeof args["backup-dir"] !== "string") throw new Error("Indiquez --backup-dir=<dossier de sauvegarde>.");
  return { ...target, step, apply: args.apply === true };
}

function readBackup(args, target) {
  const file = typeof args["backup-file"] === "string" ? path.resolve(args["backup-file"]) : "";
  if (!file || !existsSync(file)) throw new Error("Indiquez --backup-file=<sauvegarde complète des logos>.");
  const raw = readFileSync(file, "utf8");
  const backup = JSON.parse(raw);
  if (backup.kind !== LOGO_MIGRATION_KIND || backup.projectId !== target.projectId || !Array.isArray(backup.schools) || !Array.isArray(backup.coordinations)) throw new Error("Cette sauvegarde ne correspond pas au projet visé.");
  return { file, backup };
}

/** Vignettes fabriquées comme dans l'application : navigateur sans fenêtre, toile de dessin. */
async function thumbnailMaker() {
  const [{ chromium }, { LOGO_THUMB_ATTEMPTS, LOGO_THUMB_TARGET_CHARS, isValidLogoThumbnail }] = await Promise.all([
    import("playwright"),
    import("../api/_lib/logoThumbnail.js"),
  ]);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent("<!doctype html><title>vignettes</title>");
  const make = async (logoUrl) => {
    let source = logoUrl;
    if (/^https:\/\//i.test(source)) {
      const response = await fetch(source);
      if (!response.ok) return "";
      const type = response.headers.get("content-type") || "image/png";
      source = `data:${type};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
    }
    const encoded = await page.evaluate(async ({ source: input, attempts, target }) => {
      const image = new Image();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = input; });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      const results = [];
      for (const { size, quality } of attempts) {
        canvas.width = size; canvas.height = size;
        context.clearRect(0, 0, size, size);
        const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
        const width = image.naturalWidth * scale; const height = image.naturalHeight * scale;
        context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
        const value = canvas.toDataURL("image/webp", quality);
        results.push(value);
        if (value.length <= target) break;
      }
      return results;
    }, { source, attempts: LOGO_THUMB_ATTEMPTS, target: LOGO_THUMB_TARGET_CHARS }).catch(() => []);
    const valid = encoded.filter(isValidLogoThumbnail);
    return valid.find((value) => value.length <= LOGO_THUMB_TARGET_CHARS) ?? valid.sort((left, right) => left.length - right.length)[0] ?? "";
  };
  return { make, close: () => browser.close() };
}

async function main() {
  const args = parseMigrationArgs(process.argv.slice(2));
  const target = resolveLogoMigrationTarget(args, process.env);
  const authClient = new OAuth2Client({ quotaProjectId: target.projectId });
  authClient.setCredentials({ access_token: process.env[target.tokenVariable] });
  const db = new Firestore({ projectId: target.projectId, preferRest: true, auth: new GoogleAuth({ projectId: target.projectId, authClient }) });
  try {
    let output;
    if (target.step === "backup") {
      const inventory = await readLogoInventory(db);
      const content = { kind: LOGO_MIGRATION_KIND, projectId: target.projectId, createdAt: new Date().toISOString(), ...inventory };
      const serialized = JSON.stringify(content);
      const directory = path.resolve(args["backup-dir"]);
      mkdirSync(directory, { recursive: true });
      const file = path.join(directory, `logos-vignettes-${target.label}-${content.createdAt.replace(/[:.]/g, "-")}.json`);
      writeFileSync(file, serialized, { mode: 0o600 });
      // Relecture immédiate : la sauvegarde doit être complète et identique.
      const reread = readFileSync(file, "utf8");
      if (reread !== serialized) throw new Error("Sauvegarde relue différente : arrêt.");
      output = { step: "backup", project: target.label, schools: inventory.schools.length, schoolLogos: inventory.schools.filter((entry) => entry.logoUrl).length, coordinations: inventory.coordinations.length, coordinationLogos: inventory.coordinations.filter((entry) => entry.logoSha256).length, bytes: Buffer.byteLength(serialized), file, sha256: createHash("sha256").update(reread, "utf8").digest("hex") };
    } else {
      const { file, backup } = readBackup(args, target);
      if (target.step === "verify") output = { step: "verify", project: target.label, backupFile: file, ...(await verifyLogoMigration({ db, backup })) };
      else if (target.step === "restore") output = { step: "restore", project: target.label, backupFile: file, ...(await restoreLogos({ db, backup, apply: target.apply, force: args.force === true })) };
      else {
        // Chaque logo présent aujourd'hui doit figurer, identique, dans la sauvegarde.
        const current = await readLogoInventory(db);
        const savedSchools = new Map(backup.schools.map((entry) => [entry.id, entry.logoSha256]));
        const savedCoordinations = new Map(backup.coordinations.map((entry) => [entry.id, entry.logoSha256]));
        const notSaved = [...current.schools.filter((entry) => entry.logoSha256 && savedSchools.get(entry.id) !== entry.logoSha256), ...current.coordinations.filter((entry) => entry.logoSha256 && savedCoordinations.get(entry.id) !== entry.logoSha256)];
        if (notSaved.length) throw new Error(`${notSaved.length} logo(s) absent(s) ou différent(s) de la sauvegarde : refaites une sauvegarde.`);
        const maker = target.apply ? await thumbnailMaker() : { make: async () => "", close: async () => undefined };
        try { output = { step: "migrate", project: target.label, backupFile: file, ...(await migrateLogos({ db, makeThumbnail: maker.make, apply: target.apply })) }; }
        finally { await maker.close(); }
      }
    }
    console.log(JSON.stringify(output, null, 2));
  } finally {
    await db.terminate();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
