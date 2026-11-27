// Lot E du caissier : changement de classe d'un élève qui a déjà payé, en UNE transaction.
// - Seul le caissier l'effectue (contrôlé avant, dans authorizeFinancialCaller).
// - Les paiements de l'année sont rattachés aux frais de la nouvelle classe (même nom d'abord), coupés si besoin.
// - Répartition : rien n'est réécrit ni effacé. Chaque paiement déjà réparti reçoit une écriture inverse
//   « reassignment-out » sur l'ancien frais, puis une écriture « reassignment-in » sur le nouveau.
// - Aucun mouvement de caisse : l'argent reste en caisse, seul son frais change.
// - Réduction, répartition en attente ou rubrique déjà dépensée : refus, rien n'est enregistré.
// - Lot F : un trop-perçu est remboursé en espèces dans la même opération (phrase « REMBOURSER »).
//   La part remboursée reste sur l'ancien frais (marquée « remboursée ») ; la sortie de caisse « Remboursement élève »
//   est prise dans « Non affecté » si la répartition est active (s'il ne suffit pas : refus total, montant manquant affiché).
import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { CLASS_CHANGE_SOCIAL_CASE_MESSAGE, isClassChange } from "../../src/utils/classChangeGuard.js";
import { planClassChangePayments } from "../../src/utils/classChangePlan.js";
import { fromMoneyMinor, toMoneyMinor } from "./money.js";
import { feeAllocationPaymentRequestId, feeAllocationStateId, prepareFeeAllocationReceipt } from "./feeAllocationReceipts.js";
import { pendingAllocationId } from "./feeAllocationPending.js";
import { validClassReferences } from "./manualStudentSave.js";
import { requiredStudentSection } from "./studentSection.js";
import { buildStudentChangeLog, summarizeStudentChanges } from "./studentChangeLog.js";
import { AUDIT_EVENT_TYPES, buildServerAudit } from "./serverAudit.js";
import { createTransactionOverlay } from "./transactionOverlay.js";
import { prepareFeeAllocationExpense } from "./feeAllocationExpenses.js";
import { CashBalanceError, protectCashMutation } from "./cashBalance.js";
import { UNALLOCATED_RUBRIC_ID } from "./feeAllocationMath.js";

export const CLASS_CHANGE_KEYS = ["action", "schoolYearId", "studentId", "className", "classId", "subClassId", "classOptionKey", "section", "option", "expectedUpdatedAt", "clientRequestId", "refund"];
/** Lot F : modes de remboursement acceptés (liste unique, partagée avec l'écran). */
export const REFUND_METHODS = Object.freeze({ cash: "Espèces" });
export const REFUND_CONFIRMATION = "REMBOURSER";
export const REFUND_CATEGORY = "Remboursement élève";
const CLASS_FIELDS = ["className", "classId", "subClassId", "classOptionKey", "section", "option"];
const MAX_PAYMENTS = 60;
const sha = (value) => createHash("sha256").update(value).digest("hex");

const money = (minor, currency) => {
  const value = fromMoneyMinor(minor).toFixed(2).replace(".", ",");
  return currency === "CDF" ? `${value} FC` : `${value} $`;
};

export async function changeStudentClass(transaction, db, caller, body, hash, now, helpers) {
  const { FinancialApiError, assertAllowedKeys, assertContext, recordedMinor, text, feeAppliesToHistoricalStudent } = helpers;
  const refuse = (status, code, message) => { throw new FinancialApiError(status, code, message); };
  assertAllowedKeys(body, CLASS_CHANGE_KEYS);
  const studentId = text(body.studentId, 160);
  const className = text(body.className, 120);
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(studentId) || !className) refuse(400, "invalid-argument", "Élève et nouvelle classe requis.");
  for (const key of CLASS_FIELDS) if (body[key] !== undefined && (typeof body[key] !== "string" || body[key].length > 160)) refuse(400, "invalid-argument", "Classe invalide.");

  const { schoolYearId, year, school, currency, actorName } = await assertContext(transaction, db, caller, body.schoolYearId);
  if (year.status !== "active" || school.activeSchoolYearId !== schoolYearId) refuse(409, "failed-precondition", "Le changement de classe se fait seulement dans l'année scolaire active.");
  const studentRef = db.doc(`students/${studentId}`);
  const studentSnapshot = await transaction.get(studentRef);
  const student = studentSnapshot.data();
  if (!studentSnapshot.exists || student.schoolId !== caller.schoolId || student.schoolYearId !== schoolYearId || student.status !== "ACTIVE" || student.deletedAt) {
    refuse(404, "not-found", "Élève introuvable dans cette année.");
  }
  const version = student.updatedAt ?? student.createdAt ?? "";
  if (text(body.expectedUpdatedAt, 80) !== version) refuse(409, "conflict", "La fiche de l'élève a changé depuis son ouverture. Fermez-la et rouvrez-la avant de recommencer.");

  const next = { ...student };
  for (const key of CLASS_FIELDS) {
    const value = text(body[key], 160);
    if (value) next[key] = value; else delete next[key];
  }
  if (!isClassChange(student, next)) refuse(400, "invalid-argument", "La classe ne change pas.");
  // Section obligatoire : calculée d'après la nouvelle classe si elle manque, refusée si inconnue.
  try { next.section = requiredStudentSection(next); }
  catch (error) { refuse(error.statusCode ?? 400, error.code ?? "invalid-argument", error.message); }
  try { await validClassReferences(transaction, db, { ...next, id: studentId }); }
  catch (error) { refuse(error.statusCode ?? 400, error.code ?? "invalid-argument", error.message); }

  // Réduction ou prise en charge liée aux frais de l'année : à revoir d'abord par l'administrateur.
  const socialCase = Object.values(student.financialSupport ?? {}).some((decision) => decision?.schoolYearId === schoolYearId
    && Object.values(decision.lines ?? {}).some((line) => (line?.reductionMinor ?? 0) > 0));
  if (socialCase) refuse(409, "failed-precondition", CLASS_CHANGE_SOCIAL_CASE_MESSAGE);

  const [paymentsSnapshot, feesSnapshot, stateSnapshot] = await Promise.all([
    transaction.get(db.collection("payments").where("studentId", "==", studentId)),
    transaction.get(db.collection("feeTypes").where("schoolId", "==", caller.schoolId).where("schoolYearId", "==", schoolYearId)),
    transaction.get(db.doc(`feeAllocationStates/${feeAllocationStateId(caller.schoolId, schoolYearId, currency)}`)),
  ]);
  // Paiements de l'année, encaissés cette année (les arriérés d'années passées ne bougent pas).
  const payments = paymentsSnapshot.docs.map((document) => ({ ...document.data(), id: document.id }))
    .filter((payment) => payment.schoolId === caller.schoolId && payment.schoolYearId === schoolYearId
      && (payment.collectionSchoolYearId ?? schoolYearId) === schoolYearId && payment.formerStudent !== true
      // Lot F : une part déjà remboursée au parent n'est plus de l'argent de l'élève ; elle ne se rattache jamais.
      && !payment.refundedByClassChangeId);
  if (payments.length > MAX_PAYMENTS) refuse(409, "failed-precondition", `Cet élève a plus de ${MAX_PAYMENTS} paiements cette année : contactez l'assistance.`);
  if (payments.some((payment) => payment.supportDecisionId)) refuse(409, "failed-precondition", "Un ancien paiement par un tiers doit d'abord être rapproché.");
  if (payments.some((payment) => payment.currency !== currency)) refuse(409, "currency-reconciliation-required", "Un paiement a une autre devise que l'année : changement de classe bloqué.");
  const state = stateSnapshot.data();
  if (state?.status === "EN_PREPARATION" && payments.length) {
    refuse(409, "failed-precondition", "La répartition de l'école est en cours de mise en route : terminez son activation avant de changer la classe d'un élève qui a payé.");
  }
  const pendings = await Promise.all(payments.map((payment) => transaction.get(db.doc(`feeAllocationPending/${pendingAllocationId(caller.schoolId, payment.id)}`))));
  if (pendings.some((snapshot) => snapshot.exists && snapshot.data()?.status === "pending")) {
    refuse(409, "failed-precondition", "Un paiement de cet élève attend encore sa répartition. Réessayez dans quelques minutes.");
  }

  const fees = feesSnapshot.docs.map((document) => ({ ...document.data(), id: document.id }))
    .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")) || String(a.name ?? "").localeCompare(String(b.name ?? ""), "fr") || a.id.localeCompare(b.id));
  const newFees = fees.filter((fee) => feeAppliesToHistoricalStudent(fee, next) && Number(fee.amount) > 0)
    .map((fee) => ({ id: fee.id, name: text(fee.name, 160), netMinor: toMoneyMinor(Number(fee.amount)) }));
  const plan = planClassChangePayments({
    payments: payments.map((payment) => ({ id: payment.id, feeTypeId: payment.feeTypeId, amountMinor: recordedMinor(payment.amount), createdAt: payment.createdAt })),
    oldFees: fees.map((fee) => ({ id: fee.id, name: text(fee.name, 160) })), newFees,
  });
  // Lot F : le trop-perçu est remboursé tout de suite, en espèces, avec une confirmation écrite.
  const refund = body.refund;
  if (plan.overpaidMinor > 0) {
    const asked = refund && typeof refund === "object" && !Array.isArray(refund) ? refund : null;
    let askedMinor = -1;
    try { askedMinor = asked ? toMoneyMinor(asked.amount) : -1; } catch { askedMinor = -1; }
    if (!asked || asked.confirmation !== REFUND_CONFIRMATION || !Object.hasOwn(REFUND_METHODS, asked.method) || askedMinor !== plan.overpaidMinor
      || Object.keys(asked).some((key) => !["amount", "method", "confirmation"].includes(key))) {
      refuse(409, "class-change-overpaid", `Ce changement de classe crée un trop-perçu de ${money(plan.overpaidMinor, currency)}. Confirmez son remboursement en espèces en tapant « ${REFUND_CONFIRMATION} ». Rien n'a été modifié.`);
    }
  } else if (refund !== undefined) refuse(400, "invalid-argument", "Aucun trop-perçu à rembourser pour ce changement de classe.");

  // Rattachement et répartition, dans le tampon (lectures puis écritures, cumul juste des rubriques).
  const classChangeId = `cc_${hash.slice(0, 32)}`;
  const overlay = createTransactionOverlay(transaction);
  const byId = new Map(payments.map((payment) => [payment.id, payment]));
  const operational = ["ACTIVE", "PAUSED"].includes(state?.status);
  const paymentWrites = [];
  const summary = [];
  for (const move of plan.moves) {
    const current = byId.get(move.paymentId);
    const allocated = operational && (await transaction.get(db.doc(`feeAllocationRequests/${feeAllocationPaymentRequestId(caller.schoolId, current.id)}`))).exists;
    // Option A : un paiement d'avant l'activation reste dans le solde de départ ; il change de frais sans mouvement de rubrique.
    if (operational && !allocated && !(Date.parse(current.createdAt) < Date.parse(state.cutoffAt))) {
      refuse(409, "allocation-reconciliation-required", "Un paiement de cet élève n'a pas de trace de répartition : rapprochement nécessaire avant le changement de classe.");
    }
    const history = [...(Array.isArray(current.classChangeHistory) ? current.classChangeHistory : []),
      { classChangeId, fromFeeTypeId: current.feeTypeId, fromAmount: current.amount, fromClassName: text(student.className, 120), toClassName: className, at: now, by: caller.uid }];
    // Lot F : avec un trop-perçu, le paiement d'origine reste sur l'ancien frais pour la part remboursée ;
    // toutes les parts rattachées deviennent de nouveaux paiements liés (même reçu, même date).
    const refunded = move.overpaidMinor > 0;
    const copy = Object.fromEntries(Object.entries(current).filter(([key]) => !["offlineProposal", "proposedAt", "correctionReason", "classChangeHistory"].includes(key)));
    const targets = move.pieces.map((piece, index) => {
      const own = index === 0 && !refunded;
      const id = own ? current.id : `pay_${sha(`${hash}\0${current.id}\0${index}`).slice(0, 24)}`;
      return { ...(own ? current : copy), id, feeTypeId: piece.feeTypeId, amount: fromMoneyMinor(piece.amountMinor), updatedAt: now, updatedBy: caller.uid,
        classChangeHistory: history, ...(own ? {} : { splitFromPaymentId: current.id }) };
    });
    const kept = refunded ? { ...current, amount: fromMoneyMinor(move.overpaidMinor), updatedAt: now, updatedBy: caller.uid, classChangeHistory: history,
      refundedAmount: fromMoneyMinor(move.overpaidMinor), refundedByClassChangeId: classChangeId } : null;
    if (allocated) {
      // Écriture inverse sur l'ancien frais : tout le paiement, ou seulement la part rattachée s'il y a un remboursement.
      const out = await prepareFeeAllocationReceipt({ db, transaction: overlay.transaction, caller, payment: kept, previous: current,
        requestId: `${hash.slice(0, 40)}-out-${sha(current.id).slice(0, 16)}`, now, reassignment: { kind: "out", classChangeId } });
      out();
      for (const target of targets) {
        const into = await prepareFeeAllocationReceipt({ db, transaction: overlay.transaction, caller, payment: target, previous: null,
          requestId: `${hash.slice(0, 40)}-in-${sha(target.id).slice(0, 16)}`, now, reassignment: { kind: "in", classChangeId } });
        into();
      }
    }
    if (kept) paymentWrites.push({ ref: db.doc(`payments/${current.id}`), data: kept, create: false });
    targets.forEach((target) => paymentWrites.push({ ref: db.doc(`payments/${target.id}`), data: target, create: target.id !== current.id }));
    summary.push({ paymentId: current.id, receiptNumber: current.receiptNumber ?? null, fromFeeTypeId: current.feeTypeId,
      pieces: targets.map((target) => ({ paymentId: target.id, feeTypeId: target.feeTypeId, amount: target.amount })),
      refundedAmount: kept ? kept.amount : 0, allocation: allocated ? "reassigned" : "unchanged" });
  }

  // Lot F : sortie de caisse « Remboursement élève », prise dans « Non affecté » quand la répartition est active.
  let refundExpense = null, refundCounter = null;
  if (plan.overpaidMinor > 0) {
    const counterRef = db.doc(`financialCounters/${caller.schoolId}_${schoolYearId}_refund`);
    const counter = (await transaction.get(counterRef)).data();
    const sequence = (Number.isSafeInteger(counter?.lastRefundNumber) ? counter.lastRefundNumber : 0) + 1;
    const prefix = `RMB-${String(year.name ?? "").match(/\d{4}/)?.[0] ?? now.slice(0, 4)}`;
    const studentName = [student.nom, student.postnom, student.prenom].map((value) => text(value, 120)).filter(Boolean).join(" ") || "Élève";
    const expenseId = `exp_rmb_${hash.slice(0, 24)}`;
    refundExpense = {
      id: expenseId, schoolId: caller.schoolId, schoolYearId, currency, amount: fromMoneyMinor(plan.overpaidMinor), category: REFUND_CATEGORY,
      description: `Remboursement du trop-perçu (changement de classe : ${text(student.className, 120)} → ${className})`,
      beneficiary: `${studentName} (parent ou tuteur)`, paymentMethod: REFUND_METHODS[body.refund.method], refundMethod: body.refund.method,
      receiptNumber: `${prefix}-${String(sequence).padStart(4, "0")}`, studentId, classChangeId,
      refundOfPaymentIds: plan.moves.filter((move) => move.overpaidMinor > 0).map((move) => move.paymentId),
      ...(operational ? { allocationRubricId: UNALLOCATED_RUBRIC_ID } : {}),
      spentAt: now.slice(0, 10), createdAt: now, updatedAt: now, createdBy: caller.uid, updatedBy: caller.uid, cashierName: actorName,
      provenance: "financial-api", clientRequestIdHash: hash,
    };
    try {
      const spend = await prepareFeeAllocationExpense({ db, transaction: overlay.transaction, caller, expense: refundExpense, requestId: hash, now });
      spend();
    } catch (error) {
      if (error?.code !== "allocation-insufficient-funds") throw error;
      const unallocated = overlay.known("feeAllocationBalances/").find((row) => row.rubricId === UNALLOCATED_RUBRIC_ID && row.schoolId === caller.schoolId);
      const availableMinor = unallocated ? (unallocated.openingMinor ?? 0) + unallocated.receivedMinor - unallocated.spentMinor - unallocated.reservedMinor : 0;
      refuse(409, "refund-unallocated-insufficient", `Le remboursement de ${money(plan.overpaidMinor, currency)} doit être pris dans la rubrique « Non affecté », qui n'a que ${money(Math.max(0, availableMinor), currency)} : il manque ${money(plan.overpaidMinor - Math.max(0, availableMinor), currency)}. Rien n'a été enregistré.`);
    }
    refundCounter = { ref: counterRef, value: { schoolId: caller.schoolId, schoolYearId, kind: "refund", lastRefundNumber: sequence, updatedAt: now } };
  }

  // Contrôle final des rubriques (net de toutes les écritures) : jamais sous l'argent déjà dépensé ou réservé.
  const rubricNames = new Map([[UNALLOCATED_RUBRIC_ID, "Non affecté"]]);
  for (const version of overlay.known("feeAllocationVersions/")) for (const rubric of version.rubrics ?? []) if (rubric?.id) rubricNames.set(rubric.id, text(rubric.name, 120) || "Rubrique");
  for (const { before, after } of overlay.changes("feeAllocationBalances/")) {
    if (!after) continue;
    const funds = (after.openingMinor ?? 0) + after.receivedMinor, used = after.spentMinor + after.reservedMinor;
    if (after.receivedMinor < (before?.receivedMinor ?? 0) && funds < used) {
      refuse(409, "allocation-already-spent", `La rubrique « ${rubricNames.get(after.rubricId) ?? "Rubrique"} » a déjà dépensé cet argent (il manque ${money(used - funds, currency)}). Le changement de classe est refusé ; rien n'a été modifié. L'administrateur doit d'abord régler la question.`);
    }
  }

  // Caisse : le remboursement sort de la caisse ; si elle ne suffit pas, tout est refusé (dernière lecture).
  if (refundExpense) {
    try {
      await protectCashMutation({ db, transaction, schoolId: caller.schoolId, schoolYearId, currency, yearCurrency: currency, deltaCents: -plan.overpaidMinor, now });
    } catch (error) {
      if (error instanceof CashBalanceError && error.code === "insufficient-funds") {
        refuse(409, "insufficient-funds", `Caisse insuffisante pour rembourser ${money(plan.overpaidMinor, currency)} : il manque ${money(error.details?.shortfallCents ?? plan.overpaidMinor, currency)}. Rien n'a été enregistré.`);
      }
      throw error;
    }
  }

  // Écritures (aucune lecture après ce point).
  overlay.flush();
  if (refundExpense) {
    transaction.create(db.doc(`expenses/${refundExpense.id}`), refundExpense);
    transaction.set(refundCounter.ref, refundCounter.value, { merge: true });
    const refundAuditId = `audit_fin_${hash.slice(0, 24)}`;
    transaction.set(db.doc(`auditLogs/${refundAuditId}`), buildServerAudit({ id: refundAuditId, eventType: AUDIT_EVENT_TYPES.FINANCE_EXPENSE_CREATED, actor: { ...caller, name: actorName },
      schoolId: caller.schoolId, schoolYearId, resourceType: "expense", resourceId: refundExpense.id, metadata: { category: REFUND_CATEGORY, amount: refundExpense.amount, receiptNumber: refundExpense.receiptNumber } }));
  }
  for (const write of paymentWrites) {
    if (write.create) transaction.create(write.ref, write.data);
    else transaction.set(write.ref, write.data);
  }
  const studentUpdate = { updatedAt: now };
  for (const key of CLASS_FIELDS) studentUpdate[key] = next[key] === undefined ? FieldValue.delete() : next[key];
  transaction.update(studentRef, studentUpdate);
  const saved = { ...next, id: studentId, updatedAt: now };
  const logId = `stu_${sha(`${caller.uid}\0${studentId}\0${now}\0${hash}`).slice(0, 32)}`;
  const changeLog = buildStudentChangeLog({ id: logId, actor: { uid: caller.uid, role: caller.role, name: actorName }, previous: student, student: saved, now });
  transaction.set(db.doc(`studentChangeLogs/${logId}`), { ...changeLog, classChangeId });
  const movedMinor = plan.moves.reduce((sum, move) => sum + move.pieces.reduce((n, piece) => n + piece.amountMinor, 0), 0);
  transaction.set(db.doc(`auditLogs/audit_${logId}`), buildServerAudit({ id: `audit_${logId}`, eventType: AUDIT_EVENT_TYPES.STUDENT_CLASS_CHANGED,
    actor: { ...caller, name: actorName }, schoolId: caller.schoolId, schoolYearId, resourceType: "student", resourceId: studentId,
    metadata: { matricule: student.matricule ?? "", student: changeLog.studentName, fields: changeLog.fields.join(", "),
      changes: `${summarizeStudentChanges(changeLog)} · ${plan.moves.length} paiement(s) rattaché(s) à la nouvelle classe (${money(movedMinor, currency)})`,
      classChangeId, movedPayments: plan.moves.length } }));
  // Pas de fiche complète dans la réponse : elle est gardée pour la reprise d'un double clic (taille limitée).
  return { classChange: { id: classChangeId, studentId, fromClassName: text(student.className, 120), toClassName: className, updatedAt: now, stays: plan.stays, moves: summary,
    ...(refundExpense ? { refund: { expenseId: refundExpense.id, receiptNumber: refundExpense.receiptNumber, amount: refundExpense.amount, currency, method: refundExpense.refundMethod, paymentMethod: refundExpense.paymentMethod, cashierName: actorName, createdAt: now } } : {}) } };
}
