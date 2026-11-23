import { allocationHash as hash, allocationFail as fail } from './feeAllocationRuntime.js';
import { allocationRunRef, readAllocationRevisionDetail } from './feeAllocationRevision.js';
import { toMoneyMinor } from './money.js';

/** Lot « 3 étapes », point 5 : un encaissement reçu pendant la mise en route ne fait plus tout recommencer.
 * - Le paiement est enregistré normalement, avec une fiche « en attente de répartition » marquée « à l'activation ».
 * - Une fiche par école et par année suit la chaîne des encaissements depuis la fin de la vérification.
 *   Si une autre écriture (dépense, correction, paie, justification…) s'intercale, la chaîne est rompue
 *   et la vérification doit être refaite, comme avant.
 * - À l'activation, la coupure est la date de la vérification : ces paiements sont répartis juste après. */
export const SETUP_PENDING_REASON = "Encaissé pendant la mise en route de la répartition : réparti à l'activation.";
export const setupDeltaRef = (db, schoolId, yearId, currency) => db.doc(`feeAllocationSetupDeltas/${hash([schoolId, yearId, currency])}`);

/** Lectures faites avant toute écriture. Renvoie l'écriture à faire après le verrou de caisse, ou null. */
export async function prepareSetupPaymentTracking({ db, transaction, state, source, now, pendingRef }) {
  if (state?.status !== 'EN_PREPARATION' || !state.reconciliationRunId || state.currency !== source.currency) return null;
  const run = (await transaction.get(allocationRunRef(db, state.reconciliationRunId))).data();
  if (!run || run.status !== 'COMPLETE' || run.schoolId !== source.schoolId || run.currency !== source.currency
    || run.schoolYearId !== (source.collectionSchoolYearId ?? source.schoolYearId) || !run.lockRevisions) return null;
  const deltaRef = setupDeltaRef(db, run.schoolId, run.schoolYearId, run.currency);
  const delta = (await transaction.get(deltaRef)).data();
  const amountMinor = toMoneyMinor(source.amount);
  return (cash) => {
    // Seule la création d'un paiement (avec son passage par le verrou de caisse) est suivie ; une reprise ne l'est pas.
    if (!cash?.lockRevisionAfter) return;
    transaction.set(pendingRef, { schoolId: source.schoolId, paymentId: source.id, kind: 'creation', reason: SETUP_PENDING_REASON,
      waitActivation: true, status: 'pending', actorId: null, createdAt: now, updatedAt: now }, { merge: true });
    const base = run.lockRevisions[run.currency] ?? null;
    const sameRun = delta?.runId === run.id;
    const intact = (sameRun ? !delta.broken && delta.currentRevision === (cash.lockRevisionBefore ?? null) : base === (cash.lockRevisionBefore ?? null));
    transaction.set(deltaRef, intact
      ? { schoolId: run.schoolId, schoolYearId: run.schoolYearId, currency: run.currency, runId: run.id, baseRevision: base, broken: false,
          currentRevision: cash.lockRevisionAfter, count: (sameRun ? delta.count : 0) + 1, receivedMinor: (sameRun ? delta.receivedMinor : 0) + amountMinor, updatedAt: now }
      : { schoolId: run.schoolId, schoolYearId: run.schoolYearId, currency: run.currency, runId: run.id, baseRevision: base, broken: true,
          currentRevision: null, count: 0, receivedMinor: 0, updatedAt: now });
  };
}

/** La vérification reste valable si rien n'a changé, ou si seuls des encaissements de la mise en route ont eu lieu.
 * Renvoie le nombre et le total de ces encaissements (comptés après la date de vérification). */
export async function readRunFreshness(db, tx, run, schoolId, yearId, currency, { throwIfStale = true } = {}) {
  if (!run || run.schoolId !== schoolId || run.schoolYearId !== yearId || run.currency !== currency) fail('Rapprochement hors périmètre.');
  const detail = await readAllocationRevisionDetail(db, tx, schoolId, yearId);
  if (detail.revision === run.revision) return { stale: false, setupCount: 0, setupReceivedMinor: 0 };
  if (run.status === 'COMPLETE' && run.lockRevisions && run.evidenceStamp === detail.evidence) {
    const other = currency === 'USD' ? 'CDF' : 'USD';
    if ((run.lockRevisions[other] ?? null) === detail.locks[other]) {
      const delta = (await tx.get(setupDeltaRef(db, schoolId, yearId, currency))).data();
      if (delta && delta.runId === run.id && !delta.broken && delta.count > 0 && Number.isSafeInteger(delta.receivedMinor)
        && delta.baseRevision === (run.lockRevisions[currency] ?? null) && delta.currentRevision === detail.locks[currency]) {
        return { stale: false, setupCount: delta.count, setupReceivedMinor: delta.receivedMinor };
      }
    }
  }
  if (throwIfStale) fail('Les pièces ont changé : refaire le rapprochement.', 'allocation-stale');
  return { stale: true, setupCount: 0, setupReceivedMinor: 0 };
}
