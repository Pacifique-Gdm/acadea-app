import { createHash, randomBytes } from "node:crypto";
import { FeeAllocationError } from "./feeAllocationMath.js";
import { readFeeAllocationScope, readFeeAllocationYear } from "./feeAllocationPhase1.js";

/** Lot 27b — catalogue des rubriques de la répartition des frais (décision du propriétaire, 16/11/2026).
 * - Propre à chaque école ET à chaque année scolaire (une nouvelle année commence avec une liste vide).
 * - « Ajouter une rubrique » l'enregistre ; elle est ensuite réutilisable (même identifiant, donc même solde : pas de doublon).
 * - Renommer : toujours possible. Supprimer : seulement si elle n'a jamais servi ; sinon la masquer (l'historique reste).
 * - La marque `feeAllocationRubricCatalogs/{école__année}` indique que l'école utilise le catalogue ; sans elle,
 *   l'ancien fonctionnement (rubriques de la répartition active) reste inchangé. */
export const UNALLOCATED = "UNALLOCATED";
export const rubricCatalogId = (schoolId, schoolYearId) => `${schoolId}__${schoolYearId}`;
const fail = (status, code, message) => { throw new FeeAllocationError(status, code, message); };
const isAdmin = (role) => role === "school_admin" || role === "admin";
const id = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
export const rubricNameKey = (name) => String(name ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function cleanName(name) {
  const value = typeof name === "string" ? name.normalize("NFKC").trim().replace(/\s+/g, " ") : "";
  if (!value || value.length > 80) fail(400, "invalid-argument", "Le nom de la rubrique doit contenir de 1 à 80 caractères.");
  if (rubricNameKey(value) === rubricNameKey("Non affecté")) fail(400, "invalid-argument", "« Non affecté » est réservé : choisissez un autre nom.");
  return value;
}

export async function readRubricCatalog(db, schoolId, schoolYearId, reader = null) {
  const get = (ref) => (reader ? reader.get(ref) : ref.get());
  const marker = await get(db.doc(`feeAllocationRubricCatalogs/${rubricCatalogId(schoolId, schoolYearId)}`));
  const snapshot = await get(db.collection("feeAllocationRubrics").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId));
  const rubrics = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  return { enabled: marker.exists, rubrics };
}

/** Une rubrique a « servi » dès qu'un brouillon, une version ou un solde la mentionne. */
async function rubricUsage(db, transaction, schoolId, schoolYearId, rubricId) {
  const [configs, versions, balances] = await Promise.all([
    transaction.get(db.collection("feeAllocationConfigs").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId)),
    transaction.get(db.collection("feeAllocationVersions").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId)),
    transaction.get(db.collection("feeAllocationBalances").where("schoolId", "==", schoolId).where("collectionSchoolYearId", "==", schoolYearId)),
  ]);
  return configs.docs.some((doc) => (doc.data().draft?.rubrics ?? []).some((rubric) => rubric.id === rubricId))
    || versions.docs.some((doc) => (doc.data().rubrics ?? []).some((rubric) => rubric.id === rubricId))
    || balances.docs.some((doc) => doc.data().rubricId === rubricId);
}

export async function manageFeeAllocationRubrics({ db, caller, body, now = new Date().toISOString() }) {
  const { school, schoolId } = await readFeeAllocationScope(db, caller, body.schoolId ?? caller.schoolId);
  const { yearId } = await readFeeAllocationYear(db, schoolId, school, undefined, false);
  if (body.action === "list-rubrics") return { operational: false, schoolId, schoolYearId: yearId, ...(await readRubricCatalog(db, schoolId, yearId)) };
  if (!isAdmin(caller.role) || caller.schoolId !== schoolId) fail(403, "permission-denied", "Seul l'Administrateur gère les rubriques.");
  if (!id(body.requestId) || body.requestId.length < 12) fail(400, "invalid-argument", "Clé de requête invalide.");
  const receiptRef = db.doc(`feeAllocationRequests/rubric_${hash([caller.uid, schoolId, body.requestId])}`);
  const fingerprint = hash([body.action, body.rubricId ?? null, body.name ?? null, body.hidden ?? null]);
  return db.runTransaction(async (transaction) => {
    const receipt = await transaction.get(receiptRef);
    if (receipt.exists) {
      if (receipt.data().fingerprint !== fingerprint) fail(409, "conflict", "Cette demande a déjà un autre contenu.");
      return { operational: false, ...receipt.data().result, idempotent: true };
    }
    const catalog = await readRubricCatalog(db, schoolId, yearId, transaction);
    const markerRef = db.doc(`feeAllocationRubricCatalogs/${rubricCatalogId(schoolId, yearId)}`);
    const sameName = (name, exceptId) => catalog.rubrics.some((rubric) => rubric.id !== exceptId && rubricNameKey(rubric.name) === rubricNameKey(name));
    let result;
    if (body.action === "create-rubric") {
      const name = cleanName(body.name);
      if (sameName(name)) fail(409, "conflict", "Une rubrique porte déjà ce nom : choisissez-la dans la liste.");
      const rubricId = randomBytes(16).toString("hex");
      const rubric = { id: rubricId, schoolId, schoolYearId: yearId, name, hidden: false, createdAt: now, updatedAt: now, createdBy: caller.uid };
      transaction.create(db.doc(`feeAllocationRubrics/${rubricId}`), rubric);
      if (!catalog.enabled) transaction.set(markerRef, { schoolId, schoolYearId: yearId, enabledAt: now, enabledBy: caller.uid });
      result = { rubric };
    } else {
      const rubric = catalog.rubrics.find((item) => item.id === body.rubricId);
      if (!rubric) fail(404, "not-found", "Rubrique introuvable pour cette école et cette année.");
      const ref = db.doc(`feeAllocationRubrics/${rubric.id}`);
      if (body.action === "rename-rubric") {
        const name = cleanName(body.name);
        if (sameName(name, rubric.id)) fail(409, "conflict", "Une autre rubrique porte déjà ce nom.");
        transaction.update(ref, { name, updatedAt: now, updatedBy: caller.uid });
        result = { rubric: { ...rubric, name } };
      } else if (body.action === "set-rubric-hidden") {
        if (typeof body.hidden !== "boolean") fail(400, "invalid-argument", "Indiquez si la rubrique est masquée.");
        transaction.update(ref, { hidden: body.hidden, updatedAt: now, updatedBy: caller.uid });
        result = { rubric: { ...rubric, hidden: body.hidden } };
      } else if (body.action === "delete-rubric") {
        if (await rubricUsage(db, transaction, schoolId, yearId, rubric.id)) fail(409, "conflict", "Cette rubrique a déjà servi : elle ne peut pas être supprimée, seulement masquée.");
        transaction.delete(ref);
        result = { deletedId: rubric.id };
      } else fail(400, "invalid-argument", "Action inconnue sur les rubriques.");
    }
    transaction.create(receiptRef, { schoolId, schoolYearId: yearId, fingerprint, result, createdAt: now });
    return { operational: false, ...result, idempotent: false };
  });
}

export const rubricActions = new Set(["list-rubrics", "create-rubric", "rename-rubric", "set-rubric-hidden", "delete-rubric"]);
