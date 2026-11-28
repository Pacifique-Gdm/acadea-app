import { readFeeAllocationScope, readFeeAllocationYear } from "./feeAllocationPhase1.js";
import { readRubricCatalog } from "./feeAllocationRubrics.js";
import { socialDraftRubrics, validateFeeAllocationRubrics } from "./feeAllocationMath.js";
import { SOCIAL_PUBLISH_CONFIRMATION, buildSocialVersion } from "./feeAllocationSocialPart.js";
import { AUDIT_EVENT_TYPES, buildServerAudit } from "./serverAudit.js";
import { toMoneyMinor } from "./money.js";
import { allocationRunRef, evidenceRevisionRef } from './feeAllocationRevision.js';
import { readRunFreshness } from './feeAllocationSetupPayments.js';
import { settlePendingFeeAllocations } from './feeAllocationPending.js';
import { allocationHash as hash, allocationStateId, allocationBalanceId, allocationFail as fail,
  allocationIdentifier as id, allocationMinor as minor, readAllocationEligibility, readOperationalAllocation } from "./feeAllocationRuntime.js";

export const allocationLifecycleActions = new Set(["publish-configuration", "prepare-opening", "approve-opening", "activate", "pause", "resume",
  // Lot « 3 étapes » : solde validé en une fois, solde annulable avant l'activation, école sans aucune écriture.
  "validate-opening", "cancel-opening", "activate-without-history"]);
export const VALIDATE_OPENING_PHRASE = "VALIDER LE SOLDE DE DEPART";
export const CANCEL_OPENING_PHRASE = "ANNULER LE SOLDE DE DEPART";
const REASON_MIN = 10, REASON_MAX = 500;
/** Libellés des historiques (Administrateur, Coordination). */
const AUDIT_LABELS = { "publish-configuration": "Répartition des frais publiée", "prepare-opening": "Solde de départ proposé", "approve-opening": "Solde de départ approuvé",
  "validate-opening": "Solde de départ validé", "cancel-opening": "Solde de départ annulé", activate: "Répartition des frais activée",
  "activate-without-history": "Répartition des frais activée (aucune écriture)", resume: "Répartition des frais reprise" };
const reasonOk = value => typeof value === "string" && value.trim().length >= REASON_MIN && value.length <= REASON_MAX;
const signed = value => Number.isSafeInteger(value);
const active = p => p && p.active !== false && !["inactive", "disabled", "suspended", "deleted", "deleting"].includes(p.status);

export async function manageFeeAllocationLifecycle({ db, caller, body, now = new Date().toISOString() }) {
  if (!allocationLifecycleActions.has(body.action)) fail("Action inconnue.", "invalid-argument", 400);
  // Lot 27a (décision du propriétaire) : la répartition ne peut plus être mise en pause.
  // « resume » reste possible pour remettre en service un ancien état « PAUSED ».
  if (body.action === "pause") fail("La pause de la répartition n'existe plus : elle reste toujours disponible.", "invalid-argument", 400);
  if (!["admin", "school_admin"].includes(caller.role)) fail("Action réservée à l'Administrateur.", "permission-denied", 403);
  await readFeeAllocationScope(db, caller, caller.schoolId);
  await readAllocationEligibility(db, null, caller.schoolId, now);
  const openingFields = ["lines", "cashCountMinor", "confirmation", "unallocatedReason", "deficitReason", "cashGapReason"];
  const allowed = { "publish-configuration": ["versionId", "confirmation"], "prepare-opening": openingFields, "validate-opening": openingFields,
    "approve-opening": ["openingId", "confirmation"], activate: ["openingId", "confirmation"], pause: ["reason"], resume: ["reason"],
    "cancel-opening": ["openingId", "confirmation"], "activate-without-history": ["confirmation"] };
  if (Object.keys(body).some(k => !["action", "requestId", ...allowed[body.action]].includes(k)) || !id(body.requestId) || body.requestId.length < 12) fail("Demande invalide.", "invalid-argument", 400);
  const fingerprint = hash(body), schoolId = caller.schoolId;
  const outcome = await db.runTransaction(async tx => {
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
      const live = ["ACTIVE", "PAUSED"].includes(state?.status)
        ? await readOperationalAllocation({ db, transaction: tx, schoolId, schoolYearId: yearId, currency, now }) : null;
      if (!id(body.versionId)) fail("Version invalide.", "invalid-argument", 400);
      const versionRef = db.doc(`feeAllocationVersions/${body.versionId}`), version = (await tx.get(versionRef)).data();
      if (!version || version.schoolId !== schoolId || version.schoolYearId !== yearId || version.currency !== currency || version.status !== "prepared") fail("Version préparée introuvable.");
      const configRef = db.doc(`feeAllocationConfigs/${version.configId}`), config = (await tx.get(configRef)).data();
      const fee = (await tx.get(db.doc(`feeTypes/${version.feeTypeId}`))).data();
      if (!config || config.schoolId !== schoolId || config.schoolYearId !== yearId || config.currency !== currency || config.feeTypeId !== version.feeTypeId || config.draftRevision !== version.version
        || !fee || fee.schoolId !== schoolId || fee.schoolYearId !== yearId || toMoneyMinor(fee.amount) !== version.feeAmountMinor
        || fee.currency && fee.currency !== currency
        || fee.className !== version.className || (fee.classOptionKey ?? null) !== (version.classOptionKey ?? null)) fail("Tarif ou brouillon modifié depuis préparation.");
      const checked = validateFeeAllocationRubrics(version.rubrics, version.feeAmountMinor);
      // Firestore canonicalizes map key order; compare typed fields, not JSON order.
      if (!Array.isArray(version.shares) || checked.shares.length !== version.shares.length
        || checked.shares.some((share, index) => share.rubricId !== version.shares[index]?.rubricId
          || share.amountMinor !== version.shares[index]?.amountMinor
          || Object.keys(version.shares[index]).some(key => !["rubricId", "amountMinor"].includes(key)))) fail("Répartition préparée incohérente.");
      // Version 1.19.0 : partie des cas sociaux saisie avec la partie 1 → publiée en même temps, après la phrase tapée.
      const socialRubrics = version.socialRubrics ? socialDraftRubrics(version.socialRubrics, checked.rubrics, version.feeAmountMinor) : null;
      if (socialRubrics && body.confirmation !== SOCIAL_PUBLISH_CONFIRMATION) fail(`La partie des cas sociaux est différente : tapez exactement « ${SOCIAL_PUBLISH_CONFIRMATION} » pour publier les deux parties.`, "invalid-argument", 400);
      const oldSocialRef = socialRubrics && config.socialVersionId ? db.doc(`feeAllocationSocialVersions/${config.socialVersionId}`) : null;
      if (oldSocialRef) await tx.get(oldSocialRef);
      const oldRef = config.currentVersionId ? db.doc(`feeAllocationVersions/${config.currentVersionId}`) : null;
      if (oldRef) await tx.get(oldRef);
      const guardRef = db.doc(`feeAllocationFeeGuards/${version.feeTypeId}`);
      const guard = (await tx.get(guardRef)).data();
      if (live && (oldRef || guard)) fail("Un frais déjà réparti ne peut pas être remplacé après activation.");
      const rubrics = new Map((live?.rubrics ?? []).map(r => [r.id, r]));
      for (const rubric of checked.rubrics) {
        if (rubrics.has(rubric.id) && rubrics.get(rubric.id).name !== rubric.name) fail("Le nom d'une rubrique existante ne peut pas être remplacé.");
        rubrics.set(rubric.id, { id: rubric.id, name: rubric.name });
      }
      if (live && rubrics.size > 40) fail("Le maximum de 40 rubriques par établissement et année est atteint.");
      tx.update(versionRef, { status: "published", effectiveFrom: now, publishedBy: caller.uid,
        ...(live ? { publicationMode: "new-fee-after-activation", openingId: live.openingId } : {}) });
      let social = null;
      if (socialRubrics) {
        const named = socialRubrics.map((rubric) => ({ ...rubric, name: checked.rubrics.find((item) => item.id === rubric.id).name }));
        social = buildSocialVersion({ configId: config.id, schoolId, yearId, feeTypeId: version.feeTypeId, partOne: { ...version, rubrics: checked.rubrics }, previous: null,
          rubrics: validateFeeAllocationRubrics(named, version.feeAmountMinor, { allowZero: true }).rubrics, caller, now });
        tx.create(db.doc(`feeAllocationSocialVersions/${social.id}`), social);
        if (oldSocialRef) tx.update(oldSocialRef, { status: "superseded", supersededAt: now });
        const auditId = `audit_allocation_${hash([caller.uid, schoolId, "social-with-part-one", body.requestId]).slice(0, 32)}`;
        tx.create(db.doc(`auditLogs/${auditId}`), buildServerAudit({ id: auditId, eventType: AUDIT_EVENT_TYPES.FINANCE_ALLOCATION_SOCIAL_PART_PUBLISHED,
          actor: caller, schoolId, schoolYearId: yearId, resourceType: "feeAllocation", resourceId: config.id,
          metadata: { feeTypeId: version.feeTypeId, socialVersion: social.version, copyOfPartOne: social.copyOfPartOne, withPartOne: true } }));
      }
      tx.update(configRef, { currentVersionId: version.id, ...(social ? { socialVersionId: social.id } : {}) });
      // No opening, balance or historical movement is rewritten. Updating the
      // state also serializes simultaneous publications and in-flight receipts.
      if (live) tx.update(stateRef, { rubrics: [...rubrics.values()], updatedAt: now });
      tx.set(evidenceRevisionRef(db, schoolId, yearId), { schoolId, schoolYearId: yearId, revision: fingerprint });
      tx.set(db.doc(`feeAllocationForecastSignals/${hash([schoolId, yearId])}`), { schoolId, schoolYearId: yearId, revision: fingerprint });
      if (oldRef) tx.update(oldRef, { status: "superseded" });
      tx.set(guardRef, { schoolId, schoolYearId: yearId, configId: config.id, versionId: version.id });
      result.versionId = version.id;
      if (social) result.socialVersionId = social.id;
    } else if (body.action === "cancel-opening") {
      // Lot « 3 étapes », point 3 : un solde proposé ou validé peut être annulé avant l'activation, pour le refaire.
      if (["ACTIVE", "PAUSED"].includes(state?.status)) fail("Répartition déjà activée : le solde de départ ne peut plus être annulé.");
      if (body.confirmation !== CANCEL_OPENING_PHRASE) fail(`Tapez exactement « ${CANCEL_OPENING_PHRASE} ».`, "invalid-argument", 400);
      if (!id(body.openingId) || state?.lastOpeningId !== body.openingId) fail("Solde de départ introuvable : actualisez.");
      const ref = db.doc(`feeAllocationOpeningAudits/${body.openingId}`), proposal = (await tx.get(ref)).data();
      if (!proposal || proposal.schoolId !== schoolId || proposal.schoolYearId !== yearId || proposal.currency !== currency
        || !["proposed", "approved"].includes(proposal.status)) fail("Solde de départ introuvable ou déjà activé.");
      tx.update(ref, { status: "cancelled", cancelledBy: caller.uid, cancelledAt: now });
      tx.set(stateRef, { lastOpeningId: null, updatedAt: now }, { merge: true });
      result.openingId = proposal.id;
    } else if (["prepare-opening", "validate-opening", "approve-opening", "activate", "activate-without-history"].includes(body.action)) {
      if (["ACTIVE", "PAUSED"].includes(state?.status)) fail("Périmètre déjà activé.");
      const run = state?.reconciliationRunId ? (await tx.get(allocationRunRef(db, state.reconciliationRunId))).data() : null;
      // Lot « 3 étapes », point 5 : seuls des encaissements reçus depuis la vérification ne la rendent pas caduque.
      const fresh = await readRunFreshness(db, tx, run, schoolId, yearId, currency);
      if (run.status !== 'COMPLETE' || run.blockedCount) fail('Rapprochement complet et justifié requis.');
      if (!run.configurationCount || !run.rubrics?.length || run.rubrics.length > 40) fail('Une configuration publiée est indispensable.');
      const rubrics = new Map(run.rubrics.map(r => [r.id, r]));
      const configurationFingerprint = run.configurationChain;
      const schoolAvailableMinor = run.receivedMinor - run.spentMinor, cashAvailableMinor = schoolAvailableMinor + run.otherMinor;
      if (!signed(schoolAvailableMinor) || !signed(cashAvailableMinor)) fail("Total financier incohérent.");
      const inventory = { fingerprint: hash([run.id, run.chain, run.revision]), evidenceCount: run.evidenceCount,
        evidencePages: run.pageCount, evidenceRunId: run.id, schoolAvailableMinor, cashAvailableMinor };
      const lockRef = db.doc(`financialCashLocks/${createCashLock(schoolId, yearId, currency)}`);
      await tx.get(lockRef);
      const activationPhrase = scope.testOnly ? "ACTIVER LA REPARTITION FICTIVE" : "ACTIVER LA REPARTITION DE MON ETABLISSEMENT";
      // Écrit le solde de départ de chaque rubrique et passe l'école à « Active ». Un « Non affecté » négatif
      // (dépenses > encaissements, manque en caisse) est gardé comme une dépense de départ : chaque solde reste cohérent.
      const writeActivation = async (proposal, openingRef, createOpening = false) => {
        const gap = proposal.cashGapMinor ?? 0;
        const userLine = rubricId => proposal.lines.find(l => l.rubricId === rubricId)?.amountMinor ?? 0;
        const balanceRows = await Promise.all([...rubrics.keys(), "UNALLOCATED"].map(async rubricId => {
          const balanceRef = db.doc(`feeAllocationBalances/${allocationBalanceId(schoolId, yearId, currency, rubricId)}`);
          if ((await tx.get(balanceRef)).exists) fail("Solde déjà présent : rapprochement nécessaire.");
          return { balanceRef, rubricId, amount: userLine(rubricId) + (rubricId === "UNALLOCATED" ? gap : 0) };
        }));
        const movementId = `opening_${hash([schoolId, yearId, currency])}`;
        if ((await tx.get(db.doc(`feeAllocationMovements/${movementId}`))).exists) fail("Ouverture déjà comptabilisée.");
        // Toutes les lectures sont faites : les écritures peuvent commencer.
        if (createOpening) tx.create(openingRef, proposal);
        const lines = balanceRows.filter(r => r.amount !== 0 || proposal.lines.some(l => l.rubricId === r.rubricId)).map(r => ({ rubricId: r.rubricId, amountMinor: r.amount }));
        tx.create(db.doc(`feeAllocationMovements/${movementId}`), { id: movementId, schoolId, collectionSchoolYearId: yearId,
          currency, sourceType: "opening", sourceId: proposal.id, sourceRevision: body.requestId, type: "opening", postedAt: now,
          amountMinor: lines.reduce((n, l) => n + l.amountMinor, 0), lines, actorId: caller.uid, testOnly: scope.testOnly });
        balanceRows.forEach(({ balanceRef, rubricId, amount }) => tx.create(balanceRef, { schoolId, collectionSchoolYearId: yearId,
          currency, rubricId, openingMinor: Math.max(0, amount), receivedMinor: 0, spentMinor: Math.max(0, -amount), reservedMinor: 0,
          availableMinor: amount, ...(amount < 0 ? { openingDeficitMinor: -amount } : {}), operational: true, updatedAt: now }));
        // Avec des encaissements de la mise en route, la coupure est la date de la vérification : ils sont répartis juste après.
        const cutoffAt = fresh.setupCount > 0 ? run.cutoffAt : now;
        tx.set(stateRef, { schoolId, schoolYearId: yearId, currency, status: "ACTIVE", fixtureId: scope.fixtureId,
          openingId: proposal.id, cutoffAt, activatedAt: now, activatedBy: caller.uid, rubrics: [...rubrics.values()], configurationFingerprint });
        tx.update(openingRef, { status: "activated", activatedAt: now, setupPaymentCount: fresh.setupCount, setupReceivedMinor: fresh.setupReceivedMinor });
        result.settleAfter = fresh.setupCount > 0;
      };
      if (body.action === "activate-without-history") {
        // Lot « 3 étapes », B : école sans aucun paiement, dépense ni autre entrée cette année : tout est à zéro, un seul écran « Activer ».
        if (body.confirmation !== activationPhrase) fail(`Tapez exactement « ${activationPhrase} ».`, "invalid-argument", 400);
        if (fresh.setupCount || run.evidenceCount || run.receivedMinor || run.spentMinor || run.otherMinor) fail("Des écritures existent : validez d'abord le solde de départ.");
        const openingId = `opening_${hash([schoolId, body.requestId])}`, openingRef = db.doc(`feeAllocationOpeningAudits/${openingId}`);
        const proposal = { id: openingId, schoolId, schoolYearId: yearId, currency, fixtureId: scope.fixtureId, cutoffAt: now, status: "approved",
          lines: [], cashGapMinor: 0, emptyHistory: true, configurationFingerprint, receiptVersionsRunId: run.id, ...inventory,
          cashCountMinor: 0, proposedBy: caller.uid, proposedAt: now, approvedBy: caller.uid, approvedAt: now };
        await writeActivation(proposal, openingRef, true);
        result.openingId = openingId;
      } else if (["prepare-opening", "validate-opening"].includes(body.action)) {
        const validate = body.action === "validate-opening";
        const expectedPhrase = validate ? VALIDATE_OPENING_PHRASE : "RAPPROCHER LA CAISSE";
        if (body.confirmation !== expectedPhrase) fail(`Tapez exactement « ${expectedPhrase} ».`, "invalid-argument", 400);
        if (!minor(body.cashCountMinor)) fail("Indiquez la caisse comptée.", "invalid-argument", 400);
        if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 41
          || body.lines.some(l => !l || Object.keys(l).some(k => !["rubricId", "amountMinor"].includes(k)) || l.rubricId !== "UNALLOCATED" && !rubrics.has(l.rubricId)
            || (l.rubricId === "UNALLOCATED" ? !signed(l.amountMinor) : !minor(l.amountMinor)))
          || new Set(body.lines.map(l => l.rubricId)).size !== body.lines.length
          || body.lines.reduce((n, l) => n + l.amountMinor, 0) !== schoolAvailableMinor) fail("L'ouverture doit expliquer exactement les fonds scolaires justifiés.");
        const unallocated = body.lines.find(l => l.rubricId === "UNALLOCATED")?.amountMinor ?? 0;
        // Caisse attendue = caisse justifiée à la vérification + encaissements reçus depuis.
        const cashExpectedMinor = cashAvailableMinor + fresh.setupReceivedMinor, cashGapMinor = body.cashCountMinor - cashExpectedMinor;
        // Points 2, 4 et 6 : chaque situation particulière demande son motif écrit, gardé dans l'historique.
        if (schoolAvailableMinor < 0 && !reasonOk(body.deficitReason)) fail("Dépenses supérieures aux encaissements : écrivez le motif (10 caractères au moins).", "invalid-argument", 400);
        if (cashGapMinor !== 0 && !reasonOk(body.cashGapReason)) fail("La caisse comptée diffère du calcul : écrivez le motif de l'écart (10 caractères au moins).", "invalid-argument", 400);
        // « Non affecté » n'est négatif que du déficit lui-même : on ne donne jamais aux rubriques un argent qui n'existe pas.
        if (unallocated < Math.min(0, schoolAvailableMinor)) fail("Les rubriques ne peuvent pas recevoir plus que les fonds scolaires justifiés.", "invalid-argument", 400);
        if (unallocated > 0 && !reasonOk(body.unallocatedReason)) fail("« Non affecté » n'est pas à zéro : écrivez la justification (10 caractères au moins).", "invalid-argument", 400);
        for (const key of ["deficitReason", "cashGapReason", "unallocatedReason"]) if (body[key] !== undefined && !reasonOk(body[key])) fail("Motif invalide (10 à 500 caractères).", "invalid-argument", 400);
        if (state?.lastOpeningId) {
          const prior = (await tx.get(db.doc(`feeAllocationOpeningAudits/${state.lastOpeningId}`))).data();
          if (prior && ["proposed", "approved"].includes(prior.status) && prior.fingerprint === inventory.fingerprint) fail("Un solde de départ existe déjà : annulez-le avant d'en saisir un autre.");
        }
        const openingId = `opening_${hash([schoolId, body.requestId])}`;
        // All immutable evidence pages already exist. The final atomic write
        // references their terminal chain; it never recopies the whole history.
        tx.create(db.doc(`feeAllocationOpeningAudits/${openingId}`), { id: openingId, schoolId, schoolYearId: yearId, currency,
          fixtureId: scope.fixtureId, cutoffAt: now, status: validate ? "approved" : "proposed", lines: body.lines, configurationFingerprint,
          receiptVersionsRunId: run.id,
          ...inventory,
          cashCountMinor: body.cashCountMinor, cashExpectedMinor, cashGapMinor, setupPaymentCount: fresh.setupCount, setupReceivedMinor: fresh.setupReceivedMinor,
          reasons: { deficit: body.deficitReason?.trim() ?? null, cashGap: body.cashGapReason?.trim() ?? null, unallocated: body.unallocatedReason?.trim() ?? null },
          proposedBy: caller.uid, proposedAt: now, ...(validate ? { approvedBy: caller.uid, approvedAt: now } : {}) });
        tx.set(stateRef, { schoolId, schoolYearId: yearId, currency, status: "EN_PREPARATION", lastOpeningId: openingId, updatedAt: now }, { merge: true });
        result.openingId = openingId;
      } else {
        if (!id(body.openingId)) fail("Rapprochement invalide.");
        const ref = db.doc(`feeAllocationOpeningAudits/${body.openingId}`), proposal = (await tx.get(ref)).data();
        if (!proposal || proposal.schoolId !== schoolId || proposal.schoolYearId !== yearId || proposal.currency !== currency
          || (proposal.fixtureId ?? null) !== scope.fixtureId || proposal.fingerprint !== inventory.fingerprint
          || proposal.configurationFingerprint !== configurationFingerprint || state?.lastOpeningId !== proposal.id) fail("Pièces ou configurations modifiées : refaire le rapprochement.");
        if (body.action === "approve-opening") {
          if (body.confirmation !== "APPROUVER LE RAPPROCHEMENT" || proposal.status !== "proposed") fail("Approbation explicite requise.");
          tx.update(ref, { status: "approved", approvedBy: caller.uid, approvedAt: now });
        } else {
          if (body.confirmation !== activationPhrase || proposal.status !== "approved" || proposal.approvedBy !== caller.uid) fail("Rapprochement approuvé requis.");
          await writeActivation(proposal, ref);
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
    // Libellé simple montré dans les historiques ; le code technique reste dans « actionCode ».
    tx.create(db.doc(`auditLogs/${auditId}`), { id: auditId, schoolId, schoolYearId: yearId, action: AUDIT_LABELS[body.action] ?? "Répartition des frais", actionCode: `fee-allocation.${body.action}`,
      actorId: caller.uid, actorName: typeof user.name === "string" && user.name ? user.name.slice(0, 120) : "Administrateur", createdAt: now, reason: body.reason ?? null, requestFingerprint: fingerprint, testOnly: scope.testOnly });
    tx.create(receiptRef, { schoolId, fingerprint, result, createdAt: now });
    return { ...result, idempotent: false };
  });
  // Lot « 3 étapes », point 5 : les encaissements reçus pendant la mise en route sont répartis tout de suite après l'activation.
  if (outcome.settleAfter) {
    const settled = await settlePendingFeeAllocations({ db, caller, schoolId, now });
    return { ...outcome, setupSettled: settled.processed, setupRemaining: settled.remaining };
  }
  return outcome;
}

// Exact same cash serialization key as protectCashMutation; do not invent a second cash lock.
import { createHash } from "node:crypto";
import { readKeptForecastRows, subRubricBalanceView, subRubricViewOptions } from "./feeAllocationSubRubrics.js";
const createCashLock = (school, year, currency) => createHash("sha256").update(`${school}:${year}:${currency}`).digest("hex");

export async function getAllocationSpendOptions({ db, caller, body, now = new Date().toISOString() }) {
  const { school, schoolId } = await readFeeAllocationScope(db, caller, body.schoolId ?? caller.schoolId);
  const { yearId, currency } = await readFeeAllocationYear(db, schoolId, school, body.schoolYearId, false);
  const state = await readOperationalAllocation({ db, transaction: null, schoolId, schoolYearId: yearId, currency, now });
  if (!state || !["ACTIVE", "PAUSED"].includes(state.status)) {
    // Lot « 3 étapes », point 5 : le caissier est prévenu quand l'Administrateur a commencé la mise en route (vérification lancée).
    const setup = (await db.doc(`feeAllocationStates/${allocationStateId(schoolId, yearId, currency)}`).get()).data();
    return { operational: false, required: false, rubrics: [], setupInProgress: setup?.status === "EN_PREPARATION" && !!setup.reconciliationRunId };
  }
  const catalog = await readRubricCatalog(db, schoolId, yearId);
  const base = catalog.enabled ? catalog.rubrics.filter((r) => !r.hidden).map((r) => ({ id: r.id, name: r.name, active: true,
    // Lots 5 et 6 : sous-rubriques avec leur solde, puis « Non affecté (rubrique) » ; « Fonctions concernées » pour la paie.
    ...(Array.isArray(r.subRubrics) && r.subRubrics.length ? { subRubricsSource: r.subRubrics, entry: r } : {}) })) : state.rubrics.filter(r => r.active !== false);
  const balances = await db.collection("feeAllocationBalances").where("schoolId", "==", schoolId).where("collectionSchoolYearId", "==", yearId).where("currency", "==", currency).get();
  // F2 (28/11/2026) : même prévu gardé que les tableaux, pour la part de l'ouverture de chaque sous-rubrique.
  const forecastRows = base.some((r) => r.subRubricsSource) ? await readKeptForecastRows(null, db, schoolId, yearId, currency) : null;
  const available = new Map(balances.docs.map((doc) => [doc.data().rubricId, (doc.data().openingMinor ?? 0) + (doc.data().receivedMinor ?? 0) - (doc.data().spentMinor ?? 0) - (doc.data().reservedMinor ?? 0)]));
  return { operational: false, required: true, paused: false, currency,
    rubrics: [...base, { id: "UNALLOCATED", name: "Non affecté", active: true },
      // Lot 27c-3a : lignes d'arriérés (après les rubriques de l'année), avec leur propre disponible.
      ...balances.docs.map((doc) => doc.data()).filter((b) => b.arrearsOf)
        .sort((a, b) => String(a.arrearsOf.originYearName).localeCompare(String(b.arrearsOf.originYearName), "fr") || (a.arrearsOf.rubricId === "UNALLOCATED") - (b.arrearsOf.rubricId === "UNALLOCATED") || String(a.arrearsOf.rubricName).localeCompare(String(b.arrearsOf.rubricName), "fr"))
        .map((b) => ({ id: b.rubricId, name: `${b.arrearsOf.rubricName} (arriéré ${b.arrearsOf.originYearName})`, active: true, arrears: true }))]
      .map(({ subRubricsSource, entry, ...r }) => ({ ...r, availableMinor: available.get(r.id) ?? 0,
        ...(subRubricsSource ? { subRubrics: subRubricBalanceView(balances.docs.map((doc) => doc.data()).find((b) => b.rubricId === r.id), subRubricsSource, r.name,
          subRubricViewOptions(entry, balances.docs.map((doc) => doc.data()).find((b) => b.rubricId === r.id), forecastRows))
          .map(({ id, name, functions, availableMinor }) => ({ id, name, functions, availableMinor })) } : {}) })) };
}
