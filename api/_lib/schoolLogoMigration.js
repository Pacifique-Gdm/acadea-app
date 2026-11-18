import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { SCHOOL_LOGO_COLLECTION, schoolLogoVersion } from "./schoolLogo.js";

// Migration « logo de l'école rangé à part » (voir scripts/schoolLogoMigration.mjs).
// Étapes, toutes en simulation par défaut :
//   1. backup  : sauvegarde complète des logos (rien n'est écrit dans Firestore) ;
//   2. copy    : copie de chaque logo dans schoolLogos/{id} + repère logoVersion sur l'école
//                (l'ancien champ logoUrl reste en place) ;
//   3. cleanup : retrait de l'ancien champ logoUrl, seulement si CHAQUE logo a été
//                vérifié identique dans sa copie ; sinon rien n'est retiré ;
//   4. restore : retour arrière depuis la sauvegarde (remet logoUrl et logoVersion d'origine).

export const MIGRATION_ACTOR = "migration-logo-ecole";

const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");

function legacyLogoOf(data) {
  return typeof data?.logoUrl === "string" ? data.logoUrl : "";
}

/** Photographie complète des logos de toutes les écoles (pour la sauvegarde). */
export async function readSchoolLogoInventory(db) {
  const [schools, logos] = await Promise.all([db.collection("schools").get(), db.collection(SCHOOL_LOGO_COLLECTION).get()]);
  const logoDocs = new Map(logos.docs.map((document) => [document.id, document.data()]));
  const entries = schools.docs.map((document) => {
    const data = document.data() ?? {};
    const logoUrl = legacyLogoOf(data);
    const copy = logoDocs.get(document.id);
    return {
      schoolId: document.id,
      name: typeof data.name === "string" ? data.name : "",
      hadLogoUrlField: Object.hasOwn(data, "logoUrl"),
      logoUrl,
      logoSha256: logoUrl ? sha256(logoUrl) : "",
      hadLogoVersionField: Object.hasOwn(data, "logoVersion"),
      logoVersion: typeof data.logoVersion === "string" ? data.logoVersion : "",
      copy: copy ? { logoUrl: legacyLogoOf(copy), logoVersion: copy.logoVersion ?? "" } : null,
    };
  });
  return { schools: entries, schoolCount: schools.size, logoDocCount: logos.size };
}

/** Une copie est conforme si elle est identique, octet par octet, à l'ancien logo. */
export function copyMatches(entry) {
  const version = schoolLogoVersion(entry.logoUrl);
  return Boolean(entry.logoUrl && entry.copy && entry.copy.logoUrl === entry.logoUrl && entry.copy.logoVersion === version && entry.logoVersion === version);
}

export function planSchoolLogoCopy(inventory) {
  const withLogo = inventory.schools.filter((entry) => entry.logoUrl);
  return {
    toCopy: withLogo.filter((entry) => !copyMatches(entry)).map((entry) => entry.schoolId),
    alreadyCopied: withLogo.filter(copyMatches).map((entry) => entry.schoolId),
    withoutLogo: inventory.schools.filter((entry) => !entry.logoUrl).map((entry) => entry.schoolId),
  };
}

export async function copySchoolLogos({ db, apply = false, now = () => new Date().toISOString() }) {
  const inventory = await readSchoolLogoInventory(db);
  const plan = planSchoolLogoCopy(inventory);
  const result = { mode: apply ? "application" : "simulation", schools: inventory.schoolCount, toCopy: plan.toCopy.length, alreadyCopied: plan.alreadyCopied.length, withoutLogo: plan.withoutLogo.length, copied: 0, skipped: [] };
  if (!apply) return result;
  for (const schoolId of plan.toCopy) {
    const schoolRef = db.doc(`schools/${schoolId}`);
    const logoRef = db.doc(`${SCHOOL_LOGO_COLLECTION}/${schoolId}`);
    const outcome = await db.runTransaction(async (transaction) => {
      const school = await transaction.get(schoolRef);
      const logoUrl = legacyLogoOf(school.data());
      if (!school.exists || !logoUrl) return "logo absent au moment de la copie";
      const logoVersion = schoolLogoVersion(logoUrl);
      transaction.set(logoRef, { schoolId, logoUrl, logoVersion, updatedAt: now(), updatedBy: MIGRATION_ACTOR });
      transaction.update(schoolRef, { logoVersion });
      return "copié";
    });
    if (outcome === "copié") result.copied += 1;
    else result.skipped.push({ schoolId, reason: outcome });
  }
  const after = planSchoolLogoCopy(await readSchoolLogoInventory(db));
  result.verifiedAfterCopy = after.toCopy.length === 0;
  result.remainingToCopy = after.toCopy;
  return result;
}

export function planLegacyCleanup(inventory) {
  const withField = inventory.schools.filter((entry) => entry.hadLogoUrlField);
  const unverified = withField.filter((entry) => entry.logoUrl && !copyMatches(entry));
  return { withField: withField.map((entry) => entry.schoolId), verified: withField.filter((entry) => !entry.logoUrl || copyMatches(entry)).map((entry) => entry.schoolId), unverified: unverified.map((entry) => entry.schoolId) };
}

export async function cleanupLegacySchoolLogos({ db, apply = false }) {
  const inventory = await readSchoolLogoInventory(db);
  const plan = planLegacyCleanup(inventory);
  const result = { mode: apply ? "application" : "simulation", schools: inventory.schoolCount, withLegacyField: plan.withField.length, verified: plan.verified.length, unverified: plan.unverified, removed: 0, skipped: [] };
  // Aucun retrait tant qu'un seul logo n'est pas vérifié identique dans sa copie.
  if (plan.unverified.length > 0) return { ...result, refused: "Au moins un logo n'est pas recopié à l'identique : aucun champ n'est retiré." };
  if (!apply) return result;
  for (const schoolId of plan.withField) {
    const schoolRef = db.doc(`schools/${schoolId}`);
    const logoRef = db.doc(`${SCHOOL_LOGO_COLLECTION}/${schoolId}`);
    const outcome = await db.runTransaction(async (transaction) => {
      const [school, copy] = await Promise.all([transaction.get(schoolRef), transaction.get(logoRef)]);
      const data = school.data() ?? {};
      if (!school.exists || !Object.hasOwn(data, "logoUrl")) return "champ déjà absent";
      const logoUrl = legacyLogoOf(data);
      const entry = { logoUrl, logoVersion: data.logoVersion ?? "", copy: copy.exists ? { logoUrl: legacyLogoOf(copy.data()), logoVersion: copy.data().logoVersion ?? "" } : null };
      if (logoUrl && !copyMatches(entry)) return "copie non identique au moment du retrait";
      transaction.update(schoolRef, logoUrl ? { logoUrl: FieldValue.delete() } : { logoUrl: FieldValue.delete(), logoVersion: data.logoVersion ?? "" });
      return "retiré";
    });
    if (outcome === "retiré") result.removed += 1;
    else result.skipped.push({ schoolId, reason: outcome });
  }
  return result;
}

/** Retour arrière : remet sur chaque école le logo et le repère de la sauvegarde. */
export async function restoreSchoolLogos({ db, backup, apply = false, force = false }) {
  if (!backup || !Array.isArray(backup.schools)) throw new Error("Sauvegarde illisible.");
  const result = { mode: apply ? "application" : "simulation", entries: backup.schools.length, toRestore: [], unchanged: 0, changedSince: [], missing: [], restored: 0 };
  for (const entry of backup.schools) {
    if (entry.logoUrl && sha256(entry.logoUrl) !== entry.logoSha256) throw new Error(`Sauvegarde abîmée pour l'école ${entry.schoolId} : retour arrière refusé.`);
    const schoolRef = db.doc(`schools/${entry.schoolId}`);
    const snapshot = await schoolRef.get();
    if (!snapshot.exists) { result.missing.push(entry.schoolId); continue; }
    const data = snapshot.data() ?? {};
    const sameLogo = entry.hadLogoUrlField ? data.logoUrl === entry.logoUrl : !Object.hasOwn(data, "logoUrl");
    const sameVersion = entry.hadLogoVersionField ? data.logoVersion === entry.logoVersion : !Object.hasOwn(data, "logoVersion");
    if (sameLogo && sameVersion) { result.unchanged += 1; continue; }
    // Logo changé depuis la migration par l'école elle-même : on ne l'écrase pas sans --force.
    const currentVersion = typeof data.logoVersion === "string" ? data.logoVersion : "";
    const migrationVersion = schoolLogoVersion(entry.logoUrl);
    if (!force && currentVersion && currentVersion !== migrationVersion && currentVersion !== entry.logoVersion) { result.changedSince.push(entry.schoolId); continue; }
    result.toRestore.push(entry.schoolId);
    if (!apply) continue;
    await schoolRef.update({
      logoUrl: entry.hadLogoUrlField ? entry.logoUrl : FieldValue.delete(),
      logoVersion: entry.hadLogoVersionField ? entry.logoVersion : FieldValue.delete(),
    });
    result.restored += 1;
  }
  return result;
}
