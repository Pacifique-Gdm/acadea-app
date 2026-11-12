import { createHash } from "node:crypto";
import { AUDIT_EVENT_TYPES, buildServerAudit } from "./serverAudit.js";
import { toMoneyMinor } from "./money.js";
import { CLASSES } from "../../src/utils/studentYearTransition.js";

export class FeeTypeError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const fail = (status, code, message) => { throw new FeeTypeError(status, code, message); };
const hash = (value) => createHash("sha256").update(value).digest("hex");
const keyPart = (value) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");
const businessKey = (fee) => JSON.stringify([keyPart(fee.schoolId), keyPart(fee.schoolYearId), keyPart(fee.name), keyPart(fee.classOptionKey || fee.className)]);
const validId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(value);
const classes = new Set(CLASSES);

function assertProfile(profile, caller) {
  if (!profile.exists || profile.data()?.schoolId !== caller.schoolId || !["admin", "school_admin"].includes(profile.data()?.role) || profile.data()?.status === "inactive" || profile.data()?.active === false) fail(403, "permission-denied", "Compte administrateur inactif ou invalide.");
}
function assertActiveYear(school, year, caller, schoolYearId) {
  if (!school.exists || ["deleting", "inactive", "suspended"].includes(school.data()?.status)) fail(403, "permission-denied", "Établissement inactif ou indisponible.");
  if (school.data()?.activeSchoolYearId !== schoolYearId || !year.exists || year.data()?.schoolId !== caller.schoolId || year.data()?.status !== "active") fail(409, "failed-precondition", "L'année sélectionnée n'est plus l'année active de cet établissement. Actualisez le contexte avant de saisir ce frais.");
}

// Narrow server mutation: this must not grant client write access to a coordinated
// school's year, currency, status or dates. A lost response reuses the same receipt.
export async function addFeeKind({ db, caller, body }) {
  if (!caller?.uid || !caller?.schoolId || !["admin", "school_admin"].includes(caller.role)) fail(403, "permission-denied", "Gestion des frais non autorisée.");
  if (!body || Object.keys(body).some(key => !["action", "schoolYearId", "requestId", "name"].includes(key)) || (body.action && body.action !== "add-fee-kind")) fail(400, "invalid-argument", "Requête de libellé de frais invalide.");
  const { schoolYearId, requestId } = body;
  if (!validId(schoolYearId) || !validId(requestId) || requestId.length < 12 || typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 120) fail(400, "invalid-argument", "Le nom du frais est obligatoire et limité à 120 caractères.");
  const name = body.name.trim();
  const fingerprint = hash(JSON.stringify([schoolYearId, keyPart(name)]));
  const receiptRef = db.doc(`feeKindRequests/${hash(`${caller.uid}:${caller.schoolId}:${requestId}`)}`);
  const yearRef = db.doc(`schoolYears/${schoolYearId}`);
  return db.runTransaction(async transaction => {
    const [profile, school, year, receipt] = await Promise.all([
      transaction.get(db.doc(`users/${caller.uid}`)), transaction.get(db.doc(`schools/${caller.schoolId}`)), transaction.get(yearRef), transaction.get(receiptRef),
    ]);
    assertProfile(profile, caller);
    assertActiveYear(school, year, caller, schoolYearId);
    if (receipt.exists && receipt.data()?.fingerprint !== fingerprint) fail(409, "conflict", "Cette demande a déjà servi pour un autre libellé de frais.");
    const choices = year.data()?.customFeeKindChoices ?? [];
    if (!Array.isArray(choices) || choices.some(item => typeof item !== "string")) fail(409, "failed-precondition", "La liste des libellés de frais est invalide. Contactez l'assistance.");
    const existing = choices.find(item => keyPart(item) === keyPart(name));
    if (receipt.exists) return { name: receipt.data().name, customFeeKindChoices: choices, idempotent: true };
    const nextChoices = existing ? choices : [...choices, name];
    const auditId = `fee-kind-${hash(`${caller.uid}:${caller.schoolId}:${requestId}`).slice(0, 32)}`;
    if (!existing) {
      transaction.update(yearRef, { customFeeKindChoices: nextChoices });
      transaction.create(db.doc(`auditLogs/${auditId}`), buildServerAudit({ id: auditId, eventType: AUDIT_EVENT_TYPES.FINANCE_FEE_TYPE_SAVED,
        actor: caller, schoolId: caller.schoolId, schoolYearId, resourceType: "feeKind", resourceId: auditId, metadata: { kindOnly: true } }));
    }
    transaction.create(receiptRef, { schoolId: caller.schoolId, schoolYearId, userId: caller.uid, fingerprint, name: existing || name, createdAt: new Date() });
    return { name: existing || name, customFeeKindChoices: nextChoices, idempotent: Boolean(existing) };
  });
}

export async function saveFeeTypes({ db, caller, body }) {
  if (!caller?.uid || !caller?.schoolId || !["admin", "school_admin"].includes(caller.role)) fail(403, "permission-denied", "Gestion des frais non autorisée.");
  if (!body || Object.keys(body).some((key) => !["action", "schoolYearId", "requestId", "editingFeeId", "fees"].includes(key)) || (body.action && body.action !== "save-fee-types")) fail(400, "invalid-argument", "Requête de frais invalide.");
  const { schoolYearId, requestId, editingFeeId = "", fees } = body;
  if (!validId(requestId) || requestId.length < 12 || !validId(schoolYearId) || (editingFeeId && !validId(editingFeeId)) || !Array.isArray(fees) || fees.length < 1 || fees.length > 100) fail(400, "invalid-argument", "Identifiants invalides ou sélection dépassant 100 classes.");
  const normalized = fees.map((raw) => {
    if (!raw || Object.keys(raw).some((key) => !["id", "name", "amount", "className", "classOptionKey"].includes(key))) fail(400, "invalid-argument", "Champs de frais non autorisés.");
    if (!validId(raw.id) || typeof raw.name !== "string" || !raw.name.trim() || raw.name.trim().length > 120) fail(400, "invalid-argument", "Identifiant ou nom du type de frais invalide (120 caractères maximum).");
    if (typeof raw.className !== "string" || !raw.className.trim() || raw.className.length > 120) fail(400, "invalid-argument", "Classe du type de frais invalide.");
    if (raw.classOptionKey !== undefined && (typeof raw.classOptionKey !== "string" || !raw.classOptionKey.startsWith(`${raw.className}::option::`) || raw.classOptionKey.length > 180)) fail(400, "invalid-argument", "Option de classe invalide.");
    let amountMinor;
    try { amountMinor = toMoneyMinor(raw.amount); } catch { fail(400, "invalid-argument", "Montant de frais invalide."); }
    if (amountMinor <= 0 || amountMinor > 100_000_000_000) fail(400, "invalid-argument", "Montant de frais invalide.");
    return { id: raw.id, schoolId: caller.schoolId, schoolYearId, name: raw.name.trim(), className: raw.className, ...(raw.classOptionKey ? { classOptionKey: raw.classOptionKey } : {}), amount: amountMinor / 100 };
  });
  if (new Set(normalized.map((fee) => fee.id)).size !== normalized.length || new Set(normalized.map(businessKey)).size !== normalized.length || (editingFeeId && normalized[0].id !== editingFeeId)) fail(400, "invalid-argument", "Doublon dans les frais demandés.");
  const fingerprint = hash(JSON.stringify({ schoolYearId, editingFeeId, fees: normalized }));
  const receiptRef = db.doc(`feeTypeRequests/${hash(`${caller.uid}:${caller.schoolId}:${requestId}`)}`);
  const schoolRef = db.doc(`schools/${caller.schoolId}`);
  const yearRef = db.doc(`schoolYears/${schoolYearId}`);
  const userRef = db.doc(`users/${caller.uid}`);
  const feeRefs = normalized.map((fee) => db.doc(`feeTypes/${fee.id}`));
  const existingQuery = db.collection("feeTypes").where("schoolId", "==", caller.schoolId).where("schoolYearId", "==", schoolYearId);
  return db.runTransaction(async (transaction) => {
    const [receipt, school, year, profile, existing, ...current] = await Promise.all([
      transaction.get(receiptRef), transaction.get(schoolRef), transaction.get(yearRef), transaction.get(userRef), transaction.get(existingQuery),
      ...feeRefs.map((ref) => transaction.get(ref)),
    ]);
    assertProfile(profile, caller);
    if (receipt.exists) {
      if (receipt.data()?.fingerprint !== fingerprint) fail(409, "conflict", "Cette demande a déjà servi pour d'autres frais.");
      return { fees: receipt.data().fees, audit: receipt.data().audit, idempotent: true };
    }
    assertActiveYear(school, year, caller, schoolYearId);
    if (editingFeeId && (!current[0].exists || current[0].data()?.schoolId !== caller.schoolId || current[0].data()?.schoolYearId !== schoolYearId)) fail(409, "conflict", "Le type de frais à modifier a changé ou n'existe plus.");
    if (editingFeeId) {
      // Admin SDK bypasses rules: preserve the same social-decision lock here.
      // Reading the lock in this transaction also serializes concurrent decisions.
      const [supportLock, allocationGuard] = await Promise.all([
        transaction.get(db.doc(`socialSupportFeeLocks/${editingFeeId}`)),
        transaction.get(db.doc(`feeAllocationFeeGuards/${editingFeeId}`)),
      ]);
      if (allocationGuard.exists) fail(409, "failed-precondition", "Ce frais possède une répartition publiée. Préparez une nouvelle version avant de modifier le tarif.");
      const previous = current[0].data();
      if (supportLock.exists && ["amount", "className", "classOptionKey"].some(key => (previous[key] ?? "") !== (normalized[0][key] ?? ""))) {
        fail(409, "failed-precondition", "Ce frais est lié à une décision sociale. Son montant et sa classe ne peuvent plus être modifiés.");
      }
    }
    // Historical labels offered by the real form are preserved, not renamed.
    // Accept them only when backed by students in this exact tenant/year, or by
    // the already-authorized fee being edited. Arbitrary/foreign labels fail.
    const historical = normalized.filter(fee => !classes.has(fee.className));
    if (historical.length) {
      const students = await transaction.get(db.collection("students").where("schoolId", "==", caller.schoolId).where("schoolYearId", "==", schoolYearId));
      const known = new Set(students.docs.map(doc => doc.data().className));
      if (historical.some(fee => !known.has(fee.className) && !(fee.id === editingFeeId && current[0].data()?.className === fee.className))) fail(400, "invalid-argument", "La classe historique sélectionnée n'appartient pas aux élèves de cette école et de cette année. Actualisez la liste des classes.");
    }
    if (normalized.some((fee, index) => fee.id !== editingFeeId && current[index].exists)) fail(409, "conflict", "Un identifiant de frais existe déjà. Aucun document n'a été remplacé.");
    const priorKeys = new Set(existing.docs.filter((doc) => doc.id !== editingFeeId).map((doc) => businessKey(doc.data())));
    if (normalized.some((fee) => priorKeys.has(businessKey(fee)))) fail(409, "conflict", "Ce type de frais existe déjà pour cette classe. Actualisez les données.");
    // Deterministic uniqueness documents make simultaneous requests for the same
    // business key contend even when their fee IDs and query snapshots differ.
    const keyRefs = normalized.map((fee) => db.doc(`feeTypeKeys/${hash(businessKey(fee))}`));
    const oldKeyRef = editingFeeId ? db.doc(`feeTypeKeys/${hash(businessKey({ id: editingFeeId, ...current[0].data() }))}`) : null;
    const [keys, oldKey] = await Promise.all([Promise.all(keyRefs.map((ref) => transaction.get(ref))), oldKeyRef ? transaction.get(oldKeyRef) : Promise.resolve(null)]);
    const conflictingKeys = keys.filter((item, index) => item.exists && item.data()?.feeId !== normalized[index].id);
    const linked = await Promise.all(conflictingKeys.map((item) => transaction.get(db.doc(`feeTypes/${item.data().feeId}`))));
    if (linked.some((item) => item.exists)) fail(409, "conflict", "Ce type de frais est déjà en cours d'enregistrement. Actualisez les données.");
    for (let index = 0; index < normalized.length; index += 1) {
      if (normalized[index].id === editingFeeId) transaction.update(feeRefs[index], normalized[index]);
      else transaction.create(feeRefs[index], normalized[index]);
      if (!keys[index].exists) transaction.create(keyRefs[index], { feeId: normalized[index].id, schoolId: caller.schoolId, schoolYearId });
      else if (keys[index].data()?.feeId !== normalized[index].id) transaction.set(keyRefs[index], { feeId: normalized[index].id, schoolId: caller.schoolId, schoolYearId });
    }
    if (oldKey && oldKey.exists && oldKey.data()?.feeId === editingFeeId && oldKeyRef.path !== keyRefs[0].path) transaction.delete(oldKeyRef);
    const auditId = `fee-${hash(`${caller.uid}:${caller.schoolId}:${requestId}`).slice(0, 32)}`;
    const audit = buildServerAudit({ id: auditId, eventType: AUDIT_EVENT_TYPES.FINANCE_FEE_TYPE_SAVED, actor: caller, schoolId: caller.schoolId, schoolYearId, resourceType: "feeType", resourceId: normalized[0].id, metadata: { count: normalized.length, editing: Boolean(editingFeeId) } });
    transaction.create(db.doc(`auditLogs/${auditId}`), audit);
    const responseAudit = { ...audit, createdAt: new Date().toISOString() };
    transaction.create(receiptRef, { schoolId: caller.schoolId, schoolYearId, userId: caller.uid, fingerprint, fees: normalized, audit: responseAudit, createdAt: new Date() });
    return { fees: normalized, audit: responseAudit, idempotent: false };
  });
}
