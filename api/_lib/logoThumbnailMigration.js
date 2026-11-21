import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { COORDINATION_LOGO_COLLECTION, coordinationLogoVersion } from "./coordinationLogo.js";
import { isValidLogoThumbnail } from "./logoThumbnail.js";
import { SCHOOL_LOGO_COLLECTION } from "./schoolLogo.js";

// Migration du lot 1 du Super administrateur (voir scripts/logoThumbnailMigration.mjs) :
//   - écoles : création de la vignette `logoThumbUrl` (environ 4 Ko) à partir du logo complet ;
//   - coordinations : logo complet déplacé dans coordinationLogos/{id}, la coordination
//     garde `logoVersion` et `logoThumbUrl`.
// Tout est en simulation sans `apply`. Le retour arrière remet chaque champ comme
// dans la sauvegarde (présence comprise) et retire les copies créées.

export const MIGRATION_ACTOR = "migration-vignettes-logos";
const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const text = (value) => (typeof value === "string" ? value : "");

function field(data, key) {
  return { present: Object.hasOwn(data, key), value: data[key] ?? null };
}

/** Photographie complète des logos (écoles et coordinations) pour la sauvegarde. */
export async function readLogoInventory(db) {
  const [schools, schoolLogos, coordinations, coordinationLogos] = await Promise.all([
    db.collection("schools").get(),
    db.collection(SCHOOL_LOGO_COLLECTION).get(),
    db.collection("coordinations").get(),
    db.collection(COORDINATION_LOGO_COLLECTION).get(),
  ]);
  const schoolLogoDocs = new Map(schoolLogos.docs.map((document) => [document.id, document.data() ?? {}]));
  const coordinationLogoDocs = new Map(coordinationLogos.docs.map((document) => [document.id, document.data() ?? {}]));
  return {
    schools: schools.docs.map((document) => {
      const data = document.data() ?? {};
      const stored = schoolLogoDocs.get(document.id);
      // Logo complet : rangé à part (même repère que l'école) ou encore dans l'ancien champ.
      const logoUrl = text(data.logoUrl) || (stored && text(stored.logoVersion) === text(data.logoVersion) ? text(stored.logoUrl) : "");
      return {
        id: document.id,
        name: text(data.name),
        logoVersion: field(data, "logoVersion"),
        logoThumbUrl: field(data, "logoThumbUrl"),
        logoSha256: logoUrl ? sha256(logoUrl) : "",
        logoBytes: Buffer.byteLength(logoUrl),
        logoUrl,
      };
    }),
    coordinations: coordinations.docs.map((document) => {
      const data = document.data() ?? {};
      const stored = coordinationLogoDocs.get(document.id);
      return {
        id: document.id,
        name: text(data.name),
        logoUrl: field(data, "logoUrl"),
        logoVersion: field(data, "logoVersion"),
        logoThumbUrl: field(data, "logoThumbUrl"),
        logoSha256: text(data.logoUrl) ? sha256(text(data.logoUrl)) : "",
        logoBytes: Buffer.byteLength(text(data.logoUrl)),
        storedLogo: stored ?? null,
      };
    }),
  };
}

export function planLogoMigration(inventory) {
  const schools = inventory.schools.filter((entry) => entry.logoUrl && !isValidLogoThumbnail(entry.logoThumbUrl.value));
  const coordinations = inventory.coordinations.filter((entry) => text(entry.logoUrl.value));
  return {
    schoolThumbnails: schools.map((entry) => entry.id),
    schoolsAlreadyDone: inventory.schools.filter((entry) => entry.logoUrl && isValidLogoThumbnail(entry.logoThumbUrl.value)).length,
    schoolsWithoutLogo: inventory.schools.filter((entry) => !entry.logoUrl).length,
    coordinationMoves: coordinations.map((entry) => entry.id),
    coordinationsWithoutLegacyLogo: inventory.coordinations.length - coordinations.length,
    logoBytes: schools.reduce((sum, entry) => sum + entry.logoBytes, 0) + coordinations.reduce((sum, entry) => sum + entry.logoBytes, 0),
  };
}

/**
 * Applique la migration. `makeThumbnail(logoUrl)` fabrique la vignette (navigateur
 * sans fenêtre dans le script) ; une vignette invalide n'est jamais écrite.
 */
export async function migrateLogos({ db, makeThumbnail, apply = false, now = () => new Date().toISOString() }) {
  const inventory = await readLogoInventory(db);
  const plan = planLogoMigration(inventory);
  const result = { mode: apply ? "application" : "simulation", schools: inventory.schools.length, coordinations: inventory.coordinations.length, ...plan, schoolThumbnails: plan.schoolThumbnails.length, coordinationMoves: plan.coordinationMoves.length, thumbnailsWritten: 0, coordinationsMoved: 0, thumbnailBytes: 0, skipped: [] };
  if (!apply) return result;
  const bySchool = new Map(inventory.schools.map((entry) => [entry.id, entry]));
  for (const schoolId of plan.schoolThumbnails) {
    const entry = bySchool.get(schoolId);
    const thumbnail = await makeThumbnail(entry.logoUrl);
    if (!isValidLogoThumbnail(thumbnail)) { result.skipped.push({ id: schoolId, kind: "école", reason: "vignette impossible" }); continue; }
    const schoolRef = db.doc(`schools/${schoolId}`);
    const outcome = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(schoolRef);
      const data = snapshot.data() ?? {};
      // Logo changé entre-temps par l'école : on ne pose pas une vignette d'un ancien logo.
      if (!snapshot.exists || text(data.logoVersion) !== text(entry.logoVersion.value) || (text(data.logoUrl) && sha256(text(data.logoUrl)) !== entry.logoSha256)) return "logo changé depuis la lecture";
      transaction.update(schoolRef, { logoThumbUrl: thumbnail });
      return "écrit";
    });
    if (outcome === "écrit") { result.thumbnailsWritten += 1; result.thumbnailBytes += thumbnail.length; }
    else result.skipped.push({ id: schoolId, kind: "école", reason: outcome });
  }
  const byCoordination = new Map(inventory.coordinations.map((entry) => [entry.id, entry]));
  for (const coordinationId of plan.coordinationMoves) {
    const entry = byCoordination.get(coordinationId);
    const legacy = text(entry.logoUrl.value);
    const thumbnail = await makeThumbnail(legacy);
    const coordinationRef = db.doc(`coordinations/${coordinationId}`);
    const logoRef = db.doc(`${COORDINATION_LOGO_COLLECTION}/${coordinationId}`);
    const outcome = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(coordinationRef);
      const logoUrl = text(snapshot.data()?.logoUrl);
      if (!snapshot.exists || !logoUrl || sha256(logoUrl) !== entry.logoSha256) return "logo changé depuis la lecture";
      const logoVersion = coordinationLogoVersion(logoUrl);
      transaction.set(logoRef, { coordinationId, logoUrl, logoVersion, updatedAt: now(), updatedBy: MIGRATION_ACTOR });
      transaction.update(coordinationRef, { logoUrl: FieldValue.delete(), logoVersion, logoThumbUrl: isValidLogoThumbnail(thumbnail) ? thumbnail : FieldValue.delete() });
      return "déplacé";
    });
    if (outcome === "déplacé") { result.coordinationsMoved += 1; if (isValidLogoThumbnail(thumbnail)) result.thumbnailBytes += thumbnail.length; else result.skipped.push({ id: coordinationId, kind: "coordination", reason: "logo déplacé, vignette impossible" }); }
    else result.skipped.push({ id: coordinationId, kind: "coordination", reason: outcome });
  }
  result.verification = await verifyLogoMigration({ db, backup: inventory });
  return result;
}

/** Vérifie, après migration, chaque logo de la sauvegarde. */
export async function verifyLogoMigration({ db, backup }) {
  const current = await readLogoInventory(db);
  const schools = new Map(current.schools.map((entry) => [entry.id, entry]));
  const coordinations = new Map(current.coordinations.map((entry) => [entry.id, entry]));
  const problems = [];
  for (const saved of backup.schools) {
    if (!saved.logoUrl) continue;
    const now = schools.get(saved.id);
    if (!now || now.logoSha256 !== saved.logoSha256) problems.push({ id: saved.id, kind: "école", reason: "logo complet différent de la sauvegarde" });
    else if (!isValidLogoThumbnail(now.logoThumbUrl.value)) problems.push({ id: saved.id, kind: "école", reason: "vignette absente" });
  }
  for (const saved of backup.coordinations) {
    if (!saved.logoSha256) continue;
    const now = coordinations.get(saved.id);
    const stored = now?.storedLogo;
    if (!now || !stored || sha256(text(stored.logoUrl)) !== saved.logoSha256) problems.push({ id: saved.id, kind: "coordination", reason: "logo rangé à part différent de la sauvegarde" });
    else if (text(now.logoUrl.value)) problems.push({ id: saved.id, kind: "coordination", reason: "ancien champ logoUrl encore présent" });
    else if (text(now.logoVersion.value) !== text(stored.logoVersion)) problems.push({ id: saved.id, kind: "coordination", reason: "repère logoVersion différent" });
  }
  return { ok: problems.length === 0, problems };
}

function restoreField(saved) {
  return saved.present ? saved.value : FieldValue.delete();
}

/** Retour arrière : remet chaque école et chaque coordination comme dans la sauvegarde. */
export async function restoreLogos({ db, backup, apply = false, force = false }) {
  if (!backup || !Array.isArray(backup.schools) || !Array.isArray(backup.coordinations)) throw new Error("Sauvegarde illisible.");
  for (const entry of backup.schools) if (entry.logoUrl && sha256(entry.logoUrl) !== entry.logoSha256) throw new Error(`Sauvegarde abîmée pour l'école ${entry.id} : retour arrière refusé.`);
  for (const entry of backup.coordinations) if (text(entry.logoUrl.value) && sha256(text(entry.logoUrl.value)) !== entry.logoSha256) throw new Error(`Sauvegarde abîmée pour la coordination ${entry.id} : retour arrière refusé.`);
  const result = { mode: apply ? "application" : "simulation", schoolsRestored: 0, coordinationsRestored: 0, unchanged: 0, changedSince: [], missing: [] };
  for (const entry of backup.schools) {
    const ref = db.doc(`schools/${entry.id}`);
    const snapshot = await ref.get();
    if (!snapshot.exists) { result.missing.push(entry.id); continue; }
    const data = snapshot.data() ?? {};
    const same = Object.hasOwn(data, "logoThumbUrl") === entry.logoThumbUrl.present && (data.logoThumbUrl ?? null) === entry.logoThumbUrl.value;
    if (same) { result.unchanged += 1; continue; }
    // Nouveau logo posé par l'école depuis la migration : on ne touche pas sa vignette sans --force.
    if (!force && text(data.logoVersion) !== text(entry.logoVersion.value)) { result.changedSince.push(entry.id); continue; }
    if (apply) await ref.update({ logoThumbUrl: restoreField(entry.logoThumbUrl) });
    result.schoolsRestored += 1;
  }
  for (const entry of backup.coordinations) {
    const ref = db.doc(`coordinations/${entry.id}`);
    const logoRef = db.doc(`${COORDINATION_LOGO_COLLECTION}/${entry.id}`);
    const snapshot = await ref.get();
    if (!snapshot.exists) { result.missing.push(entry.id); continue; }
    const data = snapshot.data() ?? {};
    const same = ["logoUrl", "logoVersion", "logoThumbUrl"].every((key) => Object.hasOwn(data, key) === entry[key].present && (data[key] ?? null) === entry[key].value)
      && Boolean((await logoRef.get()).exists) === Boolean(entry.storedLogo);
    if (same) { result.unchanged += 1; continue; }
    const migratedVersion = entry.logoSha256 ? coordinationLogoVersion(text(entry.logoUrl.value)) : "";
    if (!force && text(data.logoVersion) && text(data.logoVersion) !== migratedVersion && text(data.logoVersion) !== text(entry.logoVersion.value)) { result.changedSince.push(entry.id); continue; }
    if (apply) {
      await db.runTransaction(async (transaction) => {
        if (entry.storedLogo) transaction.set(logoRef, entry.storedLogo);
        else transaction.delete(logoRef);
        transaction.update(ref, { logoUrl: restoreField(entry.logoUrl), logoVersion: restoreField(entry.logoVersion), logoThumbUrl: restoreField(entry.logoThumbUrl) });
      });
    }
    result.coordinationsRestored += 1;
  }
  return result;
}
