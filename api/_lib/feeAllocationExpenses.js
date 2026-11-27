import { toMoneyMinor } from "./money.js";
import { assertFeeAllocationMovement, parseArrearsRubricKey } from "./feeAllocationMath.js";
import { allocationBalanceId, allocationFail as fail, allocationHash as hash, allocationIdentifier as id,
  allocationMinor as minor, readOperationalAllocation } from "./feeAllocationRuntime.js";
import { SUB_UNALLOCATED, isSubRubricId, subRubricBalanceView, validateSubRubrics } from "./feeAllocationSubRubrics.js";

// Lots 5 et 6 : la sous-rubrique n'entre dans l'empreinte que si elle existe (empreintes des anciennes dépenses inchangées).
const digest = e => hash([e.id, e.schoolId, e.schoolYearId, e.currency, e.amount, e.createdAt, e.updatedAt, e.allocationRubricId ?? null, e.personnelPaymentId ?? null,
  ...(e.allocationSubRubricId !== undefined ? [e.allocationSubRubricId] : [])]);

/** Reads only; its closure must run after the existing cash check, in the SAME transaction. */
export async function prepareFeeAllocationExpense({ db, transaction, caller, expense, previous = null, requestId, now }) {
  const source = expense ?? previous;
  const state = await readOperationalAllocation({ db, transaction, schoolId: source.schoolId, schoolYearId: source.schoolYearId, currency: source.currency, now });
  if (!state) {
    if (expense?.allocationRubricId !== undefined || expense?.allocationSubRubricId !== undefined) fail("Aucune répartition active pour cette dépense.");
    return () => {};
  }
  // Lot 27a : la pause n'existe plus ; un ancien état « PAUSED » est traité comme actif.
  if (caller.schoolId !== source.schoolId || !["school_admin", "admin", "cashier"].includes(caller.role)
    || ![source.id, requestId].every(id) || !["financial-api", "personnel-payroll"].includes(source.provenance)) fail("Source de décaissement non autorisée.", "permission-denied", 403);
  const rubricId = previous?.allocationRubricId ?? expense?.allocationRubricId;
  const catalogMarker = await transaction.get(db.doc(`feeAllocationRubricCatalogs/${source.schoolId}__${source.schoolYearId}`));
  if (!id(rubricId)) fail("Sélectionnez une rubrique active de cet établissement.");
  // Lot 27c-3a : une ligne d'arriéré est choisie par son identifiant ; elle doit exister avec un solde (vérifié plus bas).
  const arrearsLine = parseArrearsRubricKey(rubricId);
  let catalogEntry = null;
  if (rubricId !== "UNALLOCATED" && !arrearsLine) {
    if (catalogMarker.exists) {
      // Lot 27b : liste des rubriques de l'école et de l'année ; masquée = refusée pour une nouvelle dépense seulement.
      const entry = (await transaction.get(db.doc(`feeAllocationRubrics/${rubricId}`))).data();
      if (!entry || entry.schoolId !== source.schoolId || entry.schoolYearId !== source.schoolYearId || (entry.hidden && !previous)) fail("Sélectionnez une rubrique active de cet établissement.");
      catalogEntry = entry;
    } else if (!state.rubrics.some(r => r.id === rubricId && r.active !== false)) fail("Sélectionnez une rubrique active de cet établissement.");
  }
  if (previous && expense && ["id", "schoolId", "schoolYearId", "currency", "createdAt", "personnelPaymentId", "allocationRubricId", "allocationSubRubricId"].some(k => previous[k] !== expense[k])) fail("Réaffectation de dépense interdite sans rapprochement.");
  // Lots 5 et 6 : une rubrique qui a des sous-rubriques exige une sous-rubrique pour une nouvelle sortie d'argent ;
  // une modification ou une annulation reprend celle d'origine (une ancienne dépense sans sous-rubrique compte dans « Non affecté (rubrique) »).
  const subRubrics = Array.isArray(catalogEntry?.subRubrics) && catalogEntry.subRubrics.length
    ? validateSubRubrics(catalogEntry.subRubrics, { newId: () => fail("Sous-rubrique enregistrée sans identifiant.") }) : [];
  const chosenSub = previous ? previous.allocationSubRubricId : expense?.allocationSubRubricId;
  if (chosenSub !== undefined && (!subRubrics.length || (chosenSub !== SUB_UNALLOCATED && !(isSubRubricId(chosenSub) && subRubrics.some(s => s.id === chosenSub))))) fail("Sous-rubrique inconnue pour cette rubrique.");
  if (!previous && subRubrics.length && chosenSub === undefined) fail("Choisissez la sous-rubrique.");
  const subId = subRubrics.length ? chosenSub ?? SUB_UNALLOCATED : null;
  const sourceRef = db.doc(`feeAllocationRequests/expense_${hash([source.schoolId, source.id])}`);
  const balanceRef = db.doc(`feeAllocationBalances/${allocationBalanceId(source.schoolId, source.schoolYearId, source.currency, rubricId)}`);
  const movementId = `expense_${hash([source.schoolId, source.id, requestId])}`;
  const movementRef = db.doc(`feeAllocationMovements/${movementId}`);
  const [priorSnap, balanceSnap, movementSnap] = await Promise.all([transaction.get(sourceRef), transaction.get(balanceRef), transaction.get(movementRef)]);
  const prior = priorSnap.data(), balance = balanceSnap.data();
  if (movementSnap.exists || !previous && prior || previous && (!prior || prior.sourceDigest !== digest(previous))) fail("Dépense déjà imputée ou historique à rapprocher.");
  // Lot 27b : une rubrique du catalogue qui n'a encore rien reçu a un disponible nul.
  if (!balance && expense && !previous) fail("Solde disponible de la rubrique insuffisant.", "allocation-insufficient-funds");
  if (!balance || balance.schoolId !== source.schoolId || balance.collectionSchoolYearId !== source.schoolYearId
    || balance.currency !== source.currency || balance.rubricId !== rubricId || (arrearsLine && balance.arrearsOf?.originSchoolYearId !== arrearsLine.originSchoolYearId)
    || ![balance.openingMinor ?? 0, balance.receivedMinor, balance.spentMinor, balance.reservedMinor].every(minor)) fail("Solde de rubrique introuvable ou incohérent.");
  const delta = (expense ? toMoneyMinor(expense.amount) : 0) - (previous ? toMoneyMinor(previous.amount) : 0);
  const spentMinor = balance.spentMinor + delta;
  const availableMinor = (balance.openingMinor ?? 0) + balance.receivedMinor - spentMinor - balance.reservedMinor;
  if (!minor(spentMinor) || !minor(availableMinor)) fail("Solde disponible de la rubrique insuffisant.", "allocation-insufficient-funds");
  // Lots 5 et 6 : une hausse est aussi limitée au solde de la sous-rubrique ; une baisse est toujours acceptée.
  if (subId && delta > 0) {
    const after = subRubricBalanceView({ ...balance, spentMinor, subBalances: subId === SUB_UNALLOCATED ? balance.subBalances
      : { ...balance.subBalances, [subId]: { ...(balance.subBalances?.[subId] ?? {}), spentMinor: (balance.subBalances?.[subId]?.spentMinor ?? 0) + delta } } }, subRubrics, catalogEntry.name);
    const row = after.find(r => r.id === subId);
    if (row.availableMinor < 0) fail(`Solde insuffisant sur « ${row.name} » : disponible ${((row.availableMinor + delta) / 100).toFixed(2).replace(".", ",")} ${source.currency}. Rien n'a été enregistré.`, "allocation-insufficient-funds");
  }
  const movement = assertFeeAllocationMovement({ id: movementId, schoolId: source.schoolId, originSchoolYearId: source.schoolYearId,
    collectionSchoolYearId: source.schoolYearId, currency: source.currency, sourceType: "expense", sourceId: source.id,
    sourceRevision: requestId, configVersionId: null, amountMinor: -delta, lines: [{ rubricId, amountMinor: -delta }],
    postedAt: now, collectedAt: source.createdAt, actorId: caller.uid, type: previous ? expense ? "correction" : "reversal" : "expense",
    reversesMovementId: prior?.lastMovementId ?? null, ...(subId ? { subLines: [{ rubricId, subRubricId: subId, amountMinor: -delta }] } : {}),
    sourceSnapshot: { ...source }, testOnly: state.testOnly });
  return () => {
    transaction.create(movementRef, movement);
    transaction.set(sourceRef, { schoolId: source.schoolId, sourceId: source.id, sourceDigest: expense ? digest(expense) : null,
      lastMovementId: movementId, deleted: !expense, updatedAt: now });
    transaction.update(balanceRef, { spentMinor, availableMinor, updatedAt: now,
      ...(subId && subId !== SUB_UNALLOCATED ? { subBalances: { ...(balance.subBalances ?? {}), [subId]: { receivedMinor: balance.subBalances?.[subId]?.receivedMinor ?? 0, spentMinor: (balance.subBalances?.[subId]?.spentMinor ?? 0) + delta } } } : {}) });
  };
}
