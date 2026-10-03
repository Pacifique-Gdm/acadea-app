import { createHash } from "node:crypto";
import { AUDIT_EVENT_TYPES, buildServerAudit } from "./serverAudit.js";

const PAYMENT_CREATE_KEYS = ["action", "schoolYearId", "studentId", "feeTypeId", "debtSchoolYearId", "amount", "note", "clientRequestId"];
const ARREARS_READ_KEYS = ["action", "schoolYearId", "studentId"];
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

async function assertContext(transaction, db, caller, requestedYearId, readOnly = false) {
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
  if (yearSnapshot.data()?.status === "archived" && !readOnly) {
    throw new FinancialApiError(409, "failed-precondition", "Cette année scolaire est archivée en lecture seule.");
  }
  const profile = userSnapshot.data() ?? {};
  const profileRole = profile.role === "admin" ? "school_admin" : profile.role;
  if (!userSnapshot.exists || profile.schoolId !== caller.schoolId || profile.status === "inactive" || profile.active === false || profileRole !== caller.role) {
    throw new FinancialApiError(403, "permission-denied", "Profil utilisateur financier invalide.");
  }
  const yearCurrency = yearSnapshot.data()?.currency;
  const currency = yearCurrency === "CDF" || yearCurrency === "USD"
    ? yearCurrency
    : schoolSnapshot.data()?.currency === "CDF" ? "CDF" : "USD";
  return { schoolYearId, year: yearSnapshot.data(), school: schoolSnapshot.data(), profile, currency, actorName: text(profile.name, 160) || text(caller.email, 160) || "Utilisateur Acadéa" };
}

function feeAppliesToHistoricalStudent(fee, student) {
  if (typeof fee.classOptionKey === "string" && fee.classOptionKey) {
    const option = typeof student.option === "string" ? student.option.trim() : "";
    const target = option && String(student.className).includes("Humanité")
      ? `${student.className}::option::${option}` : student.className;
    return fee.classOptionKey === target;
  }
  return !fee.className || fee.className === student.className;
}

async function historicalStudentRecords(transaction, db, caller, currentStudent, currentYear, reads) {
  const records = new Map();
  const collectAncestors = async () => {
    const known = new Set([currentStudent.id]);
    let ancestorId = text(currentStudent.importedFromStudentId, 120);
    for (let depth = 0; ancestorId && depth < 30; depth += 1) {
      if (known.has(ancestorId)) throw new FinancialApiError(409, "conflict", "La filiation annuelle de l'élève est ambiguë.");
      known.add(ancestorId);
      const snapshot = reads ? reads.students.get(ancestorId) : await transaction.get(db.doc(`students/${ancestorId}`));
      if (!snapshot?.exists || snapshot.data()?.schoolId !== caller.schoolId) {
        throw new FinancialApiError(409, "conflict", "La filiation annuelle de l'élève est invalide.");
      }
      records.set(ancestorId, { id: ancestorId, ...snapshot.data() });
      ancestorId = text(snapshot.data()?.importedFromStudentId, 120);
    }
    if (ancestorId) throw new FinancialApiError(409, "conflict", "La filiation annuelle de l'élève est trop longue.");
  };
  const matricule = text(currentStudent.matricule, 120);
  // These independent reads need not wait for each ancestry hop.
  const [, matches, yearsSnapshot] = await Promise.all([
    collectAncestors(),
    reads ? { docs: reads.matches.filter((document) => document.data().matricule === matricule) } : matricule ? transaction.get(db.collection("students").where("matricule", "==", matricule)) : { docs: [] },
    reads ? { docs: reads.years.filter((document) => document.data().schoolId === caller.schoolId) } : transaction.get(db.collection("schoolYears").where("schoolId", "==", caller.schoolId)),
  ]);
  if (matricule) {
    for (const document of matches.docs) {
      const student = document.data();
      const sameIdentity = ["nom", "postnom", "prenom", "birthDate"].every((field) => {
        const currentValue = text(currentStudent[field], 160).toLocaleLowerCase("fr");
        const historicalValue = text(student[field], 160).toLocaleLowerCase("fr");
        return !currentValue || !historicalValue || currentValue === historicalValue;
      });
      const sharedIdentity = ["nom", "postnom", "prenom", "birthDate"].some((field) => {
        const currentValue = text(currentStudent[field], 160).toLocaleLowerCase("fr");
        return currentValue && currentValue === text(student[field], 160).toLocaleLowerCase("fr");
      });
      if (student.schoolId === caller.schoolId && document.id !== currentStudent.id && sameIdentity && sharedIdentity) {
        records.set(document.id, { id: document.id, ...student });
      }
    }
  }
  const years = new Map(yearsSnapshot.docs.map((document) => [document.id, { id: document.id, ...document.data() }]));
  const byYear = new Map();
  for (const student of records.values()) {
    const year = years.get(student.schoolYearId);
    if (!year || year.status !== "archived" || (currentYear.startsAt && year.startsAt && year.startsAt >= currentYear.startsAt)) continue;
    if (byYear.has(year.id)) throw new FinancialApiError(409, "conflict", "Plusieurs fiches historiques correspondent à cet élève pour la même année.");
    byYear.set(year.id, { student, year });
  }
  return [...byYear.values()];
}

async function historicalDebts(transaction, db, caller, currentStudent, currentYear, school, reads, knownRecords) {
  const records = knownRecords ?? await historicalStudentRecords(transaction, db, caller, currentStudent, currentYear, reads);
  const groups = await Promise.all(records.map(async ({ student, year }) => {
    const debts = [];
    const [feeSnapshot, paymentSnapshot] = reads ? [
      { docs: reads.fees.filter((document) => document.data().schoolYearId === year.id) },
      { docs: reads.payments.filter((document) => document.data().studentId === student.id) },
    ] : await Promise.all([
      transaction.get(db.collection("feeTypes").where("schoolYearId", "==", year.id)),
      transaction.get(db.collection("payments").where("studentId", "==", student.id)),
    ]);
    const payments = paymentSnapshot.docs.map((document) => document.data())
      .filter((payment) => payment.schoolId === caller.schoolId && payment.schoolYearId === year.id);
    for (const document of feeSnapshot.docs) {
      const fee = document.data();
      if (fee.schoolId !== caller.schoolId || !feeAppliesToHistoricalStudent(fee, student)) continue;
      const expected = Number(fee.amount);
      if (!Number.isFinite(expected) || expected <= 0) continue;
      const paid = payments.filter((payment) => payment.feeTypeId === document.id)
        .reduce((total, payment) => total + Number(payment.amount || 0), 0);
      const currency = year.currency === "USD" || year.currency === "CDF" ? year.currency : school.currency === "CDF" ? "CDF" : "USD";
      debts.push({ schoolYearId: year.id, yearName: year.name, studentId: student.id, feeTypeId: document.id,
        feeName: text(fee.name, 160) || "Frais", expected, paid, remaining: Math.max(expected - paid, 0), currency });
    }
    return debts;
  }));
  return groups.flat().sort((a, b) => String(a.yearName).localeCompare(String(b.yearName), "fr") || a.feeName.localeCompare(b.feeName, "fr"));
}

// Request-local grouped reads only: no persisted projection and no second debt formula.
// Each source page is at most 50 students. Firestore `in` operands stay <= 30.
async function arrearsBatch(transaction, db, studentIds, schoolIds, requestedYearId) {
  if (!Array.isArray(studentIds) || !studentIds.length || studentIds.length > 50 || studentIds.some((id) => typeof id !== "string" || !id || id.length > 120 || id.includes("/")) || new Set(studentIds).size !== studentIds.length) {
    throw new FinancialApiError(400, "invalid-argument", "Une liste de 1 à 50 élèves distincts est requise.");
  }
  const documents = await transaction.getAll(...studentIds.map((id) => db.doc(`students/${id}`)));
  if (documents.some((document) => !document.exists || !schoolIds.includes(document.data().schoolId) || (requestedYearId && document.data().schoolYearId !== requestedYearId))) {
    throw new FinancialApiError(404, "not-found", "Élève introuvable dans le périmètre autorisé.");
  }
  const queryMany = async (collection, field, values) => {
    const unique = [...new Set(values.filter(Boolean))];
    const snapshots = await Promise.all(Array.from({ length: Math.ceil(unique.length / 30) }, (_, i) => transaction.get(db.collection(collection).where(field, "in", unique.slice(i * 30, i * 30 + 30)))));
    return snapshots.flatMap((snapshot) => snapshot.docs);
  };
  const usedSchools = [...new Set(documents.map((document) => document.data().schoolId))];
  const [schools, years, matches] = await Promise.all([
    transaction.getAll(...usedSchools.map((id) => db.doc(`schools/${id}`))),
    queryMany("schoolYears", "schoolId", usedSchools),
    queryMany("students", "matricule", documents.map((document) => text(document.data().matricule, 120))),
  ]);
  const reads = { students: new Map(documents.map((document) => [document.id, document])), years, matches, fees: [], payments: [] };
  // Fetch each ancestry level together; the canonical traversal below still rejects
  // missing/foreign ancestors, cycles, chains >30 and ambiguous records per year.
  let frontier = documents;
  for (let depth = 0; depth < 30; depth++) {
    const ids = [...new Set(frontier.map((document) => text(document.data()?.importedFromStudentId, 120)).filter((id) => id && !reads.students.has(id)))];
    if (!ids.length) break;
    frontier = await transaction.getAll(...ids.map((id) => db.doc(`students/${id}`)));
    frontier.forEach((document) => reads.students.set(document.id, document));
  }
  const contexts = await Promise.all(documents.map(async (document) => {
    const student = { ...document.data(), id: document.id };
    const schoolSnapshot = schools.find((item) => item.id === student.schoolId);
    const yearSnapshot = years.find((item) => item.id === student.schoolYearId);
    const school = schoolSnapshot?.data(), year = yearSnapshot?.data();
    if (!schoolSnapshot?.exists || school?.status !== "active" || !year || year.schoolId !== student.schoolId) throw new FinancialApiError(409, "failed-precondition", "Contexte scolaire indisponible.");
    const records = await historicalStudentRecords(transaction, db, { schoolId: student.schoolId }, student, year, reads);
    return { student, school, year, records };
  }));
  [reads.fees, reads.payments] = await Promise.all([
    queryMany("feeTypes", "schoolYearId", contexts.flatMap((context) => context.records.map(({ year }) => year.id))),
    queryMany("payments", "studentId", contexts.flatMap((context) => context.records.map(({ student }) => student.id))),
  ]);
  const totals = {};
  for (const { student, school, year, records } of contexts) {
    const debts = await historicalDebts(transaction, db, { schoolId: student.schoolId }, student, year, school, reads, records);
    totals[student.id] = debts.reduce((sum, debt) => ({ ...sum, [debt.currency]: sum[debt.currency] + debt.remaining }), { USD: 0, CDF: 0 });
  }
  return { totals };
}

export function listScopedStudentArrearsBatch({ db, studentIds, schoolIds }) {
  return db.runTransaction((transaction) => arrearsBatch(transaction, db, studentIds, schoolIds));
}

export function listStudentArrearsBatch({ db, caller: rawCaller, body }) {
  assertAllowedKeys(body, ["action", "schoolYearId", "studentIds"]);
  const caller = assertRole(rawCaller, ["school_admin", "cashier"]);
  return db.runTransaction(async (transaction) => {
    const { schoolYearId } = await assertContext(transaction, db, caller, body.schoolYearId, true);
    return arrearsBatch(transaction, db, body.studentIds, [caller.schoolId], schoolYearId);
  });
}

export async function listStudentArrears({ db, caller: rawCaller, body }) {
  assertAllowedKeys(body, ARREARS_READ_KEYS);
  const caller = assertRole(rawCaller, ["cashier", "school_admin", "parent"]);
  return db.runTransaction(async (transaction) => {
    const { schoolYearId, year, school, profile } = await assertContext(transaction, db, caller, body.schoolYearId);
    if (year.status !== "active" || school.activeSchoolYearId !== schoolYearId) {
      throw new FinancialApiError(409, "failed-precondition", "L'année scolaire active est requise.");
    }
    const studentId = text(body.studentId, 120);
    const snapshot = studentId ? await transaction.get(db.doc(`students/${studentId}`)) : { exists: false };
    const student = snapshot.data?.() ?? {};
    if (!snapshot.exists || student.schoolId !== caller.schoolId || student.schoolYearId !== schoolYearId || student.status !== "ACTIVE") {
      throw new FinancialApiError(400, "invalid-argument", "Élève invalide pour cet établissement et cette année.");
    }
    if (caller.role === "parent" && (!text(caller.parentId, 120) || profile.parentId !== caller.parentId || student.parentId !== caller.parentId)) {
      throw new FinancialApiError(403, "permission-denied", "Cet élève n'est pas lié à ce parent.");
    }
    const debts = await historicalDebts(transaction, db, caller, { id: studentId, ...student }, year, school);
    return { debts: debts.filter((debt) => debt.remaining > 0), settled: debts.filter((debt) => debt.remaining === 0) };
  });
}

// Read-only supervision: the caller's school scope is resolved server-side by
// requireActiveCoordinationActor, never supplied by the client.
export async function listScopedStudentArrears({ db, studentId, schoolIds }) {
  const id = text(studentId, 120);
  if (!id || id.includes("/")) throw new FinancialApiError(400, "invalid-argument", "Élève requis.");
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(db.doc(`students/${id}`));
    const student = snapshot.data?.();
    if (!snapshot.exists || !schoolIds.includes(student?.schoolId)) throw new FinancialApiError(404, "not-found", "Élève introuvable dans le périmètre autorisé.");
    const [schoolSnapshot, yearSnapshot] = await Promise.all([
      transaction.get(db.doc(`schools/${student.schoolId}`)),
      transaction.get(db.doc(`schoolYears/${student.schoolYearId}`)),
    ]);
    const school = schoolSnapshot.data?.(), year = yearSnapshot.data?.();
    if (!schoolSnapshot.exists || school.status !== "active" || !yearSnapshot.exists || year.schoolId !== student.schoolId) throw new FinancialApiError(409, "failed-precondition", "Contexte scolaire indisponible.");
    const debts = await historicalDebts(transaction, db, { schoolId: student.schoolId }, { ...student, id }, year, school);
    return { debts: debts.filter((debt) => debt.remaining > 0), settled: debts.filter((debt) => debt.remaining === 0) };
  });
}

async function createPayment(transaction, db, caller, body, hash, now) {
  assertAllowedKeys(body, PAYMENT_CREATE_KEYS);
  const amount = positiveAmount(body.amount);
  const { schoolYearId: collectionSchoolYearId, year, school, currency, actorName } = await assertContext(transaction, db, caller, body.schoolYearId);
  const currentStudentId = text(body.studentId, 120);
  const feeTypeId = text(body.feeTypeId, 120);
  const debtSchoolYearId = text(body.debtSchoolYearId, 120);
  const note = text(body.note, 1000);
  if (!currentStudentId || !feeTypeId) throw new FinancialApiError(400, "invalid-argument", "Élève et type de frais requis.");
  const currentStudentRef = db.doc(`students/${currentStudentId}`);
  const feeRef = db.doc(`feeTypes/${feeTypeId}`);
  const [currentStudentSnapshot, feeSnapshot] = await Promise.all([transaction.get(currentStudentRef), transaction.get(feeRef)]);
  const currentStudent = currentStudentSnapshot.data() ?? {};
  const fee = feeSnapshot.data() ?? {};
  if (!currentStudentSnapshot.exists || currentStudent.schoolId !== caller.schoolId || currentStudent.schoolYearId !== collectionSchoolYearId || currentStudent.status !== "ACTIVE") {
    throw new FinancialApiError(400, "invalid-argument", "Élève invalide pour cet établissement et cette année.");
  }
  if (!feeSnapshot.exists || fee.schoolId !== caller.schoolId || !Number.isFinite(Number(fee.amount)) || Number(fee.amount) <= 0) {
    throw new FinancialApiError(400, "invalid-argument", "Type de frais invalide pour cet établissement et cette année.");
  }
  let schoolYearId = collectionSchoolYearId;
  let studentId = currentStudentId;
  let debt;
  if (debtSchoolYearId) {
    if (debtSchoolYearId === collectionSchoolYearId || year.status !== "active" || school.activeSchoolYearId !== collectionSchoolYearId) {
      throw new FinancialApiError(409, "failed-precondition", "Une créance historique exige l'année scolaire active.");
    }
    const debts = await historicalDebts(transaction, db, caller, { id: currentStudentId, ...currentStudent }, year, school);
    debt = debts.find((item) => item.schoolYearId === debtSchoolYearId && item.feeTypeId === feeTypeId);
    if (!debt) throw new FinancialApiError(400, "invalid-argument", "Créance historique invalide pour cet élève.");
    schoolYearId = debt.schoolYearId;
    studentId = debt.studentId;
  } else if (fee.schoolYearId !== collectionSchoolYearId) {
    throw new FinancialApiError(400, "invalid-argument", "Type de frais invalide pour cet établissement et cette année.");
  }
  const counterId = `${caller.schoolId}_${collectionSchoolYearId}_receipt`;
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
  const remaining = Math.max(Number(fee.amount) - alreadyPaid, 0);
  if (remaining === 0) {
    throw new FinancialApiError(409, "conflict", "Ce type de frais est déjà soldé.");
  }
  if (amount > remaining) {
    throw new FinancialApiError(409, "conflict", "Le montant saisi dépasse le solde restant pour ce type de frais.");
  }
  let historicalMaximum = counterSnapshot.exists || debt ? 0 : matchingPayments.reduce((maximum, payment) => Math.max(maximum, receiptSequence(payment.receiptNumber)), 0);
  if (debt && !counterSnapshot.exists) {
    const [annualSnapshot, collectedSnapshot] = await Promise.all([
      transaction.get(db.collection("payments").where("schoolId", "==", caller.schoolId).where("schoolYearId", "==", collectionSchoolYearId)),
      transaction.get(db.collection("payments").where("schoolId", "==", caller.schoolId).where("collectionSchoolYearId", "==", collectionSchoolYearId)),
    ]);
    historicalMaximum = [...annualSnapshot.docs, ...collectedSnapshot.docs].map((document) => document.data())
      .filter((payment) => payment.schoolId === caller.schoolId)
      .reduce((maximum, payment) => Math.max(maximum, receiptSequence(payment.receiptNumber)), historicalMaximum);
  }
  const storedSequence = counterSnapshot.exists ? Number(counterSnapshot.data()?.lastReceiptNumber || 0) : 0;
  const sequence = Math.max(historicalMaximum, storedSequence) + 1;
  const receiptNumber = `${receiptPrefix(year)}-${String(sequence).padStart(4, "0")}`;
  const paymentId = `pay_${hash.slice(0, 24)}`;
  const payment = {
    id: paymentId,
    schoolId: caller.schoolId,
    schoolYearId,
    studentId,
    ...(typeof currentStudent.parentId === "string" && currentStudent.parentId ? { parentId: currentStudent.parentId } : {}),
    feeTypeId,
    ...(debt ? { collectionSchoolYearId, currentStudentId, debtSchoolYearName: debt.yearName, feeName: debt.feeName, currency: debt.currency } : {}),
    amount,
    ...(note ? { note } : {}),
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
  transaction.set(counterRef, { schoolId: caller.schoolId, schoolYearId: collectionSchoolYearId, kind: "receipt", lastReceiptNumber: sequence, updatedAt: now }, { merge: true });
  const auditId = `audit_fin_${hash.slice(0, 24)}`;
  transaction.set(db.doc(`auditLogs/${auditId}`), buildServerAudit({ id: auditId, eventType: AUDIT_EVENT_TYPES.FINANCE_PAYMENT_CREATED, actor: { ...caller, name: actorName }, schoolId: caller.schoolId, schoolYearId: collectionSchoolYearId, resourceType: "payment", resourceId: paymentId, metadata: { receiptNumber, amount, ...(debt ? { debtSchoolYearId, feeTypeId } : {}) } }));
  if (typeof currentStudent.parentId === "string" && currentStudent.parentId) {
    const notificationId = `notif_fin_${hash.slice(0, 24)}`;
    const studentName = [currentStudent.nom, currentStudent.postnom, currentStudent.prenom].map((value) => text(value, 120)).filter(Boolean).join(" ") || "Élève";
    const symbol = (debt?.currency ?? currency) === "CDF" ? "FC" : "$";
    const formatAmount = (value) => symbol === "$" ? `$${value.toFixed(2)}` : `${value.toFixed(2)} FC`;
    const remaining = Math.max(Number(fee.amount) - alreadyPaid - amount, 0);
    transaction.set(db.doc(`notifications/${notificationId}`), {
      id: notificationId, schoolId: caller.schoolId, schoolYearId: collectionSchoolYearId, parentId: currentStudent.parentId, studentId: currentStudentId,
      recipientRole: "parent", type: "payment", module: "payments", event: "payment_recorded", destination: "/dashboard",
      title: "Paiement enregistré", body: `Élève : ${studentName}\nType de frais : ${text(fee.name, 160) || "Frais"}${debt ? ` — Arriéré ${debt.yearName}` : ""}\nMontant payé : ${formatAmount(amount)}\nReste à payer : ${formatAmount(remaining)}`,
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
  transaction.set(db.doc(`auditLogs/${auditId}`), buildServerAudit({ id: auditId, eventType: AUDIT_EVENT_TYPES.FINANCE_EXPENSE_CREATED, actor: { ...caller, name: actorName }, schoolId: caller.schoolId, schoolYearId, resourceType: "expense", resourceId: expenseId, metadata: { category, amount } }));
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
  if (operation === "delete") {
    transaction.delete(documentRef);
    result = { deletedId: transactionId, kind };
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
  } else {
    const amount = positiveAmount(body.amount);
    const category = text(body.category, 100);
    const description = text(body.description, 1000);
    if (!category || !description) throw new FinancialApiError(400, "invalid-argument", "Catégorie et description sont requises.");
    const expense = { ...current, id: transactionId, amount, category, description, updatedAt: now, updatedBy: caller.uid, correctionReason: reason };
    transaction.update(documentRef, { amount, category, description, updatedAt: now, updatedBy: caller.uid, correctionReason: reason });
    result = { expense };
  }
  const auditId = `audit_fin_${hash.slice(0, 24)}`;
  const eventType = isPayment
    ? operation === "delete" ? AUDIT_EVENT_TYPES.FINANCE_PAYMENT_DELETED : AUDIT_EVENT_TYPES.FINANCE_PAYMENT_UPDATED
    : operation === "delete" ? AUDIT_EVENT_TYPES.FINANCE_EXPENSE_DELETED : AUDIT_EVENT_TYPES.FINANCE_EXPENSE_UPDATED;
  transaction.set(db.doc(`auditLogs/${auditId}`), buildServerAudit({ id: auditId, eventType, actor: { ...caller, name: actorName }, schoolId: caller.schoolId, schoolYearId, resourceType: kind, resourceId: transactionId, metadata: { reason, operation } }));
  return result;
}

export async function executeFinancialOperation({ db, caller: rawCaller, body, now = new Date().toISOString() }) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new FinancialApiError(400, "invalid-argument", "Requête financière invalide.");
  const action = text(body.action, 60);
  const caller = authorizeFinancialCaller(rawCaller, action);
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

export function authorizeFinancialCaller(rawCaller, action) {
  const createAction = action === "create-payment" || action === "create-expense";
  return assertRole(rawCaller, action === "list-arrears" ? ["cashier", "school_admin", "parent"] : action === "list-arrears-batch" ? ["cashier", "school_admin"] : createAction ? ["cashier"] : ["school_admin"]);
}
