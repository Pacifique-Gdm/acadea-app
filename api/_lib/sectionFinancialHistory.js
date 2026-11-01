import { FinancialApiError } from "./financialTransactions.js";
import { isSectionAdministrator, requireActiveSectionAdministratorActor } from "./sectionAdministrators.js";

const PAGE_SIZE = 50;
const kinds = new Set(["payments", "expenses", "cashInflows"]);
const fields = {
  payments: ["schoolId", "schoolYearId", "collectionSchoolYearId", "studentId", "currentStudentId", "parentId", "feeTypeId", "feeName", "amount", "currency", "note", "paidAt", "createdAt", "updatedAt", "createdBy", "updatedBy", "receiptNumber", "cashierName", "debtSchoolYearName", "correctionReason", "section"],
  expenses: ["schoolId", "schoolYearId", "amount", "currency", "category", "description", "beneficiary", "paymentMethod", "reference", "spentAt", "createdAt", "updatedAt", "createdBy", "updatedBy", "cashierName", "correctionReason", "personnelPaymentId"],
  cashInflows: ["schoolId", "schoolYearId", "category", "amount", "currency", "entryDate", "source", "paymentMethod", "description", "reference", "createdAt", "validatedAt", "createdBy", "cashierName"],
};
const denied = () => { throw new FinancialApiError(403, "permission-denied", "Historique financier interdit."); };
const invalid = () => { throw new FinancialApiError(400, "invalid-argument", "Filtres de l'historique invalides."); };
const idValid = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,180}$/.test(value);

function publicRecord(kind, document) {
  const data = document.data();
  return Object.fromEntries([["id", document.id], ...fields[kind].filter((field) => data[field] !== undefined).map((field) => [field, data[field]])]);
}

export async function listSectionFinancialHistory({ db, caller, body }) {
  if (!isSectionAdministrator(caller?.role)) denied();
  if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some((key) => !["action", "kind", "schoolYearId", "cursorId"].includes(key))
      || !kinds.has(body.kind) || !idValid(body.schoolYearId)
      || body.cursorId !== undefined && !idValid(body.cursorId)) invalid();
  return db.runTransaction(async (transaction) => {
  const scope = await requireActiveSectionAdministratorActor(db, caller, transaction);
  const year = await transaction.get(db.doc(`schoolYears/${body.schoolYearId}`));
  if (!year.exists || year.data()?.schoolId !== scope.schoolId) denied();

  let history = db.collection(body.kind).where("schoolId", "==", scope.schoolId)
    .where("schoolYearId", "==", body.schoolYearId).orderBy("createdAt", "desc");
  if (body.cursorId) {
    const cursor = await transaction.get(db.doc(`${body.kind}/${body.cursorId}`));
    if (!cursor.exists || cursor.data()?.schoolId !== scope.schoolId || cursor.data()?.schoolYearId !== body.schoolYearId) denied();
    history = history.startAfter(cursor);
  }
  const snapshot = await transaction.get(history.limit(PAGE_SIZE));
  if (snapshot.docs.some((document) => document.data().schoolId !== scope.schoolId
      || document.data().schoolYearId !== body.schoolYearId)) denied();
  const records = snapshot.docs;
  let visible = records;
  if (body.kind === "payments") {
    const ids = [...new Set(records.flatMap((document) => [document.data().studentId, document.data().currentStudentId].filter(idValid)))];
    const students = new Map();
    if (ids.length) {
      const linked = await Promise.all(ids.map((id) => transaction.get(db.doc(`students/${id}`))));
      linked.forEach((student) => { if (student.exists) students.set(student.id, student.data()); });
    }
    visible = records.filter((document) => {
      const payment = document.data();
      if (!idValid(payment.studentId)) return false;
      const origin = students.get(payment.studentId);
      const current = payment.currentStudentId ? students.get(payment.currentStudentId) : null;
      const inScope = (student, yearId) => student?.schoolId === scope.schoolId
        && student.schoolYearId === yearId && scope.sectionIds.includes(student.section);
      return inScope(origin, payment.schoolYearId)
        && (!payment.currentStudentId || inScope(current, payment.collectionSchoolYearId));
    });
  }
  const last = snapshot.docs.at(-1);
  return { items: visible.map((document) => publicRecord(body.kind, document)),
    nextCursorId: snapshot.docs.length === PAGE_SIZE && last ? last.id : null };
  });
}
