import { createHash } from "node:crypto";
import { FinancialApiError } from "./financialTransactions.js";
import { AUDIT_EVENT_TYPES, buildServerAudit } from "./serverAudit.js";

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
async function readBeneficiary(reader, db, schoolId, beneficiaryId) {
  if (!/^[\w-]{1,180}$/.test(beneficiaryId)) invalid("Bénéficiaire invalide.");
  const refs = [db.doc(`users/${beneficiaryId}`), db.doc(`personnelProfiles/${beneficiaryId}`)];
  const [user, service] = await Promise.all(refs.map((ref) => reader ? reader.get(ref) : ref.get()));
  if (user.exists && STAFF_ROLES.has(user.data()?.role) && user.data()?.schoolId === schoolId) return { id: beneficiaryId, name: field(user.data().name, 200), jobTitle: field(user.data().role, 100), hasAccount: true };
  if (service.exists && service.data()?.kind === "service" && service.data()?.schoolId === schoolId) return { id: beneficiaryId, name: field(service.data().name, 200), jobTitle: field(service.data().jobTitle, 100), hasAccount: false };
  invalid("Personnel introuvable dans cet établissement.", "not-found", 404);
}

export async function listPayroll({ db, caller, body }) {
  assertReader(caller);
  const action = field(body.action, 80);
  if (action === "list-payroll-personnel") {
    if (caller.role !== "cashier") invalid("Opération réservée au Caissier.", "permission-denied", 403);
    const [users, service] = await Promise.all([
      db.collection("users").where("schoolId", "==", caller.schoolId).get(),
      db.collection("personnelProfiles").where("schoolId", "==", caller.schoolId).get(),
    ]);
    return { personnel: [
      ...users.docs.filter((item) => STAFF_ROLES.has(item.data().role) && item.data().status !== "inactive" && item.data().active !== false).map((item) => ({ id: item.id, name: field(item.data().name, 200), jobTitle: item.data().role, hasAccount: true })),
      ...service.docs.filter((item) => item.data().kind === "service" && item.data().status !== "inactive").map((item) => ({ id: item.id, name: field(item.data().name, 200), jobTitle: field(item.data().jobTitle, 100), hasAccount: false })),
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
    const beneficiary = await readBeneficiary(transaction, db, caller.schoolId, beneficiaryId);
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
      id: expenseRef.id, schoolId: caller.schoolId, schoolYearId, amount: netCents / 100,
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
