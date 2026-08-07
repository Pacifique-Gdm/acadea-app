import { createHash } from "node:crypto";

const PAYMENT_CREATE_KEYS = ["action", "schoolYearId", "studentId", "feeTypeId", "amount", "clientRequestId"];
const EXPENSE_CREATE_KEYS = ["action", "schoolYearId", "amount", "category", "description", "beneficiary", "paymentMethod", "reference", "clientRequestId"];
const PAYMENT_UPDATE_KEYS = ["action", "transactionId", "amount", "reason", "clientRequestId"];
const EXPENSE_UPDATE_KEYS = ["action", "transactionId", "amount", "category", "description", "reason", "clientRequestId"];
const DELETE_KEYS = ["action", "transactionId", "reason", "clientRequestId"];
const EXPENSE_CATEGORIES = new Set(["Fournitures", "Transport", "Salaire", "Maintenance", "Autre", "Autres"]);

export class FinancialApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "FinancialApiError";
    this.status = status;
    this.code = code;
  }
}

function text(value, maxLength = 250) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length <= maxLength ? normalized : "";
}

function positiveAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) {
    throw new FinancialApiError(400, "invalid-argument", "Montant financier invalide.");
  }
  return Math.round(amount * 100) / 100;
}

function assertAllowedKeys(body, allowedKeys) {
  const unexpected = Object.keys(body).filter((key) => !allowedKeys.includes(key));
  if (unexpected.length > 0) {
    throw new FinancialApiError(400, "invalid-argument", "La requête contient des champs non autorisés.");
  }
}

function requestKey(callerUid, schoolId, clientRequestId) {
  const requestId = text(clientRequestId, 100);
  if (!/^[A-Za-z0-9_-]{12,100}$/.test(requestId)) {
    throw new FinancialApiError(400, "invalid-argument", "Clé d'idempotence invalide.");
  }
  return createHash("sha256").update(`${callerUid}:${schoolId}:${requestId}`).digest("hex");
}

function receiptSequence(receiptNumber) {
  const match = typeof receiptNumber === "string" ? receiptNumber.match(/(\d+)$/) : null;
  return match ? Number(match[1]) : 0;
}

function receiptPrefix(year) {
  const yearName = text(year.name, 40);
  const firstYear = yearName.match(/\d{4}/)?.[0] ?? new Date().getUTCFullYear().toString();
  return `REC-${firstYear}`;
}

function idempotentResult(snapshot) {
  if (!snapshot.exists) return null;
  const result = snapshot.data()?.result;
  if (!result || typeof result !== "object") {
    throw new FinancialApiError(409, "conflict", "Cette requête financière a déjà été traitée.");
  }
  return { ...result, idempotent: true };
}

function assertRole(caller, roles) {
  const normalizedRole = caller.role === "admin" ? "school_admin" : caller.role;
  if (!roles.includes(normalizedRole) || typeof caller.schoolId !== "string" || !caller.schoolId) {
    throw new FinancialApiError(403, "permission-denied", "Vous n'êtes pas autorisé à effectuer cette opération financière.");
  }
  return { ...caller, role: normalizedRole };
}

async function assertContext(transaction, db, caller, requestedYearId) {
  const schoolYearId = text(requestedYearId, 120);
  if (!schoolYearId) throw new FinancialApiError(400, "invalid-argument", "Année scolaire requise.");
  const [schoolSnapshot, yearSnapshot, userSnapshot] = await Promise.all([
    transaction.get(db.doc(`schools/${caller.schoolId}`)),
    transaction.get(db.doc(`schoolYears/${schoolYearId}`)),
    transaction.get(db.doc(`users/${caller.uid}`)),
  ]);
  if (!schoolSnapshot.exists || ["deleting", "inactive", "suspended"].includes(schoolSnapshot.data()?.status)) {
    throw new FinancialApiError(409, "failed-precondition", "L'établissement n'est pas actif.");
  }
  if (!yearSnapshot.exists || yearSnapshot.data()?.schoolId !== caller.schoolId) {
    throw new FinancialApiError(400, "invalid-argument", "Année scolaire invalide pour cet établissement.");
  }
  if (yearSnapshot.data()?.status === "archived") {
    throw new FinancialApiError(409, "failed-precondition", "Cette année scolaire est archivée en lecture seule.");
  }
  const profile = userSnapshot.data() ?? {};
  const profileRole = profile.role === "admin" ? "school_admin" : profile.role;
  if (!userSnapshot.exists || profile.schoolId !== caller.schoolId || profile.status === "inactive" || profileRole !== caller.role) {
    throw new FinancialApiError(403, "permission-denied", "Profil utilisateur financier invalide.");
  }
  return { schoolYearId, year: yearSnapshot.data(), actorName: text(profile.name, 160) || text(caller.email, 160) || "Utilisateur Acadéa" };
}

function serverAudit({ id, schoolId, schoolYearId, caller, actorName, action, details, createdAt }) {
  return { id, schoolId, schoolYearId, actorId: caller.uid, actorName, action, details, createdAt };
}

async function createPayment(transaction, db, caller, body, hash, now) {
  assertAllowedKeys(body, PAYMENT_CREATE_KEYS);
  const amount = positiveAmount(body.amount);
  const { schoolYearId, year, actorName } = await assertContext(transaction, db, caller, body.schoolYearId);
  const studentId = text(body.studentId, 120);
  const feeTypeId = text(body.feeTypeId, 120);
  if (!studentId || !feeTypeId) throw new FinancialApiError(400, "invalid-argument", "Élève et type de frais requis.");
  const studentRef = db.doc(`students/${studentId}`);
  const feeRef = db.doc(`feeTypes/${feeTypeId}`);
  const [studentSnapshot, feeSnapshot] = await Promise.all([transaction.get(studentRef), transaction.get(feeRef)]);
  const student = studentSnapshot.data() ?? {};
  const fee = feeSnapshot.data() ?? {};
  if (!studentSnapshot.exists || student.schoolId !== caller.schoolId || student.schoolYearId !== schoolYearId || student.status !== "ACTIVE") {
    throw new FinancialApiError(400, "invalid-argument", "Élève invalide pour cet établissement et cette année.");
  }
  if (!feeSnapshot.exists || fee.schoolId !== caller.schoolId || fee.schoolYearId !== schoolYearId || !Number.isFinite(Number(fee.amount)) || Number(fee.amount) <= 0) {
    throw new FinancialApiError(400, "invalid-argument", "Type de frais invalide pour cet établissement et cette année.");
  }
  const counterId = `${caller.schoolId}_${schoolYearId}_receipt`;
  const counterRef = db.doc(`financialCounters/${counterId}`);
  const counterSnapshot = await transaction.get(counterRef);
  let paymentsQuery = db.collection("payments")
    .where("schoolId", "==", caller.schoolId)
    .where("schoolYearId", "==", schoolYearId);
  if (counterSnapshot.exists) paymentsQuery = paymentsQuery.where("studentId", "==", studentId).where("feeTypeId", "==", feeTypeId);
  const paymentsSnapshot = await transaction.get(paymentsQuery);
  const matchingPayments = paymentsSnapshot.docs.map((document) => document.data());
  const alreadyPaid = matchingPayments
    .filter((payment) => payment.studentId === studentId && payment.feeTypeId === feeTypeId)
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  if (alreadyPaid + amount > Number(fee.amount)) {
    throw new FinancialApiError(409, "conflict", "Ce paiement dépasse le montant prévu pour ce frais.");
  }
  const historicalMaximum = counterSnapshot.exists ? 0 : matchingPayments.reduce((maximum, payment) => Math.max(maximum, receiptSequence(payment.receiptNumber)), 0);
  const storedSequence = counterSnapshot.exists ? Number(counterSnapshot.data()?.lastReceiptNumber || 0) : 0;
  const sequence = Math.max(historicalMaximum, storedSequence) + 1;
  const receiptNumber = `${receiptPrefix(year)}-${String(sequence).padStart(4, "0")}`;
  const paymentId = `pay_${hash.slice(0, 24)}`;
  const payment = {
    id: paymentId,
    schoolId: caller.schoolId,
    schoolYearId,
    studentId,
    ...(typeof student.parentId === "string" && student.parentId ? { parentId: student.parentId } : {}),
    feeTypeId,
    amount,
    paidAt: now.slice(0, 10),
    createdAt: now,
    updatedAt: now,
    createdBy: caller.uid,
    updatedBy: caller.uid,
    receiptNumber,
    cashierName: actorName,
    provenance: "financial-api",
    clientRequestIdHash: hash,
  };
  transaction.set(db.doc(`payments/${paymentId}`), payment);
  transaction.set(counterRef, { schoolId: caller.schoolId, schoolYearId, kind: "receipt", lastReceiptNumber: sequence, updatedAt: now }, { merge: true });
  const auditId = `audit_fin_${hash.slice(0, 24)}`;
  transaction.set(db.doc(`auditLogs/${auditId}`), serverAudit({ id: auditId, schoolId: caller.schoolId, schoolYearId, caller, actorName, action: "Création paiement", details: `${receiptNumber} - $${amount}`, createdAt: now }));
  if (typeof student.parentId === "string" && student.parentId) {
    const notificationId = `notif_fin_${hash.slice(0, 24)}`;
    transaction.set(db.doc(`notifications/${notificationId}`), {
      id: notificationId, schoolId: caller.schoolId, schoolYearId, parentId: student.parentId, studentId,
      recipientRole: "parent", type: "payment", module: "payments", event: "payment_recorded", destination: "/dashboard",
      title: "Paiement enregistré", body: `Montant payé : $${amount.toFixed(2)}\nReste à payer : $${Math.max(Number(fee.amount) - alreadyPaid - amount, 0).toFixed(2)}`,
      createdAt: now, read: false,
    });
  }
  return { payment };
}

async function createExpense(transaction, db, caller, body, hash, now) {
  assertAllowedKeys(body, EXPENSE_CREATE_KEYS);
  const amount = positiveAmount(body.amount);
  const { schoolYearId, actorName } = await assertContext(transaction, db, caller, body.schoolYearId);
  const category = text(body.category, 100);
  const description = text(body.description, 1000);
  const beneficiary = text(body.beneficiary, 200);
  const paymentMethod = text(body.paymentMethod, 100);
  const reference = text(body.reference, 160);
  if (!EXPENSE_CATEGORIES.has(category) || !description || !beneficiary || !paymentMethod) {
    throw new FinancialApiError(400, "invalid-argument", "Catégorie, description, bénéficiaire et mode de paiement sont requis.");
  }
  const expenseId = `expense_${hash.slice(0, 24)}`;
  const expense = {
    id: expenseId, schoolId: caller.schoolId, schoolYearId, amount, category, description, beneficiary, paymentMethod,
    ...(reference ? { reference } : {}), spentAt: now.slice(0, 10), createdAt: now, updatedAt: now,
    createdBy: caller.uid, updatedBy: caller.uid, cashierName: actorName, provenance: "financial-api", clientRequestIdHash: hash,
  };
  transaction.set(db.doc(`expenses/${expenseId}`), expense);
  const auditId = `audit_fin_${hash.slice(0, 24)}`;
  transaction.set(db.doc(`auditLogs/${auditId}`), serverAudit({ id: auditId, schoolId: caller.schoolId, schoolYearId, caller, actorName, action: "Création dépense", details: `${category} - $${amount}`, createdAt: now }));
  return { expense };
}

async function mutateExisting(transaction, db, caller, body, hash, now, kind, operation) {
  const isPayment = kind === "payment";
  assertAllowedKeys(body, operation === "delete" ? DELETE_KEYS : isPayment ? PAYMENT_UPDATE_KEYS : EXPENSE_UPDATE_KEYS);
  const transactionId = text(body.transactionId, 160);
  const reason = text(body.reason, 500);
  if (!transactionId || !reason) throw new FinancialApiError(400, "invalid-argument", "Transaction et motif sont requis.");
  const collectionName = isPayment ? "payments" : "expenses";
  const documentRef = db.doc(`${collectionName}/${transactionId}`);
  const snapshot = await transaction.get(documentRef);
  if (!snapshot.exists) throw new FinancialApiError(404, "not-found", "Transaction financière introuvable.");
  const current = snapshot.data();
  if (current.schoolId !== caller.schoolId) throw new FinancialApiError(403, "permission-denied", "Transaction financière hors établissement.");
  const { schoolYearId, actorName } = await assertContext(transaction, db, caller, current.schoolYearId);
  let result;
  let action;
  let details;
  if (operation === "delete") {
    transaction.delete(documentRef);
    result = { deletedId: transactionId, kind };
    action = isPayment ? "Suppression paiement" : "Suppression dépense";
    details = `${current.receiptNumber ?? current.category ?? transactionId}: $${current.amount}. Motif: ${reason}`;
  } else if (isPayment) {
    const amount = positiveAmount(body.amount);
    const [studentSnapshot, feeSnapshot] = await Promise.all([
      transaction.get(db.doc(`students/${current.studentId}`)),
      transaction.get(db.doc(`feeTypes/${current.feeTypeId}`)),
    ]);
    if (!studentSnapshot.exists || studentSnapshot.data()?.schoolId !== caller.schoolId || studentSnapshot.data()?.schoolYearId !== schoolYearId
      || !feeSnapshot.exists || feeSnapshot.data()?.schoolId !== caller.schoolId || feeSnapshot.data()?.schoolYearId !== schoolYearId) {
      throw new FinancialApiError(409, "conflict", "Les références du paiement ne sont plus valides.");
    }
    const annualSnapshot = await transaction.get(db.collection("payments").where("schoolId", "==", caller.schoolId).where("schoolYearId", "==", schoolYearId).where("studentId", "==", current.studentId).where("feeTypeId", "==", current.feeTypeId));
    const paidWithoutCurrent = annualSnapshot.docs.map((document) => document.data())
      .filter((payment) => payment.id !== transactionId && payment.studentId === current.studentId && payment.feeTypeId === current.feeTypeId)
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    if (paidWithoutCurrent + amount > Number(feeSnapshot.data()?.amount)) throw new FinancialApiError(409, "conflict", "Ce paiement dépasse le montant prévu pour ce frais.");
    const payment = { ...current, id: transactionId, amount, updatedAt: now, updatedBy: caller.uid, correctionReason: reason };
    transaction.update(documentRef, { amount, updatedAt: now, updatedBy: caller.uid, correctionReason: reason });
    result = { payment };
    action = "Correction paiement";
    details = `${current.receiptNumber ?? transactionId}: ancien $${current.amount}, nouveau $${amount}. Motif: ${reason}`;
  } else {
    const amount = positiveAmount(body.amount);
    const category = text(body.category, 100);
    const description = text(body.description, 1000);
    if (!category || !description) throw new FinancialApiError(400, "invalid-argument", "Catégorie et description sont requises.");
    const expense = { ...current, id: transactionId, amount, category, description, updatedAt: now, updatedBy: caller.uid, correctionReason: reason };
    transaction.update(documentRef, { amount, category, description, updatedAt: now, updatedBy: caller.uid, correctionReason: reason });
    result = { expense };
    action = "Modification dépense";
    details = `${current.category} - $${current.amount} → ${category} - $${amount}. Motif: ${reason}`;
  }
  const auditId = `audit_fin_${hash.slice(0, 24)}`;
  transaction.set(db.doc(`auditLogs/${auditId}`), serverAudit({ id: auditId, schoolId: caller.schoolId, schoolYearId, caller, actorName, action, details, createdAt: now }));
  return result;
}

export async function executeFinancialOperation({ db, caller: rawCaller, body, now = new Date().toISOString() }) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new FinancialApiError(400, "invalid-argument", "Requête financière invalide.");
  const action = text(body.action, 60);
  const createAction = action === "create-payment" || action === "create-expense";
  const caller = assertRole(rawCaller, createAction ? ["cashier"] : ["school_admin"]);
  const hash = requestKey(caller.uid, caller.schoolId, body.clientRequestId);
  const idempotencyRef = db.doc(`financialIdempotency/${hash}`);
  return db.runTransaction(async (transaction) => {
    const prior = idempotentResult(await transaction.get(idempotencyRef));
    if (prior) return prior;
    let result;
    if (action === "create-payment") result = await createPayment(transaction, db, caller, body, hash, now);
    else if (action === "create-expense") result = await createExpense(transaction, db, caller, body, hash, now);
    else if (action === "update-payment") result = await mutateExisting(transaction, db, caller, body, hash, now, "payment", "update");
    else if (action === "update-expense") result = await mutateExisting(transaction, db, caller, body, hash, now, "expense", "update");
    else if (action === "delete-payment") result = await mutateExisting(transaction, db, caller, body, hash, now, "payment", "delete");
    else if (action === "delete-expense") result = await mutateExisting(transaction, db, caller, body, hash, now, "expense", "delete");
    else throw new FinancialApiError(400, "invalid-argument", "Action financière invalide.");
    transaction.create(idempotencyRef, { schoolId: caller.schoolId, schoolYearId: body.schoolYearId ?? result.payment?.schoolYearId ?? result.expense?.schoolYearId ?? null, userId: caller.uid, action, result, createdAt: now });
    return { ...result, idempotent: false };
  });
}
