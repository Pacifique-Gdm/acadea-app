import { createHash } from "node:crypto";
import { FeeAllocationError, validateFeeAllocationRubrics } from "./feeAllocationMath.js";
import { feeAllocationConfigId, readFeeAllocationScope, readFeeAllocationYear } from "./feeAllocationPhase1.js";
import { toMoneyMinor } from "./money.js";
import { AUDIT_EVENT_TYPES, buildServerAudit } from "./serverAudit.js";
import { readFeeAllocationLedger } from "./feeAllocationLedger.js";

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const id = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const nameKey = (value) => String(value).normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");
const fail = (status, code, message) => { throw new FeeAllocationError(status, code, message); };
const active = (value) => value && value.active !== false && !["inactive", "disabled", "suspended", "deleting", "deleted"].includes(value.status);
const isAdmin = (role) => role === "school_admin" || role === "admin";
const fields = (body, allowed) => { if (Object.keys(body).some((key) => !allowed.includes(key))) fail(400, "invalid-argument", "Champs de répartition non autorisés."); };

/** The only read model for the phase 2 drawer. No payments, balances or student records are read. */
export async function manageFeeAllocationPhase2({ db, caller, body }) {
  if (body.action === "get-workspace") {
    fields(body, ["action", "schoolId", "ledgerPage", "ledgerFingerprint"]);
    const { school, schoolId } = await readFeeAllocationScope(db, caller, body.schoolId ?? caller.schoolId);
    const { yearId, year, currency } = await readFeeAllocationYear(db, schoolId, school, undefined, false);
    const [fees, configs] = await Promise.all([
      db.collection("feeTypes").where("schoolId", "==", schoolId).where("schoolYearId", "==", yearId).get(),
      db.collection("feeAllocationConfigs").where("schoolId", "==", schoolId).where("schoolYearId", "==", yearId).get(),
    ]);
    return {
      school: { id: schoolId, name: school.name, activeSchoolYearId: yearId },
      year: { id: yearId, schoolId, name: year.name, status: year.status, startsAt: year.startsAt ?? null, endsAt: year.endsAt ?? null },
      currency, canConfigure: isAdmin(caller.role) && year.status === "active", operational: false,
      fees: fees.docs.map((row) => { const fee = row.data(); return { id: row.id, name: fee.name,
        className: fee.className, classOptionKey: fee.classOptionKey ?? null, amount: fee.amount }; }),
      configs: configs.docs.map((row) => row.data()),
      ledger: await readFeeAllocationLedger({ db, schoolId, schoolYearId: yearId, currency, page: body.ledgerPage ?? 0, fingerprint: body.ledgerFingerprint }),
    };
  }
  if (body.action !== "save-drafts") fail(400, "invalid-argument", "Action préparatoire inconnue.");
  fields(body, ["action", "schoolYearId", "baseFeeTypeId", "targets", "rubrics", "requestId"]);
  if (!isAdmin(caller.role)) fail(403, "permission-denied", "Seul l'Administrateur peut préparer une répartition.");
  await readFeeAllocationScope(db, caller, caller.schoolId);
  if (!id(body.schoolYearId) || !id(body.baseFeeTypeId) || !id(body.requestId) || body.requestId.length < 12
    || !Array.isArray(body.targets) || body.targets.length < 1 || body.targets.length > 50
    || body.targets.some((target) => !target || Object.keys(target).some((key) => !["feeTypeId", "expectedRevision"].includes(key))
      || !id(target.feeTypeId) || !Number.isSafeInteger(target.expectedRevision) || target.expectedRevision < 0)
    || new Set(body.targets.map((target) => target.feeTypeId)).size !== body.targets.length) {
    fail(400, "invalid-argument", "Sélectionnez entre 1 et 50 classes distinctes avec leurs révisions.");
  }
  const targets = [...body.targets].sort((a, b) => a.feeTypeId.localeCompare(b.feeTypeId));
  const schoolId = caller.schoolId;
  const fingerprint = hash([body.schoolYearId, body.baseFeeTypeId, targets, body.rubrics]);
  const receiptRef = db.doc(`feeAllocationRequests/${hash([caller.uid, schoolId, "batch", body.requestId])}`);
  return db.runTransaction(async (transaction) => {
    const [schoolSnapshot, profileSnapshot, receipt] = await Promise.all([
      transaction.get(db.doc(`schools/${schoolId}`)), transaction.get(db.doc(`users/${caller.uid}`)), transaction.get(receiptRef),
    ]);
    const school = schoolSnapshot.data(), profile = profileSnapshot.data();
    if (!schoolSnapshot.exists || !active(school) || !profileSnapshot.exists || !active(profile)
      || !isAdmin(profile.role) || profile.schoolId !== schoolId) fail(403, "permission-denied", "Compte ou établissement non autorisé.");
    if (receipt.exists) {
      const prior = receipt.data();
      if (prior.userId !== caller.uid || prior.schoolId !== schoolId || prior.fingerprint !== fingerprint) fail(409, "conflict", "Cette demande a déjà un autre contenu.");
      return { ...prior.result, idempotent: true };
    }
    if (school.activeSchoolYearId !== body.schoolYearId) fail(409, "conflict", "L'année active a changé. Actualisez la répartition.");
    const [yearSnapshot, baseSnapshot] = await Promise.all([
      transaction.get(db.doc(`schoolYears/${body.schoolYearId}`)), transaction.get(db.doc(`feeTypes/${body.baseFeeTypeId}`)),
    ]);
    const year = yearSnapshot.data(), base = baseSnapshot.data();
    if (!yearSnapshot.exists || year.schoolId !== schoolId || year.status !== "active") fail(409, "conflict", "Année scolaire inactive.");
    if (!baseSnapshot.exists || base.schoolId !== schoolId || base.schoolYearId !== body.schoolYearId) fail(403, "permission-denied", "Frais hors périmètre.");
    const currency = year.currency === "USD" || year.currency === "CDF" ? year.currency : school.currency === "CDF" ? "CDF" : "USD";
    const stateRef = db.doc(`feeAllocationStates/${hash([schoolId, body.schoolYearId, currency])}`);
    const state = await transaction.get(stateRef);
    if (state.exists && ["ACTIVE", "PAUSED"].includes(state.data().status)) fail(409, "phase-not-ready", "Modification préparatoire interdite après activation.");
    const rows = await Promise.all(targets.map(async (target) => {
      const configId = feeAllocationConfigId(schoolId, body.schoolYearId, target.feeTypeId);
      const ref = db.doc(`feeAllocationConfigs/${configId}`);
      const [feeSnapshot, previous] = await Promise.all([transaction.get(db.doc(`feeTypes/${target.feeTypeId}`)), transaction.get(ref)]);
      const fee = feeSnapshot.data(), config = previous.data();
      if (!feeSnapshot.exists || fee.schoolId !== schoolId || fee.schoolYearId !== body.schoolYearId
        || !fee.className || nameKey(fee.name) !== nameKey(base.name)) fail(403, "permission-denied", "Frais ou classe hors de la sélection autorisée.");
      if (config && (config.schoolId !== schoolId || config.schoolYearId !== body.schoolYearId || config.feeTypeId !== target.feeTypeId)) fail(403, "permission-denied", "Configuration hors périmètre.");
      if ((config?.draftRevision ?? 0) !== target.expectedRevision) fail(409, "conflict", "Un brouillon a changé. Actualisez avant de réessayer.");
      let minor;
      try { minor = toMoneyMinor(fee.amount); } catch { fail(400, "invalid-argument", "Tarif invalide."); }
      const validated = validateFeeAllocationRubrics(body.rubrics, minor);
      return { ref, previous, fee, configId, minor, validated, target };
    }));
    if (new Set(rows.map(({ fee }) => fee.classOptionKey || fee.className)).size !== rows.length) fail(400, "invalid-argument", "Deux frais ciblent la même classe ; vérifiez les tarifs existants.");
    const now = new Date().toISOString();
    const configs = rows.map(({ previous, fee, configId, minor, validated, target }) => {
      const config = { id: configId, schoolId, schoolYearId: body.schoolYearId, feeTypeId: target.feeTypeId,
        className: fee.className, ...(fee.classOptionKey ? { classOptionKey: fee.classOptionKey } : {}), currency,
        draftRevision: target.expectedRevision + 1,
        draft: { rubrics: validated.rubrics, feeAmountMinor: minor, updatedAt: now, updatedBy: caller.uid },
        ...(previous.data()?.currentVersionId ? { currentVersionId: previous.data().currentVersionId } : {}) };
      return config;
    });
    // The request itself is bounded, but rubrics are repeated once per target
    // in the idempotency receipt. Keep that single document safely below 1 MiB.
    if (Buffer.byteLength(JSON.stringify(configs), "utf8") > 750_000) {
      fail(400, "invalid-argument", "Ce lot est trop volumineux. Sélectionnez moins de classes par enregistrement.");
    }
    rows.forEach(({ ref, previous }, index) => {
      if (previous.exists) transaction.update(ref, configs[index]); else transaction.create(ref, configs[index]);
    });
    if (!state.exists) transaction.create(stateRef, { schoolId, schoolYearId: body.schoolYearId, currency, status: "EN_PREPARATION", createdAt: now, updatedAt: now });
    const auditId = `audit_allocation_${hash([caller.uid, schoolId, "batch", body.requestId]).slice(0, 32)}`;
    transaction.create(db.doc(`auditLogs/${auditId}`), buildServerAudit({ id: auditId,
      eventType: AUDIT_EVENT_TYPES.FINANCE_ALLOCATION_DRAFT_SAVED, actor: caller, schoolId, schoolYearId: body.schoolYearId,
      resourceType: "feeAllocation", resourceId: configs[0].id, metadata: { targetCount: configs.length, operational: false } }));
    const result = { configs, operational: false };
    transaction.create(receiptRef, { schoolId, schoolYearId: body.schoolYearId, userId: caller.uid, fingerprint, result, createdAt: now });
    return { ...result, idempotent: false };
  });
}
