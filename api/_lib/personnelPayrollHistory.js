import { resolveCoordinationSchoolScope } from "./coordination.js";
import { FinancialApiError } from "./financialTransactions.js";

const PAGE_SIZE = 50;
const SCHOOL_BATCH_SIZE = 15; // Deux natures de paiement : au plus 30 clauses disjonctives Firestore.
const denied = () => { throw new FinancialApiError(403, "permission-denied", "Historique de paie interdit."); };
const invalid = () => { throw new FinancialApiError(400, "invalid-argument", "Filtres de l'historique invalides."); };

export async function listPersonnelPayrollHistory({ db, actor, body }) {
  if (!actor?.uid || !["school_admin", "cashier", "coordination_admin", "sub_coordination_admin"].includes(actor.role)) denied();
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["action", "schoolId", "cursor"].includes(key))) invalid();
  const requestedSchoolId = body.schoolId === undefined ? "" : body.schoolId;
  if (typeof requestedSchoolId !== "string" || requestedSchoolId.length > 150) invalid();
  const cursor = body.cursor;
  if (cursor !== undefined && (!cursor || typeof cursor !== "object" || Array.isArray(cursor)
    || Object.keys(cursor).some((key) => !["paidAt", "id"].includes(key))
    || !/^\d{4}-\d{2}-\d{2}$/.test(cursor.paidAt)
    || !/^[\w-]{1,180}$/.test(cursor.id))) invalid();

  let schoolIds;
  if (actor.role === "school_admin" || actor.role === "cashier") {
    const profile = await db.doc(`users/${actor.uid}`).get();
    if (!profile.exists || profile.data()?.role !== actor.role || profile.data()?.schoolId !== actor.schoolId) denied();
    schoolIds = actor.schoolId ? [actor.schoolId] : [];
  } else {
    schoolIds = await resolveCoordinationSchoolScope(db, actor);
  }
  if (requestedSchoolId && !schoolIds.includes(requestedSchoolId)) denied();
  if (requestedSchoolId) schoolIds = [requestedSchoolId];
  if (!schoolIds.length) return { payments: [], nextCursor: null };

  const batches = [];
  for (let index = 0; index < schoolIds.length; index += SCHOOL_BATCH_SIZE) batches.push(schoolIds.slice(index, index + SCHOOL_BATCH_SIZE));
  const snapshots = await Promise.all(batches.map((ids) => {
    let query = db.collection("personnelPayments")
      .where("schoolId", "in", ids)
      .where("kind", "in", ["salary", "bonus"])
      .orderBy("paidAt", "desc")
      .orderBy("__name__", "desc");
    if (cursor) query = query.startAfter(cursor.paidAt, db.doc(`personnelPayments/${cursor.id}`));
    return query.limit(PAGE_SIZE + 1).get();
  }));
  const allowed = new Set(schoolIds);
  const merged = snapshots.flatMap((snapshot) => snapshot.docs.map((document) => ({ id: document.id, ...document.data() })))
    .filter((item) => allowed.has(item.schoolId) && (item.kind === "salary" || item.kind === "bonus"))
    .sort((first, second) => second.paidAt.localeCompare(first.paidAt) || second.id.localeCompare(first.id));
  const page = merged.slice(0, PAGE_SIZE);
  const payments = page.map((item) => ({
    id: item.id, schoolId: item.schoolId, schoolYearId: item.schoolYearId,
    beneficiaryId: item.beneficiaryId, beneficiaryName: item.beneficiaryName,
    beneficiaryJobTitle: item.beneficiaryJobTitle, beneficiaryHasAccount: item.beneficiaryHasAccount,
    kind: item.kind, netPaid: item.netPaid, currency: item.currency, paidAt: item.paidAt,
    periodMonth: item.periodMonth, periodYear: item.periodYear, reference: item.reference,
    amount: item.amount, recoveredAmount: item.recoveredAmount, recoveries: item.recoveries,
    deduction: item.deduction, deductionReason: item.deductionReason, cnss: item.cnss, tax: item.tax,
    description: item.description, expenseId: item.expenseId, createdAt: item.createdAt, createdBy: item.createdBy,
    updatedAt: item.updatedAt,
  }));
  const last = page.at(-1);
  return { payments, nextCursor: merged.length > PAGE_SIZE && last ? { paidAt: last.paidAt, id: last.id } : null };
}
