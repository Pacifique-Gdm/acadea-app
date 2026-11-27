import { FinancialApiError } from "./financialTransactions.js";

// Lot 3 : onglet « Enfants » du personnel.
// Un membre du personnel voit SEULEMENT les élèves dont la décision de prise en charge active
// (« Cas sociaux et prises en charge » → motif « Personnel de l'école ») le désigne, comme un parent voit les siens.
// Aucune règle de sécurité ne change : le personnel ne lit toujours ni les paiements ni les décisions ;
// c'est ce service du serveur qui filtre et renvoie uniquement ces enfants.
export const STAFF_CHILDREN_ROLES = ["school_admin", "admin", "cashier", "secretary", "teacher", "study_director", "discipline_director", "pedagogical_advisor"];
const STUDENT_FIELDS = ["id", "schoolId", "schoolYearId", "nom", "postnom", "prenom", "matricule", "sexe", "className", "classId", "subClassId", "option", "classOptionKey", "section", "status", "photoUrl", "photoPath", "photoStorageUrl", "financialSupport", "createdAt"];
const PAYMENT_FIELDS = ["id", "schoolId", "schoolYearId", "collectionSchoolYearId", "studentId", "feeTypeId", "amount", "currency", "paidAt", "createdAt", "receiptNumber", "paymentMethod", "cashierName", "formerStudent", "refundedByClassChangeId", "supportDecisionId"];
const pick = (value, keys) => Object.fromEntries(keys.filter((key) => value?.[key] !== undefined).map((key) => [key, value[key]]));
const fail = (status, message) => { throw new FinancialApiError(status, status === 403 ? "permission-denied" : "failed-precondition", message); };

export async function listStaffChildren({ db, caller }) {
  if (!STAFF_CHILDREN_ROLES.includes(caller?.role) || typeof caller?.schoolId !== "string" || !caller.schoolId || typeof caller.uid !== "string") {
    fail(403, "Consultation des enfants à charge non autorisée.");
  }
  const schoolId = caller.schoolId;
  const school = (await db.doc(`schools/${schoolId}`).get()).data();
  const yearId = school?.activeSchoolYearId;
  if (!yearId) return { children: [] };
  const decisions = (await db.collection("socialSupportDecisions").where("personnelId", "==", caller.uid).get()).docs
    .map((document) => ({ id: document.id, ...document.data() }))
    .filter((decision) => decision.schoolId === schoolId && decision.schoolYearId === yearId && decision.status === "active" && decision.reason === "personnel" && typeof decision.studentId === "string");
  if (!decisions.length) return { children: [] };
  const fees = (await db.collection("feeTypes").where("schoolYearId", "==", yearId).get()).docs
    .map((document) => ({ id: document.id, ...document.data() }))
    .filter((fee) => fee.schoolId === schoolId)
    .map((fee) => ({ id: fee.id, schoolId: fee.schoolId, schoolYearId: fee.schoolYearId, name: fee.name ?? "", amount: fee.amount, ...(fee.className ? { className: fee.className } : {}), ...(fee.classOptionKey ? { classOptionKey: fee.classOptionKey } : {}) }));
  const children = [];
  for (const decision of decisions.slice(0, 20)) {
    const snapshot = await db.doc(`students/${decision.studentId}`).get();
    const student = snapshot.data();
    if (!snapshot.exists || student.schoolId !== schoolId || student.schoolYearId !== yearId) continue;
    const payments = (await db.collection("payments").where("studentId", "==", decision.studentId).get()).docs
      .map((document) => ({ id: document.id, ...document.data() }))
      .filter((payment) => payment.schoolId === schoolId && payment.schoolYearId === yearId && !payment.formerStudent)
      .map((payment) => pick(payment, PAYMENT_FIELDS));
    children.push({
      student: { ...pick(student, STUDENT_FIELDS), id: snapshot.id },
      decision: { id: decision.id, reason: decision.reason, nature: decision.nature, lines: Object.fromEntries(Object.entries(decision.lines ?? {}).map(([feeId, line]) => [feeId, { feeName: line.feeName, value: line.value, officialMinor: line.officialMinor, reductionMinor: line.reductionMinor }])) },
      payments,
    });
  }
  return { children, feeTypes: fees, currency: school.currency === "CDF" ? "CDF" : "USD", schoolYearId: yearId };
}
