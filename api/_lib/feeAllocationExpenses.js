import { toMoneyMinor } from "./money.js";
import { assertFeeAllocationMovement } from "./feeAllocationMath.js";
import { allocationBalanceId, allocationFail as fail, allocationHash as hash, allocationIdentifier as id,
  allocationMinor as minor, readOperationalAllocation } from "./feeAllocationRuntime.js";

const digest = e => hash([e.id, e.schoolId, e.schoolYearId, e.currency, e.amount, e.createdAt, e.updatedAt, e.allocationRubricId ?? null, e.personnelPaymentId ?? null]);

/** Reads only; its closure must run after the existing cash check, in the SAME transaction. */
export async function prepareFeeAllocationExpense({ db, transaction, caller, expense, previous = null, requestId, now }) {
  const source = expense ?? previous;
  const state = await readOperationalAllocation({ db, transaction, schoolId: source.schoolId, schoolYearId: source.schoolYearId, currency: source.currency, now });
  if (!state) {
    if (expense?.allocationRubricId !== undefined) fail("Aucune répartition active pour cette dépense.");
    return () => {};
  }
  if (state.status === "PAUSED") fail("Répartition en pause : conservez l'opération pour sa reprise.", "allocation-paused");
  if (caller.schoolId !== source.schoolId || !["school_admin", "admin", "cashier"].includes(caller.role)
    || ![source.id, requestId].every(id) || !["financial-api", "personnel-payroll"].includes(source.provenance)) fail("Source de décaissement non autorisée.", "permission-denied", 403);
  const rubricId = previous?.allocationRubricId ?? expense?.allocationRubricId;
  if (!id(rubricId) || rubricId !== "UNALLOCATED" && !state.rubrics.some(r => r.id === rubricId && r.active !== false)) fail("Sélectionnez une rubrique active de cet établissement.");
  if (previous && expense && ["id", "schoolId", "schoolYearId", "currency", "createdAt", "personnelPaymentId", "allocationRubricId"].some(k => previous[k] !== expense[k])) fail("Réaffectation de dépense interdite sans rapprochement.");
  const sourceRef = db.doc(`feeAllocationRequests/expense_${hash([source.schoolId, source.id])}`);
  const balanceRef = db.doc(`feeAllocationBalances/${allocationBalanceId(source.schoolId, source.schoolYearId, source.currency, rubricId)}`);
  const movementId = `expense_${hash([source.schoolId, source.id, requestId])}`;
  const movementRef = db.doc(`feeAllocationMovements/${movementId}`);
  const [priorSnap, balanceSnap, movementSnap] = await Promise.all([transaction.get(sourceRef), transaction.get(balanceRef), transaction.get(movementRef)]);
  const prior = priorSnap.data(), balance = balanceSnap.data();
  if (movementSnap.exists || !previous && prior || previous && (!prior || prior.sourceDigest !== digest(previous))) fail("Dépense déjà imputée ou historique à rapprocher.");
  if (!balance || balance.schoolId !== source.schoolId || balance.collectionSchoolYearId !== source.schoolYearId
    || balance.currency !== source.currency || balance.rubricId !== rubricId
    || ![balance.openingMinor ?? 0, balance.receivedMinor, balance.spentMinor, balance.reservedMinor].every(minor)) fail("Solde de rubrique introuvable ou incohérent.");
  const delta = (expense ? toMoneyMinor(expense.amount) : 0) - (previous ? toMoneyMinor(previous.amount) : 0);
  const spentMinor = balance.spentMinor + delta;
  const availableMinor = (balance.openingMinor ?? 0) + balance.receivedMinor - spentMinor - balance.reservedMinor;
  if (!minor(spentMinor) || !minor(availableMinor)) fail("Solde disponible de la rubrique insuffisant.", "allocation-insufficient-funds");
  const movement = assertFeeAllocationMovement({ id: movementId, schoolId: source.schoolId, originSchoolYearId: source.schoolYearId,
    collectionSchoolYearId: source.schoolYearId, currency: source.currency, sourceType: "expense", sourceId: source.id,
    sourceRevision: requestId, configVersionId: null, amountMinor: -delta, lines: [{ rubricId, amountMinor: -delta }],
    postedAt: now, collectedAt: source.createdAt, actorId: caller.uid, type: previous ? expense ? "correction" : "reversal" : "expense",
    reversesMovementId: prior?.lastMovementId ?? null, sourceSnapshot: { ...source }, testOnly: true });
  return () => {
    transaction.create(movementRef, movement);
    transaction.set(sourceRef, { schoolId: source.schoolId, sourceId: source.id, sourceDigest: expense ? digest(expense) : null,
      lastMovementId: movementId, deleted: !expense, updatedAt: now });
    transaction.update(balanceRef, { spentMinor, availableMinor, updatedAt: now });
  };
}
