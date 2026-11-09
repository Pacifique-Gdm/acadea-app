import { createHash } from "node:crypto";
import { toMoneyMinor } from "./money.js";
import { AUDIT_EVENT_TYPES, buildServerAudit } from "./serverAudit.js";
import { FeeAllocationError, assertFeeAllocationActivationBlocked, validateFeeAllocationRubrics } from "./feeAllocationMath.js";

const identifier = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const sha = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const denied = () => { throw new FeeAllocationError(403, "permission-denied", "Accès à la répartition interdit."); };
const invalid = (message) => { throw new FeeAllocationError(400, "invalid-argument", message); };
const conflict = (message) => { throw new FeeAllocationError(409, "conflict", message); };
const role = (value) => value === "admin" ? "school_admin" : value;
const active = (value) => value && value.active !== false && value.status !== "inactive";
const allowedActions = new Set(["get-state", "list-configurations", "list-versions", "get-permissions", "save-draft", "validate-draft", "prepare-version", "check-activation", "publish-configuration", "activate"]);

export function feeAllocationConfigId(schoolId, schoolYearId, feeTypeId) {
  return `allocation_${sha([schoolId, schoolYearId, feeTypeId]).slice(0, 40)}`;
}

/** Rechecks stored profiles and school relations, never a client-supplied scope alone. */
async function readScope(db, caller, requestedSchoolId) {
  if (!caller?.uid || !identifier(requestedSchoolId)) denied();
  const profileSnapshot = await db.doc(`users/${caller.uid}`).get();
  const profile = profileSnapshot.data();
  if (!profileSnapshot.exists || !active(profile) || role(profile.role) !== role(caller.role)) denied();
  const schoolSnapshot = await db.doc(`schools/${requestedSchoolId}`).get();
  const school = schoolSnapshot.data();
  if (!schoolSnapshot.exists || !active(school) || school.status === "suspended" || school.status === "deleting") denied();
  if (["school_admin", "cashier"].includes(role(caller.role))) {
    if (profile.schoolId !== requestedSchoolId || caller.schoolId !== requestedSchoolId) denied();
  } else if (["coordination_admin", "sub_coordination_admin"].includes(caller.role)) {
    const coordinationId = caller.coordinationId;
    if (!identifier(coordinationId) || profile.coordinationId !== coordinationId || school.activeCoordinationId !== coordinationId) denied();
    const [coordinationSnapshot, relationSnapshot] = await Promise.all([
      db.doc(`coordinations/${coordinationId}`).get(),
      db.doc(`coordinationSchools/${coordinationId}__${requestedSchoolId}`).get(),
    ]);
    if (coordinationSnapshot.data()?.status !== "active" || !relationSnapshot.exists || relationSnapshot.data()?.active !== true || relationSnapshot.data()?.schoolId !== requestedSchoolId) denied();
    if (caller.role === "sub_coordination_admin") {
      const subId = caller.subCoordinationId;
      if (!identifier(subId) || profile.subCoordinationId !== subId) denied();
      const [subSnapshot, subRelationSnapshot] = await Promise.all([
        db.doc(`subCoordinations/${subId}`).get(), db.doc(`subCoordinationSchools/${subId}__${requestedSchoolId}`).get(),
      ]);
      const sub = subSnapshot.data();
      const relation = subRelationSnapshot.data();
      if (!subSnapshot.exists || !active(sub) || sub.coordinationId !== coordinationId || sub.coordinatorUserId !== caller.uid
        || !subRelationSnapshot.exists || relation.active !== true || relation.schoolId !== requestedSchoolId || relation.coordinationId !== coordinationId) denied();
    }
  } else denied();
  return { school, schoolId: requestedSchoolId, profile };
}

async function readYear(db, schoolId, school, requestedYearId, mutation) {
  const yearId = requestedYearId ?? school.activeSchoolYearId;
  if (!identifier(yearId)) invalid("Année scolaire invalide.");
  const snapshot = await db.doc(`schoolYears/${yearId}`).get();
  const year = snapshot.data();
  if (!snapshot.exists || year.schoolId !== schoolId) denied();
  if (mutation && (yearId !== school.activeSchoolYearId || year.status !== "active")) conflict("Seule l'année scolaire active peut être préparée.");
  return { yearId, year, currency: year.currency === "CDF" || year.currency === "USD" ? year.currency : school.currency === "CDF" ? "CDF" : "USD" };
}

function assertDraftRequest(body) {
  const permitted = body.action === "save-draft" ? ["action", "feeTypeId", "requestId", "expectedRevision", "rubrics"] : ["action", "feeTypeId", "requestId", "expectedRevision"];
  if (Object.keys(body).some((key) => !permitted.includes(key))) invalid("Champs de répartition non autorisés.");
  if (!identifier(body.feeTypeId) || !identifier(body.requestId) || body.requestId.length < 12 || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) invalid("Demande de brouillon invalide.");
}

async function mutateDraft({ db, caller, body, prepare }) {
  if (role(caller.role) !== "school_admin") denied();
  assertDraftRequest(body);
  const schoolId = caller.schoolId;
  const schoolRef = db.doc(`schools/${schoolId}`);
  const userRef = db.doc(`users/${caller.uid}`);
  const receiptRef = db.doc(`feeAllocationRequests/${sha([caller.uid, schoolId, body.requestId])}`);
  return db.runTransaction(async (transaction) => {
    const [schoolSnapshot, profileSnapshot, receiptSnapshot] = await Promise.all([
      transaction.get(schoolRef), transaction.get(userRef), transaction.get(receiptRef),
    ]);
    const school = schoolSnapshot.data();
    const profile = profileSnapshot.data();
    if (!schoolSnapshot.exists || !active(school) || school.status === "suspended" || school.status === "deleting"
      || !profileSnapshot.exists || !active(profile) || role(profile.role) !== "school_admin" || profile.schoolId !== schoolId) denied();
    const yearId = school.activeSchoolYearId;
    if (!identifier(yearId)) conflict("Aucune année scolaire active.");
    const yearRef = db.doc(`schoolYears/${yearId}`);
    const feeRef = db.doc(`feeTypes/${body.feeTypeId}`);
    const configId = feeAllocationConfigId(schoolId, yearId, body.feeTypeId);
    const configRef = db.doc(`feeAllocationConfigs/${configId}`);
    const [yearSnapshot, feeSnapshot, configSnapshot] = await Promise.all([
      transaction.get(yearRef), transaction.get(feeRef), transaction.get(configRef),
    ]);
    const year = yearSnapshot.data();
    const fee = feeSnapshot.data();
    if (!yearSnapshot.exists || year.schoolId !== schoolId || year.status !== "active") conflict("L'année active a changé.");
    if (!feeSnapshot.exists || fee.schoolId !== schoolId || fee.schoolYearId !== yearId || !fee.className) denied();
    const currency = year.currency === "CDF" || year.currency === "USD" ? year.currency : school.currency === "CDF" ? "CDF" : "USD";
    let feeAmountMinor;
    try { feeAmountMinor = toMoneyMinor(fee.amount); }
    catch { invalid("Tarif de référence invalide."); }
    const config = configSnapshot.data();
    const fingerprint = sha([prepare ? "prepare-version" : "save-draft", configId, body.expectedRevision, body.rubrics ?? null]);
    if (receiptSnapshot.exists) {
      if (receiptSnapshot.data()?.fingerprint !== fingerprint) conflict("Clé de requête déjà utilisée avec un autre contenu.");
      return { ...receiptSnapshot.data().result, idempotent: true };
    }
    if ((config?.draftRevision ?? 0) !== body.expectedRevision) conflict("Le brouillon a changé. Actualisez avant de réessayer.");
    if (config && (config.schoolId !== schoolId || config.schoolYearId !== yearId || config.feeTypeId !== body.feeTypeId)) denied();
    const stateRef = db.doc(`feeAllocationStates/${sha([schoolId, yearId, currency])}`);
    const stateSnapshot = await transaction.get(stateRef);
    if (stateSnapshot.exists && stateSnapshot.data()?.status === "ACTIVE") assertFeeAllocationActivationBlocked();
    let result;
    let auditType;
    const now = new Date().toISOString();
    if (prepare) {
      if (!config?.draft || config.draft.feeAmountMinor !== feeAmountMinor) conflict("Le tarif a changé depuis le brouillon.");
      const validated = validateFeeAllocationRubrics(config.draft.rubrics, feeAmountMinor);
      const versionId = `allocation_version_${sha([configId, body.expectedRevision]).slice(0, 40)}`;
      const versionRef = db.doc(`feeAllocationVersions/${versionId}`);
      const priorVersion = await transaction.get(versionRef);
      if (priorVersion.exists) conflict("Cette version a déjà été préparée.");
      const version = { id: versionId, configId, schoolId, schoolYearId: yearId, feeTypeId: body.feeTypeId,
        className: fee.className, ...(fee.classOptionKey ? { classOptionKey: fee.classOptionKey } : {}), currency,
        feeAmountMinor, version: body.expectedRevision, status: "prepared", effectiveFrom: null,
        rubrics: validated.rubrics, shares: validated.shares, createdAt: now, createdBy: caller.uid };
      transaction.create(versionRef, version);
      result = { version, operational: false };
      auditType = AUDIT_EVENT_TYPES.FINANCE_ALLOCATION_VERSION_PREPARED;
    } else {
      const validated = validateFeeAllocationRubrics(body.rubrics, feeAmountMinor);
      const nextRevision = body.expectedRevision + 1;
      const nextConfig = { id: configId, schoolId, schoolYearId: yearId, feeTypeId: body.feeTypeId,
        className: fee.className, ...(fee.classOptionKey ? { classOptionKey: fee.classOptionKey } : {}), currency,
        draftRevision: nextRevision, draft: { rubrics: validated.rubrics, feeAmountMinor, updatedAt: now, updatedBy: caller.uid },
        ...(config?.currentVersionId ? { currentVersionId: config.currentVersionId } : {}) };
      if (configSnapshot.exists) transaction.update(configRef, nextConfig);
      else transaction.create(configRef, nextConfig);
      if (!stateSnapshot.exists) transaction.create(stateRef, { schoolId, schoolYearId: yearId, currency, status: "EN_PREPARATION", createdAt: now, updatedAt: now });
      result = { config: nextConfig, shares: validated.shares, operational: false };
      auditType = AUDIT_EVENT_TYPES.FINANCE_ALLOCATION_DRAFT_SAVED;
    }
    const auditId = `audit_allocation_${sha([caller.uid, schoolId, body.requestId]).slice(0, 32)}`;
    transaction.create(db.doc(`auditLogs/${auditId}`), buildServerAudit({ id: auditId, eventType: auditType,
      actor: caller, schoolId, schoolYearId: yearId, resourceType: "feeAllocation", resourceId: configId,
      metadata: { feeTypeId: body.feeTypeId, revision: body.expectedRevision, operational: false } }));
    transaction.create(receiptRef, { schoolId, schoolYearId: yearId, userId: caller.uid, fingerprint, result, createdAt: now });
    return { ...result, idempotent: false };
  });
}

export async function manageFeeAllocationPhase1({ db, caller, body }) {
  if (!body || typeof body !== "object" || Array.isArray(body) || !allowedActions.has(body.action)) invalid("Action de répartition invalide.");
  if (body.action === "publish-configuration" || body.action === "activate") assertFeeAllocationActivationBlocked();
  const requestedSchoolId = body.schoolId ?? caller.schoolId;
  const { school, schoolId } = await readScope(db, caller, requestedSchoolId);
  if (body.action === "save-draft" || body.action === "prepare-version") {
    if (body.schoolId !== undefined) invalid("L'établissement est déterminé par la session.");
    return mutateDraft({ db, caller, body, prepare: body.action === "prepare-version" });
  }
  const { yearId, currency } = await readYear(db, schoolId, school, body.schoolYearId, false);
  const stateSnapshot = await db.doc(`feeAllocationStates/${sha([schoolId, yearId, currency])}`).get();
  const state = stateSnapshot.exists ? stateSnapshot.data() : { schoolId, schoolYearId: yearId, currency, status: "NON_CONFIGURE" };
  if (body.action === "get-state") return { state, operational: false };
  if (body.action === "get-permissions") return { schoolId, schoolYearId: yearId,
    canConfigure: role(caller.role) === "school_admin", canRead: true, canActivate: false, operational: false };
  if (body.action === "check-activation") return { state, ready: false, blockers: ["phases-2-3-4-5-not-validated", "opening-not-approved"], operational: false };
  if (body.action === "list-configurations") {
    const snapshot = await db.collection("feeAllocationConfigs").where("schoolId", "==", schoolId).where("schoolYearId", "==", yearId).get();
    return { configs: snapshot.docs.map((item) => item.data()), operational: false };
  }
  if (!identifier(body.feeTypeId)) invalid("Frais invalide.");
  const configId = feeAllocationConfigId(schoolId, yearId, body.feeTypeId);
  const configSnapshot = await db.doc(`feeAllocationConfigs/${configId}`).get();
  const config = configSnapshot.data();
  if (!configSnapshot.exists) throw new FeeAllocationError(404, "not-found", "Configuration introuvable.");
  if (body.action === "list-versions") {
    const snapshot = await db.collection("feeAllocationVersions").where("configId", "==", configId).get();
    return { versions: snapshot.docs.map((item) => item.data()), operational: false };
  }
  if (body.action === "validate-draft") {
    if (role(caller.role) !== "school_admin") denied();
    if (!config.draft) conflict("Aucun brouillon à valider.");
    const feeSnapshot = await db.doc(`feeTypes/${body.feeTypeId}`).get();
    if (!feeSnapshot.exists || feeSnapshot.data()?.schoolId !== schoolId || feeSnapshot.data()?.schoolYearId !== yearId) denied();
    if (toMoneyMinor(feeSnapshot.data().amount) !== config.draft.feeAmountMinor) conflict("Le tarif a changé depuis le brouillon.");
    return { ...validateFeeAllocationRubrics(config.draft.rubrics, config.draft.feeAmountMinor), operational: false };
  }
  invalid("Action de répartition invalide.");
}
