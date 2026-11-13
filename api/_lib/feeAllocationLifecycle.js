import { readFeeAllocationScope, readFeeAllocationYear } from "./feeAllocationPhase1.js";
import { validateFeeAllocationRubrics } from "./feeAllocationMath.js";
import { toMoneyMinor } from "./money.js";
import { allocationRunRef, evidenceRevisionRef } from './feeAllocationRevision.js';
import { assertRunCurrent } from './feeAllocationReconciliation.js';
import { allocationHash as hash, allocationStateId, allocationBalanceId, allocationFail as fail,
  allocationIdentifier as id, allocationMinor as minor, readAllocationEligibility, readOperationalAllocation } from "./feeAllocationRuntime.js";

export const allocationLifecycleActions = new Set(["publish-configuration", "prepare-opening", "approve-opening", "activate", "pause", "resume"]);
const active = p => p && p.active !== false && !["inactive", "disabled", "suspended", "deleted", "deleting"].includes(p.status);
const sum = values => { const n = values.reduce((a, b) => a + BigInt(b), 0n); if (n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER)) fail("Total financier incohérent."); return Number(n); };

export async function manageFeeAllocationLifecycle({ db, caller, body, now = new Date().toISOString() }) {
  if (!allocationLifecycleActions.has(body.action)) fail("Action inconnue.", "invalid-argument", 400);
  if (!["admin", "school_admin"].includes(caller.role)) fail("Action réservée à l'Administrateur.", "permission-denied", 403);
  await readFeeAllocationScope(db, caller, caller.schoolId);
  await readAllocationEligibility(db, null, caller.schoolId, now);
  const allowed = { "publish-configuration": ["versionId"], "prepare-opening": ["lines", "cashCountMinor", "confirmation"],
    "approve-opening": ["openingId", "confirmation"], activate: ["openingId", "confirmation"], pause: ["reason"], resume: ["reason"] };
  if (Object.keys(body).some(k => !["action", "requestId", ...allowed[body.action]].includes(k)) || !id(body.requestId) || body.requestId.length < 12) fail("Demande invalide.", "invalid-argument", 400);
  const fingerprint = hash(body), schoolId = caller.schoolId;
  return db.runTransaction(async tx => {
    const scope = await readAllocationEligibility(db, tx, schoolId, now);
    const user = (await tx.get(db.doc(`users/${caller.uid}`))).data();
    if (!active(user) || !["admin", "school_admin"].includes(user.role) || user.schoolId !== schoolId) fail("Compte non autorisé.", "permission-denied", 403);
    const yearId = scope.school.activeSchoolYearId;
    const year = (await tx.get(db.doc(`schoolYears/${yearId}`))).data();
    if (!year || year.schoolId !== schoolId || year.status !== "active") fail("Année inactive.");
    const currency = year.currency ?? scope.school.currency;
    if (!["USD", "CDF"].includes(currency)) fail("Devise invalide.");
    const receiptRef = db.doc(`feeAllocationRequests/lifecycle_${hash([caller.uid, schoolId, body.requestId])}`);
    const receipt = (await tx.get(receiptRef)).data();
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) fail("Clé déjà utilisée avec un autre contenu.");
      return { ...receipt.result, idempotent: true };
    }
    const stateRef = db.doc(`feeAllocationStates/${allocationStateId(schoolId, yearId, currency)}`);
    const state = (await tx.get(stateRef)).data();
    const result = { operational: false, testOnly: scope.testOnly, action: body.action };
    if (body.action === "publish-configuration") {
      if (["ACTIVE", "PAUSED"].includes(state?.status)) fail("Publication interdite après activation sans nouveau rapprochement.");
      if (!id(body.versionId)) fail("Version invalide.", "invalid-argument", 400);
      const versionRef = db.doc(`feeAllocationVersions/${body.versionId}`), version = (await tx.get(versionRef)).data();
      if (!version || version.schoolId !== schoolId || version.schoolYearId !== yearId || version.currency !== currency || version.status !== "prepared") fail("Version préparée introuvable.");
      const configRef = db.doc(`feeAllocationConfigs/${version.configId}`), config = (await tx.get(configRef)).data();
      const fee = (await tx.get(db.doc(`feeTypes/${version.feeTypeId}`))).data();
      if (!config || config.schoolId !== schoolId || config.feeTypeId !== version.feeTypeId || config.draftRevision !== version.version
        || !fee || fee.schoolId !== schoolId || fee.schoolYearId !== yearId || toMoneyMinor(fee.amount) !== version.feeAmountMinor
        || fee.className !== version.className || (fee.classOptionKey ?? null) !== (version.classOptionKey ?? null)) fail("Tarif ou brouillon modifié depuis préparation.");
      const checked = validateFeeAllocationRubrics(version.rubrics, version.feeAmountMinor);
      // Firestore canonicalizes map key order; compare typed fields, not JSON order.
      if (!Array.isArray(version.shares) || checked.shares.length !== version.shares.length
        || checked.shares.some((share, index) => share.rubricId !== version.shares[index]?.rubricId
          || share.amountMinor !== version.shares[index]?.amountMinor
          || Object.keys(version.shares[index]).some(key => !["rubricId", "amountMinor"].includes(key)))) fail("Répartition préparée incohérente.");
      const oldRef = config.currentVersionId ? db.doc(`feeAllocationVersions/${config.currentVersionId}`) : null;
      if (oldRef) await tx.get(oldRef);
      tx.update(versionRef, { status: "published", effectiveFrom: now, publishedBy: caller.uid });
      tx.update(configRef, { currentVersionId: version.id });
      tx.set(evidenceRevisionRef(db, schoolId, yearId), { schoolId, schoolYearId: yearId, revision: fingerprint });
      if (oldRef) tx.update(oldRef, { status: "superseded" });
      tx.set(db.doc(`feeAllocationFeeGuards/${version.feeTypeId}`), { schoolId, schoolYearId: yearId, configId: config.id, versionId: version.id });
      result.versionId = version.id;
    } else if (["prepare-opening", "approve-opening", "activate"].includes(body.action)) {
      if (["ACTIVE", "PAUSED"].includes(state?.status)) fail("Périmètre déjà activé.");
      const run = state?.reconciliationRunId ? (await tx.get(allocationRunRef(db, state.reconciliationRunId))).data() : null;
      await assertRunCurrent(db, tx, run, schoolId, yearId, currency);
      if (run.status !== 'COMPLETE' || run.blockedCount || run.spentMinor > run.receivedMinor) fail('Rapprochement complet et justifié requis.');
      if (!run.configurationCount || !run.rubrics?.length || run.rubrics.length > 40) fail('Une configuration publiée est indispensable.');
      const rubrics = new Map(run.rubrics.map(r => [r.id, r]));
      const configurationFingerprint = run.configurationChain;
      const inventory = { fingerprint: hash([run.id, run.chain, run.revision]), evidenceCount: run.evidenceCount,
        evidencePages: run.pageCount, evidenceRunId: run.id, schoolAvailableMinor: run.receivedMinor - run.spentMinor,
        cashAvailableMinor: sum([run.receivedMinor - run.spentMinor, run.otherMinor]) };
      const lockRef = db.doc(`financialCashLocks/${createCashLock(schoolId, yearId, currency)}`);
      await tx.get(lockRef);
      if (body.action === "prepare-opening") {
        if (body.confirmation !== "RAPPROCHER LA CAISSE" || !minor(body.cashCountMinor) || body.cashCountMinor !== inventory.cashAvailableMinor) fail("Écart de caisse non résolu.");
        if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 41
          || body.lines.some(l => !l || Object.keys(l).some(k => !["rubricId", "amountMinor"].includes(k)) || !minor(l.amountMinor) || l.rubricId !== "UNALLOCATED" && !rubrics.has(l.rubricId))
          || new Set(body.lines.map(l => l.rubricId)).size !== body.lines.length
          || sum(body.lines.map(l => l.amountMinor)) !== inventory.schoolAvailableMinor) fail("L'ouverture doit expliquer exactement les fonds scolaires justifiés.");
        const openingId = `opening_${hash([schoolId, body.requestId])}`;
        // All immutable evidence pages already exist. The final atomic write
        // references their terminal chain; it never recopies the whole history.
        tx.create(db.doc(`feeAllocationOpeningAudits/${openingId}`), { id: openingId, schoolId, schoolYearId: yearId, currency,
          fixtureId: scope.fixtureId, cutoffAt: now, status: "proposed", lines: body.lines, configurationFingerprint,
          receiptVersionsRunId: run.id,
          ...inventory,
          cashCountMinor: body.cashCountMinor, proposedBy: caller.uid, proposedAt: now });
        tx.set(stateRef, { schoolId, schoolYearId: yearId, currency, status: "EN_PREPARATION", lastOpeningId: openingId, updatedAt: now }, { merge: true });
        result.openingId = openingId;
      } else {
        if (!id(body.openingId)) fail("Rapprochement invalide.");
        const ref = db.doc(`feeAllocationOpeningAudits/${body.openingId}`), proposal = (await tx.get(ref)).data();
        if (!proposal || proposal.schoolId !== schoolId || proposal.schoolYearId !== yearId || proposal.currency !== currency
          || (proposal.fixtureId ?? null) !== scope.fixtureId || proposal.fingerprint !== inventory.fingerprint
          || proposal.configurationFingerprint !== configurationFingerprint || proposal.cashCountMinor !== inventory.cashAvailableMinor) fail("Pièces ou configurations modifiées : refaire le rapprochement.");
        if (body.action === "approve-opening") {
          if (body.confirmation !== "APPROUVER LE RAPPROCHEMENT" || proposal.status !== "proposed") fail("Approbation explicite requise.");
          tx.update(ref, { status: "approved", approvedBy: caller.uid, approvedAt: now });
        } else {
          const confirmation = scope.testOnly ? "ACTIVER LA REPARTITION FICTIVE" : "ACTIVER LA REPARTITION DE MON ETABLISSEMENT";
          if (body.confirmation !== confirmation || proposal.status !== "approved" || proposal.approvedBy !== caller.uid) fail("Rapprochement approuvé requis.");
          const balanceRows = await Promise.all([...rubrics.keys(), "UNALLOCATED"].map(async rubricId => {
            const balanceRef = db.doc(`feeAllocationBalances/${allocationBalanceId(schoolId, yearId, currency, rubricId)}`);
            if ((await tx.get(balanceRef)).exists) fail("Solde déjà présent : rapprochement nécessaire.");
            return { balanceRef, rubricId, amount: proposal.lines.find(l => l.rubricId === rubricId)?.amountMinor ?? 0 };
          }));
          const movementId = `opening_${hash([schoolId, yearId, currency])}`;
          if ((await tx.get(db.doc(`feeAllocationMovements/${movementId}`))).exists) fail("Ouverture déjà comptabilisée.");
          tx.create(db.doc(`feeAllocationMovements/${movementId}`), { id: movementId, schoolId, collectionSchoolYearId: yearId,
            currency, sourceType: "opening", sourceId: proposal.id, sourceRevision: body.requestId, type: "opening", postedAt: now,
            amountMinor: inventory.schoolAvailableMinor, lines: proposal.lines, actorId: caller.uid, testOnly: scope.testOnly });
          balanceRows.forEach(({ balanceRef, rubricId, amount }) => tx.create(balanceRef, { schoolId, collectionSchoolYearId: yearId,
            currency, rubricId, openingMinor: amount, receivedMinor: 0, spentMinor: 0, reservedMinor: 0, availableMinor: amount, operational: true, updatedAt: now }));
          tx.set(stateRef, { schoolId, schoolYearId: yearId, currency, status: "ACTIVE", fixtureId: scope.fixtureId,
            openingId: proposal.id, cutoffAt: now, activatedAt: now, activatedBy: caller.uid, rubrics: [...rubrics.values()], configurationFingerprint });
          tx.update(ref, { status: "activated", activatedAt: now });
        }
        result.openingId = proposal.id;
      }
      // Approval is read-only with respect to the cash revision. Activation
      // serializes against financial writes by reading the same cash lock.
    } else {
      const expected = body.action === "pause" ? "ACTIVE" : "PAUSED";
      if (state?.status !== expected || (state.fixtureId ?? null) !== scope.fixtureId || typeof body.reason !== "string" || body.reason.trim().length < 5 || body.reason.length > 500) fail("État ou motif de pause/reprise invalide.");
      await readOperationalAllocation({ db, transaction: tx, schoolId, schoolYearId: yearId, currency, now });
      tx.update(stateRef, { status: body.action === "pause" ? "PAUSED" : "ACTIVE", updatedAt: now, updatedBy: caller.uid });
    }
    const auditId = `allocation_${hash([schoolId, body.requestId, caller.uid])}`;
    tx.create(db.doc(`auditLogs/${auditId}`), { id: auditId, schoolId, schoolYearId: yearId, action: `fee-allocation.${body.action}`,
      actorId: caller.uid, createdAt: now, reason: body.reason ?? null, requestFingerprint: fingerprint, testOnly: scope.testOnly });
    tx.create(receiptRef, { schoolId, fingerprint, result, createdAt: now });
    return { ...result, idempotent: false };
  });
}

// Exact same cash serialization key as protectCashMutation; do not invent a second cash lock.
import { createHash } from "node:crypto";
const createCashLock = (school, year, currency) => createHash("sha256").update(`${school}:${year}:${currency}`).digest("hex");

export async function getAllocationSpendOptions({ db, caller, body, now = new Date().toISOString() }) {
  const { school, schoolId } = await readFeeAllocationScope(db, caller, body.schoolId ?? caller.schoolId);
  const { yearId, currency } = await readFeeAllocationYear(db, schoolId, school, body.schoolYearId, false);
  const state = await readOperationalAllocation({ db, transaction: null, schoolId, schoolYearId: yearId, currency, now });
  if (!state || !["ACTIVE", "PAUSED"].includes(state.status)) return { operational: false, required: false, rubrics: [] };
  return { operational: false, required: true, paused: state.status === "PAUSED", currency,
    rubrics: [...state.rubrics.filter(r => r.active !== false), { id: "UNALLOCATED", name: "Non affecté", active: true }] };
}
