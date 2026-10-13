import { createHash } from "node:crypto";
import { FinancialApiError } from "./financialTransactions.js";
import { AUDIT_EVENT_TYPES, buildServerAudit } from "./serverAudit.js";
import { payrollWritesSuspended } from "./payrollRollbackMode.js";
import { FieldValue } from "firebase-admin/firestore";
import { protectCashMutation, readCashBalance } from "./cashBalance.js";

const STAFF_ROLES = new Set(["school_admin", "cashier", "discipline_director", "study_director", "secretary", "teacher"]);
const WRITE_KEYS = new Set(["action", "schoolYearId", "beneficiaryId", "kind", "periodMonth", "periodYear", "paidAt", "amount", "recoveries", "deduction", "deductionReason", "cnss", "tax", "description", "clientRequestId"]);

function invalid(message, code = "invalid-argument", status = 400) { throw new FinancialApiError(status, code, message); }
function field(value, max = 200) { return typeof value === "string" && value.trim().length <= max ? value.trim() : ""; }
function cents(value, allowZero = false) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || !allowZero && amount === 0 || amount > 1_000_000_000 || Math.abs(Math.round(amount * 100) - amount * 100) > 1e-7) invalid("Montant invalide ou précision supérieure à deux décimales.");
  return Math.round(amount * 100);
}
function hashRequest(caller, requestId) {
  if (!/^[\w-]{12,100}$/.test(field(requestId, 100))) invalid("Clé d'idempotence invalide.");
  return createHash("sha256").update(`${caller.uid}:${caller.schoolId}:personnel:${requestId}`).digest("hex");
}
function assertDate(value) {
  const date = field(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00.000Z`).getTime()) || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) invalid("Date réelle du paiement invalide.");
  return date;
}
function assertReader(caller) {
  if (!caller?.uid || !caller.schoolId || !STAFF_ROLES.has(caller.role)) invalid("Accès aux paiements du personnel interdit.", "permission-denied", 403);
}
function eligibleForOrdinaryPayment(personnel) {
  return personnel.active !== false && personnel.disabled !== true && !personnel.archivedAt
    && !["inactive", "archived", "disabled"].includes(personnel.status);
}
async function readBeneficiary(reader, db, schoolId, beneficiaryId, requireActive = false) {
  if (!/^[\w-]{1,180}$/.test(beneficiaryId)) invalid("Bénéficiaire invalide.");
  const refs = [db.doc(`users/${beneficiaryId}`), db.doc(`personnelProfiles/${beneficiaryId}`)];
  const [user, service] = await Promise.all(refs.map((ref) => reader ? reader.get(ref) : ref.get()));
  if (user.exists && STAFF_ROLES.has(user.data()?.role) && user.data()?.schoolId === schoolId) {
    if (requireActive && !eligibleForOrdinaryPayment(user.data())) invalid("Personnel inactif : nouveau paiement interdit.", "failed-precondition", 409);
    return { id: beneficiaryId, name: field(user.data().name, 200), jobTitle: field(user.data().role, 100), hasAccount: true };
  }
  if (service.exists && service.data()?.kind === "service" && service.data()?.schoolId === schoolId) {
    if (requireActive && !eligibleForOrdinaryPayment(service.data())) invalid("Personnel inactif : nouveau paiement interdit.", "failed-precondition", 409);
    return { id: beneficiaryId, name: field(service.data().name, 200), jobTitle: field(service.data().jobTitle, 100), hasAccount: false };
  }
  invalid("Personnel introuvable dans cet établissement.", "not-found", 404);
}

export async function listPayroll({ db, caller, body }) {
  assertReader(caller);
  const action = field(body.action, 80);
  if (action === "list-payroll-cash-balance") {
    if (caller.role !== "cashier") invalid("Opération réservée au Caissier.", "permission-denied", 403);
    const schoolYearId = field(body.schoolYearId, 150);
    if (!/^[\w-]{1,150}$/.test(schoolYearId)) invalid("Année scolaire invalide.");
    return db.runTransaction(async (transaction) => {
      const [school, year, actor] = await Promise.all([
        transaction.get(db.doc(`schools/${caller.schoolId}`)), transaction.get(db.doc(`schoolYears/${schoolYearId}`)), transaction.get(db.doc(`users/${caller.uid}`)),
      ]);
      if (!school.exists || ["inactive", "deleting", "suspended"].includes(school.data()?.status)
        || !year.exists || year.data()?.schoolId !== caller.schoolId || year.data()?.status === "archived") invalid("Caisse indisponible.", "failed-precondition", 409);
      if (!actor.exists || actor.data()?.role !== "cashier" || actor.data()?.schoolId !== caller.schoolId || actor.data()?.status === "inactive" || actor.data()?.active === false) invalid("Caissier non autorisé.", "permission-denied", 403);
      const currency = year.data()?.currency === "CDF" || year.data()?.currency === "USD" ? year.data().currency : school.data()?.currency === "CDF" ? "CDF" : "USD";
      return readCashBalance({ db, reader: transaction, schoolId: caller.schoolId, schoolYearId, currency, yearCurrency: currency });
    });
  }
  if (action === "list-payroll-personnel") {
    if (caller.role !== "cashier") invalid("Opération réservée au Caissier.", "permission-denied", 403);
    const [users, service] = await Promise.all([
      db.collection("users").where("schoolId", "==", caller.schoolId).get(),
      db.collection("personnelProfiles").where("schoolId", "==", caller.schoolId).get(),
    ]);
    return { personnel: [
      ...users.docs.filter((item) => STAFF_ROLES.has(item.data().role) && eligibleForOrdinaryPayment(item.data())).map((item) => ({ id: item.id, name: field(item.data().name, 200), jobTitle: item.data().role, hasAccount: true })),
      ...service.docs.filter((item) => item.data().kind === "service" && eligibleForOrdinaryPayment(item.data())).map((item) => ({ id: item.id, name: field(item.data().name, 200), jobTitle: field(item.data().jobTitle, 100), hasAccount: false })),
    ].sort((a, b) => a.name.localeCompare(b.name, "fr")) };
  }
  const beneficiaryId = action === "list-own-payroll" ? caller.uid : field(body.beneficiaryId, 180);
  if (action !== "list-own-payroll" && caller.role !== "cashier" && caller.role !== "school_admin") invalid("Consultation interdite.", "permission-denied", 403);
  if (!beneficiaryId) invalid("Bénéficiaire requis.");
  if (action !== "list-own-payroll") await readBeneficiary(null, db, caller.schoolId, beneficiaryId);
  const snapshot = await db.collection("personnelPayments").where("beneficiaryId", "==", beneficiaryId).get();
  const items = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => item.schoolId === caller.schoolId);
  if (action === "list-payroll-advances") return { advances: items.filter((item) => item.kind === "advance" && item.amount > item.recoveredAmount).sort((a, b) => a.paidAt.localeCompare(b.paidAt)) };
  return { payments: (action === "list-own-payroll" ? items.filter((item) => item.kind === "salary" || item.kind === "bonus") : items).sort((a, b) => b.paidAt.localeCompare(a.paidAt)) };
}

export async function createPersonnelPayment({ db, caller, body, now = new Date().toISOString() }) {
  assertReader(caller);
  if (caller.role !== "cashier") invalid("Opération réservée au Caissier.", "permission-denied", 403);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !WRITE_KEYS.has(key))) invalid("Champs de paie non autorisés.");
  const kind = field(body.kind, 20);
  if (!["salary", "bonus", "advance"].includes(kind)) invalid("Nature du paiement invalide.");
  const schoolYearId = field(body.schoolYearId, 150);
  const beneficiaryId = field(body.beneficiaryId, 180);
  if (!/^[\w-]{1,150}$/.test(schoolYearId)) invalid("Année scolaire invalide.");
  const paidAt = assertDate(body.paidAt);
  const grossCents = cents(body.amount);
  const deductionCents = kind === "advance" ? 0 : cents(body.deduction ?? 0, true);
  const cnssCents = kind === "advance" ? 0 : cents(body.cnss ?? 0, true);
  const taxCents = kind === "advance" ? 0 : cents(body.tax ?? 0, true);
  const deductionReason = field(body.deductionReason, 500);
  const description = field(body.description, 1000);
  if (deductionCents > 0 && !deductionReason) invalid("Motif de retenue requis.");
  if (kind === "advance" && (body.recoveries?.length || Number(body.deduction ?? 0) || Number(body.cnss ?? 0) || Number(body.tax ?? 0))) invalid("Une avance ne peut pas comporter de retenues ou de récupérations.");
  const month = Number(body.periodMonth), year = Number(body.periodYear);
  if (kind !== "advance" && (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2200)) invalid("Période concernée invalide.");
  const recoveries = kind === "advance" ? [] : body.recoveries ?? [];
  if (!Array.isArray(recoveries) || recoveries.length > 30 || recoveries.some((line) => !line || typeof line !== "object" || Object.keys(line).some((key) => !["advanceId", "amount"].includes(key)))) invalid("Récupérations invalides.");
  const ids = recoveries.map((line) => field(line.advanceId, 180));
  if (ids.some((id) => !/^[\w-]{1,180}$/.test(id)) || new Set(ids).size !== ids.length) invalid("Références d'avances invalides ou répétées.");
  const hash = hashRequest(caller, body.clientRequestId);
  const fingerprint = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const paymentRef = db.doc(`personnelPayments/payroll_${hash.slice(0, 32)}`);
  const expenseRef = db.doc(`expenses/expense_payroll_${hash.slice(0, 32)}`);
  const idempotencyRef = db.doc(`personnelPaymentIdempotency/${hash}`);
  return db.runTransaction(async (transaction) => {
    const [prior, school, schoolYear, actor] = await Promise.all([
      transaction.get(idempotencyRef), transaction.get(db.doc(`schools/${caller.schoolId}`)),
      transaction.get(db.doc(`schoolYears/${schoolYearId}`)), transaction.get(db.doc(`users/${caller.uid}`)),
    ]);
    if (prior.exists) {
      if (prior.data()?.fingerprint !== fingerprint) invalid("Clé d'idempotence réutilisée avec un contenu différent.", "conflict", 409);
      return { ...prior.data().result, idempotent: true };
    }
    if (!school.exists || ["inactive", "deleting", "suspended"].includes(school.data()?.status)) invalid("Établissement inactif.", "failed-precondition", 409);
    if (!schoolYear.exists || schoolYear.data()?.schoolId !== caller.schoolId || schoolYear.data()?.status === "archived") invalid("Année scolaire indisponible.", "failed-precondition", 409);
    if (!actor.exists || actor.data()?.role !== "cashier" || actor.data()?.schoolId !== caller.schoolId || actor.data()?.status === "inactive" || actor.data()?.active === false) invalid("Caissier non autorisé.", "permission-denied", 403);
    const beneficiary = await readBeneficiary(transaction, db, caller.schoolId, beneficiaryId, true);
    if (payrollWritesSuspended()) invalid("Nouveaux paiements du personnel temporairement suspendus.", "failed-precondition", 409);
    const currency = schoolYear.data()?.currency === "CDF" || schoolYear.data()?.currency === "USD" ? schoolYear.data().currency : school.data()?.currency === "CDF" ? "CDF" : "USD";
    const recoveryRefs = ids.map((id) => db.doc(`personnelPayments/${id}`));
    const recoverySnapshots = await Promise.all(recoveryRefs.map((ref) => transaction.get(ref)));
    const recoveryLines = recoverySnapshots.map((snapshot, index) => {
      const advance = snapshot.data();
      if (!snapshot.exists || advance?.kind !== "advance" || advance.schoolId !== caller.schoolId || advance.beneficiaryId !== beneficiaryId || advance.currency !== currency) invalid("Avance étrangère, introuvable ou de devise incompatible.", "conflict", 409);
      const recoveredCents = cents(recoveries[index].amount);
      const availableCents = cents(advance.amount) - cents(advance.recoveredAmount ?? 0, true);
      if (recoveredCents > availableCents) invalid("Récupération supérieure au solde de l'avance.", "conflict", 409);
      return { advanceId: snapshot.id, reference: advance.reference, paidAt: advance.paidAt, amount: recoveredCents / 100, recoveredCents, availableCents };
    });
    const recoveryCents = recoveryLines.reduce((total, line) => total + line.recoveredCents, 0);
    const netCents = grossCents - recoveryCents - deductionCents - cnssCents - taxCents;
    if (netCents <= 0) invalid("Déductions supérieures ou égales au montant payable.");
    await protectCashMutation({ db, transaction, schoolId: caller.schoolId, schoolYearId, currency, yearCurrency: currency, deltaCents: -netCents, now });
    const reference = `PAY-${hash.slice(0, 12).toUpperCase()}`;
    const payment = {
      id: paymentRef.id, schoolId: caller.schoolId, schoolYearId, beneficiaryId, beneficiaryName: beneficiary.name,
      beneficiaryJobTitle: beneficiary.jobTitle, beneficiaryHasAccount: beneficiary.hasAccount, kind,
      ...(kind !== "advance" ? { periodMonth: month, periodYear: year } : {}), paidAt, currency, reference,
      amount: grossCents / 100, recoveredAmount: kind === "advance" ? 0 : recoveryCents / 100,
      recoveries: recoveryLines.map(({ advanceId, reference: advanceReference, paidAt: advancePaidAt, amount }) => ({ advanceId, reference: advanceReference, paidAt: advancePaidAt, amount })),
      ...(kind === "advance" ? { recoveryHistory: [] } : {}),
      deduction: deductionCents / 100, deductionReason, cnss: cnssCents / 100, tax: taxCents / 100, netPaid: netCents / 100,
      description, expenseId: expenseRef.id, createdAt: now, createdBy: caller.uid,
    };
    const expense = {
      id: expenseRef.id, schoolId: caller.schoolId, schoolYearId, currency, amount: netCents / 100,
      category: kind === "salary" ? "Salaire" : "Autre",
      description: `${kind === "salary" ? "Salaire" : kind === "bonus" ? "Prime" : "Avance sur salaire"} — ${beneficiary.name}${description ? ` — ${description}` : ""}`,
      beneficiary: beneficiary.name, paymentMethod: "Paiement personnel", reference, spentAt: paidAt,
      createdAt: now, updatedAt: now, createdBy: caller.uid, updatedBy: caller.uid,
      cashierName: field(actor.data().name, 160), provenance: "personnel-payroll", personnelPaymentId: paymentRef.id,
    };
    transaction.create(paymentRef, payment);
    transaction.create(expenseRef, expense);
    const auditId = `audit_payroll_${hash.slice(0, 24)}`;
    transaction.create(db.doc(`auditLogs/${auditId}`), buildServerAudit({
      id: auditId, eventType: AUDIT_EVENT_TYPES.FINANCE_EXPENSE_CREATED,
      actor: { ...caller, name: field(actor.data().name, 160) }, schoolId: caller.schoolId, schoolYearId,
      resourceType: "personnelPayment", resourceId: paymentRef.id,
      metadata: { kind, beneficiaryId, gross: payment.amount, netPaid: payment.netPaid, recoveryCount: recoveryLines.length, reference },
    }));
    recoveryLines.forEach((line, index) => transaction.update(recoveryRefs[index], {
      recoveredAmount: (cents(recoverySnapshots[index].data().recoveredAmount ?? 0, true) + line.recoveredCents) / 100,
      recoveryHistory: [...(Array.isArray(recoverySnapshots[index].data().recoveryHistory) ? recoverySnapshots[index].data().recoveryHistory : []), { paymentId: paymentRef.id, reference, paidAt, amount: line.amount }],
      updatedAt: now,
    }));
    const result = { payment };
    transaction.create(idempotencyRef, { schoolId: caller.schoolId, userId: caller.uid, fingerprint, result, createdAt: now });
    return { ...result, idempotent: false };
  });
}

const CORRECTION_KEYS = new Set(["action", "paymentId", "amount", "deduction", "deductionReason", "cnss", "tax", "description", "paidAt", "periodMonth", "periodYear", "reason", "confirmation", "expectedUpdatedAt", "clientRequestId"]);
const CONFIRMATION = { salary: "MODIFIER CE SALAIRE", bonus: "MODIFIER CETTE PRIME", advance: "MODIFIER CETTE AVANCE" };

export async function updatePersonnelPayment({ db, caller, body, now = new Date().toISOString() }) {
  if (!caller?.uid || caller.role !== "school_admin" || !caller.schoolId) invalid("Modification réservée à l'Administrateur de l'établissement.", "permission-denied", 403);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !CORRECTION_KEYS.has(key))) invalid("Champs de correction non autorisés.");
  const paymentId = field(body.paymentId, 180);
  if (!/^[\w-]{1,180}$/.test(paymentId)) invalid("Paiement du personnel invalide.");
  const reason = field(body.reason, 500);
  if (!reason) invalid("Raison de modification obligatoire.");
  const nextCents = cents(body.amount);
  const hash = hashRequest(caller, body.clientRequestId);
  const fingerprint = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const paymentRef = db.doc(`personnelPayments/${paymentId}`);
  const idempotencyRef = db.doc(`personnelPaymentIdempotency/${hash}`);
  return db.runTransaction(async (transaction) => {
    const [prior, currentSnapshot, schoolSnapshot, actorSnapshot] = await Promise.all([
      transaction.get(idempotencyRef), transaction.get(paymentRef), transaction.get(db.doc(`schools/${caller.schoolId}`)), transaction.get(db.doc(`users/${caller.uid}`)),
    ]);
    if (prior.exists) {
      if (prior.data()?.fingerprint !== fingerprint) invalid("Clé d'idempotence réutilisée avec un contenu différent.", "conflict", 409);
      return { ...prior.data().result, idempotent: true };
    }
    const current = currentSnapshot.data();
    if (!currentSnapshot.exists) invalid("Paiement du personnel introuvable.", "not-found", 404);
    if (current.schoolId !== caller.schoolId) invalid("Paiement hors établissement.", "permission-denied", 403);
    if (body.confirmation !== CONFIRMATION[current.kind]) invalid(`Saisissez exactement ${CONFIRMATION[current.kind] ?? "la confirmation demandée"}.`);
    if (!field(body.expectedUpdatedAt, 80) || body.expectedUpdatedAt !== (current.updatedAt ?? current.createdAt)) invalid("Ce paiement a changé depuis son ouverture. Actualisez l'historique.", "conflict", 409);
    if (!schoolSnapshot.exists || ["inactive", "deleting", "suspended"].includes(schoolSnapshot.data()?.status)) invalid("Établissement inactif.", "failed-precondition", 409);
    const actor = actorSnapshot.data();
    if (!actorSnapshot.exists || actor?.role !== "school_admin" || actor.schoolId !== caller.schoolId || actor.status === "inactive" || actor.active === false) invalid("Administrateur non autorisé.", "permission-denied", 403);
    const yearSnapshot = await transaction.get(db.doc(`schoolYears/${current.schoolYearId}`));
    if (!yearSnapshot.exists || yearSnapshot.data()?.schoolId !== caller.schoolId || yearSnapshot.data()?.status === "archived") invalid("Année scolaire indisponible pour correction.", "failed-precondition", 409);
    const expenseRef = db.doc(`expenses/${current.expenseId}`);
    const expenseSnapshot = await transaction.get(expenseRef);
    const expense = expenseSnapshot.data();
    if (!expenseSnapshot.exists || expense?.personnelPaymentId !== paymentId || expense.schoolId !== caller.schoolId || expense.schoolYearId !== current.schoolYearId || cents(expense.amount) !== cents(current.netPaid)) {
      invalid("Dépense liée incohérente : correction bloquée.", "conflict", 409);
    }
    if (payrollWritesSuspended()) invalid("Modifications de paie temporairement suspendues.", "failed-precondition", 409);
    const oldCents = cents(current.amount);
    const deductionCents = cents(body.deduction ?? current.deduction ?? 0, true);
    const cnssCents = cents(body.cnss ?? current.cnss ?? 0, true);
    const taxCents = cents(body.tax ?? current.tax ?? 0, true);
    const deductionReason = field(body.deductionReason ?? current.deductionReason, 500);
    const description = field(body.description ?? current.description, 1000);
    const paidAt = body.paidAt === undefined ? current.paidAt : assertDate(body.paidAt);
    const periodMonth = body.periodMonth === undefined ? current.periodMonth : Number(body.periodMonth);
    const periodYear = body.periodYear === undefined ? current.periodYear : Number(body.periodYear);
    if (deductionCents > 0 && !deductionReason) invalid("Motif de retenue requis.");
    if (current.kind === "advance" && (deductionCents || cnssCents || taxCents || body.periodMonth !== undefined || body.periodYear !== undefined)) invalid("Une avance ne peut pas comporter de retenues ni de période.");
    if (current.kind !== "advance" && (!Number.isInteger(periodMonth) || periodMonth < 1 || periodMonth > 12 || !Number.isInteger(periodYear) || periodYear < 2000 || periodYear > 2200)) invalid("Période concernée invalide.");
    if (paidAt !== current.paidAt && expense.spentAt !== current.paidAt) invalid("Date de la dépense liée incohérente : correction bloquée.", "conflict", 409);
    const oldExpenseDescription = `${current.kind === "salary" ? "Salaire" : current.kind === "bonus" ? "Prime" : "Avance sur salaire"} — ${current.beneficiaryName}${current.description ? ` — ${current.description}` : ""}`;
    if (description !== current.description && expense.description !== oldExpenseDescription) invalid("Description de la dépense liée incohérente : correction bloquée.", "conflict", 409);
    const recoveredCents = cents(current.recoveredAmount ?? 0, true);
    if (current.kind === "advance" && nextCents < recoveredCents) invalid("Cette avance est déjà imputée au-delà du nouveau montant.", "conflict", 409);
    const netCents = current.kind === "advance" ? nextCents : nextCents - recoveredCents - deductionCents - cnssCents - taxCents;
    if (netCents <= 0) invalid("Le nouveau montant ne couvre pas les retenues et avances récupérées.", "conflict", 409);
    const beneficiarySnapshot = current.beneficiaryHasAccount ? await transaction.get(db.doc(`users/${current.beneficiaryId}`)) : null;
    const beneficiary = beneficiarySnapshot?.data();
    const notify = beneficiarySnapshot?.exists && STAFF_ROLES.has(beneficiary?.role) && beneficiary.schoolId === caller.schoolId;
    const notificationId = `notif_payroll_edit_${hash.slice(0, 24)}`;
    const auditId = `audit_payroll_edit_${hash.slice(0, 24)}`;
    const payment = { ...current, id: paymentId, amount: nextCents / 100, deduction: deductionCents / 100, deductionReason, cnss: cnssCents / 100, tax: taxCents / 100, description, paidAt,
      ...(current.kind === "advance" ? {} : { periodMonth, periodYear }), netPaid: netCents / 100, updatedAt: now, updatedBy: caller.uid, correctionReason: reason };
    const yearCurrency = yearSnapshot.data()?.currency === "CDF" || yearSnapshot.data()?.currency === "USD" ? yearSnapshot.data().currency : schoolSnapshot.data()?.currency === "CDF" ? "CDF" : "USD";
    const currency = current.currency === "CDF" || current.currency === "USD" ? current.currency : yearCurrency;
    if (expense.currency && expense.currency !== currency || !expense.currency && currency !== yearCurrency) invalid("Devise de la dépense liée incohérente : correction bloquée.", "conflict", 409);
    await protectCashMutation({ db, transaction, schoolId: caller.schoolId, schoolYearId: current.schoolYearId, currency, yearCurrency, deltaCents: cents(current.netPaid) - netCents, now });
    transaction.update(paymentRef, { amount: payment.amount, deduction: payment.deduction, deductionReason, cnss: payment.cnss, tax: payment.tax, description, paidAt,
      ...(current.kind === "advance" ? {} : { periodMonth, periodYear }), netPaid: payment.netPaid, updatedAt: now, updatedBy: caller.uid, correctionReason: reason });
    transaction.update(expenseRef, { amount: payment.netPaid, spentAt: paidAt,
      ...(description !== current.description ? { description: `${current.kind === "salary" ? "Salaire" : current.kind === "bonus" ? "Prime" : "Avance sur salaire"} — ${current.beneficiaryName}${description ? ` — ${description}` : ""}` } : {}),
      updatedAt: now, updatedBy: caller.uid, correctionReason: reason });
    const kindLabel = current.kind === "salary" ? "salaire" : current.kind === "bonus" ? "prime" : "avance";
    if (notify) transaction.create(db.doc(`notifications/${notificationId}`), {
      id: notificationId, schoolId: caller.schoolId, schoolYearId: current.schoolYearId, recipientUserId: current.beneficiaryId,
      type: "financial_correction", module: "payments", event: "personnel_payment_corrected", destination: "/dashboard",
      title: `Modification de votre ${kindLabel}`,
      body: `Votre ${kindLabel} a été modifié.\nEffectuée par : ${field(actor.name, 160) || caller.uid}\nDate : ${now.slice(0, 10)}\nHeure : ${now.slice(11, 19)} UTC\nAncien montant : ${oldCents / 100} ${current.currency}\nNouveau montant : ${payment.amount} ${current.currency}\nAncien montant net : ${current.netPaid} ${current.currency}\nNouveau montant net : ${payment.netPaid} ${current.currency}\nRaison : ${reason}`,
      createdAt: now, read: false,
    });
    transaction.create(db.doc(`financialCorrectionAudits/${auditId}`), {
      id: auditId, operationId: paymentId, kind: current.kind, schoolId: caller.schoolId, schoolYearId: current.schoolYearId,
      actorId: caller.uid, actorName: field(actor.name, 160) || caller.uid, createdAt: now, serverTimestamp: FieldValue.serverTimestamp(),
      reason, oldValues: current, newValues: payment, oldAmount: oldCents / 100, newAmount: payment.amount,
      currency: current.currency, notificationEventId: notify ? notificationId : null,
    });
    transaction.create(db.doc(`auditLogs/${auditId}`), buildServerAudit({
      id: auditId, eventType: AUDIT_EVENT_TYPES.FINANCE_PAYMENT_UPDATED, actor: { ...caller, name: field(actor.name, 160) },
      schoolId: caller.schoolId, schoolYearId: current.schoolYearId, resourceType: "personnelPayment", resourceId: paymentId,
      metadata: { reason, kind: current.kind, oldAmount: oldCents / 100, newAmount: payment.amount, oldNetPaid: current.netPaid, newNetPaid: payment.netPaid,
        oldCnss: current.cnss, newCnss: payment.cnss, oldTax: current.tax, newTax: payment.tax, oldDeduction: current.deduction, newDeduction: payment.deduction,
        notificationEventId: notify ? notificationId : "" },
    }));
    const result = { payment };
    transaction.create(idempotencyRef, { schoolId: caller.schoolId, userId: caller.uid, fingerprint, result, createdAt: now });
    return { ...result, idempotent: false };
  });
}
