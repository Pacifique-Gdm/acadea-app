import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

/**
 * Compteur de changements de la Répartition des frais (version 1.15.2).
 * Un seul petit document par école et par année : `feeAllocationChangeCounters/{école__année}`.
 * Il avance à chaque changement qui modifie le drawer : paiement, dépense, correction et paie (verrou de caisse),
 * répartition (preuves, état, rubriques, partages, répartitions en attente), élèves et frais (signal du prévu).
 * Le drawer l'écoute et ne recharge ses montants que lorsqu'il bouge : plus aucune vérification en boucle.
 * Le compteur ne contient aucun montant ni aucune donnée d'élève.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,160}$/;
export const changeCounterId = (schoolId: string, schoolYearId: string) => `${schoolId}__${schoolYearId}`;
type Data = Record<string, unknown> | undefined;
export type CounterScope = { schoolId: string; schoolYearId?: string };

/** École et année d'un document source ; l'identifiant `école__année` sert quand les champs manquent. */
export function counterScopes(before: Data, after: Data, docId: string): CounterScope[] {
  const scopes = new Map<string, CounterScope>();
  for (const data of [before, after]) {
    if (!data) continue;
    const fromId = docId.includes('__') ? docId.split('__') : [];
    const schoolId = typeof data.schoolId === 'string' ? data.schoolId : fromId[0];
    const yearValue = data.schoolYearId ?? data.collectionSchoolYearId ?? fromId[1];
    const schoolYearId = typeof yearValue === 'string' ? yearValue : undefined;
    if (!schoolId || !SAFE_ID.test(schoolId) || (schoolYearId !== undefined && !SAFE_ID.test(schoolYearId))) continue;
    scopes.set(`${schoolId}|${schoolYearId ?? ''}`, { schoolId, ...(schoolYearId ? { schoolYearId } : {}) });
  }
  return [...scopes.values()];
}

async function bump(scopes: CounterScope[], changedAt: string) {
  const db = getFirestore();
  await Promise.all(scopes.map(async ({ schoolId, schoolYearId }) => {
    // Sans année dans le document (répartition en attente) : l'année active de l'école.
    const yearId = schoolYearId ?? (await db.doc(`schools/${schoolId}`).get()).data()?.activeSchoolYearId;
    if (typeof yearId !== 'string' || !SAFE_ID.test(yearId)) return;
    await db.doc(`feeAllocationChangeCounters/${changeCounterId(schoolId, yearId)}`).set(
      { schoolId, schoolYearId: yearId, count: FieldValue.increment(1), changedAt }, { merge: true });
  }));
}

function counted(document: string) {
  return onDocumentWritten({ document, region: 'europe-west1', maxInstances: 5, retry: false }, async (event) => {
    const scopes = counterScopes(event.data?.before.data(), event.data?.after.data(), String(event.params.id ?? ''));
    if (scopes.length) await bump(scopes, event.time);
  });
}

export const onAllocationCashChanged = counted('financialCashLocks/{id}');
export const onAllocationEvidenceChanged = counted('feeAllocationEvidenceRevisions/{id}');
export const onAllocationStateChanged = counted('feeAllocationStates/{id}');
export const onAllocationCatalogChanged = counted('feeAllocationRubricCatalogs/{id}');
export const onAllocationSharesChanged = counted('feeAllocationShares/{id}');
export const onAllocationPendingChanged = counted('feeAllocationPending/{id}');
export const onAllocationForecastSignalChanged = counted('feeAllocationForecastSignals/{id}');
