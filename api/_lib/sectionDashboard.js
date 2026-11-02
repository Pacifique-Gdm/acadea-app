import { requireActiveSectionAdministratorActor } from "./sectionAdministrators.js";
import { feeAppliesToPublishedStudent } from "./gradePublicationCriteria.js";
import { supportBalance } from "./socialSupportMath.js";
import { fromMoneyMinor, sumMoneyMinor } from "./money.js";

const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };
const id = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,180}$/.test(value);
const active = (row) => !row.deletedAt && !row.archivedAt && row.active !== false && !["inactive", "archived", "ARCHIVED", "DELETED"].includes(row.status);
export function sectionDashboardTotals(students, fees, payments, currency) {
  const rows = new Map();
  for (const student of students) for (const fee of fees) {
    if (!feeAppliesToPublishedStudent(fee, student)) continue;
    const paid = payments.filter((payment) => payment.studentId === student.id && payment.feeTypeId === fee.id);
    if (!paid.length) continue; // Existing Acadéa rule: expected fees are those already initiated.
    if (paid.some((payment) => payment.currency !== currency)) fail(409, "Devise historique à vérifier.");
    const key = fee.name.trim().toLowerCase();
    const previous = rows.get(key) ?? { name: fee.name, expected: 0, paid: 0 };
    rows.set(key, { name: previous.name,
      expected: fromMoneyMinor(sumMoneyMinor([previous.expected, supportBalance(student, fee).net])),
      paid: fromMoneyMinor(sumMoneyMinor([previous.paid, ...paid.map((payment) => payment.amount)])) });
  }
  const feeProgressRows = [...rows.values()].map((row) => ({ ...row,
    remaining: fromMoneyMinor(Math.max(0, sumMoneyMinor([row.expected, -row.paid]))),
    rate: row.expected > 0 ? Math.round(row.paid / row.expected * 100) : 0,
  })).sort((a, b) => Number(b.name.trim().toLowerCase() === "minerval") - Number(a.name.trim().toLowerCase() === "minerval"));
  const expected = fromMoneyMinor(sumMoneyMinor(feeProgressRows.map((row) => row.expected)));
  const paid = fromMoneyMinor(sumMoneyMinor(feeProgressRows.map((row) => row.paid)));
  return { financialStats: { expected, paid, remaining: fromMoneyMinor(Math.max(0, sumMoneyMinor([expected, -paid]))) }, feeProgressRows };
}

export function sectionDashboardClassRows(students) {
  const rows = new Map();
  for (const student of students) {
    const base = typeof student.className === "string" ? student.className.trim() : "";
    const option = typeof student.option === "string" ? student.option.trim() : "";
    const label = student.section === "Secondaire" && option
      ? `${base.replace(/\s+Humanit[ée]s?$/i, "").trim() || base} ${option}` : base;
    const className = label || "Classe non renseignée";
    const row = rows.get(className) ?? { className, girls: 0, boys: 0, total: 0 };
    row.girls += student.sexe === "F" ? 1 : 0;
    row.boys += student.sexe === "M" ? 1 : 0;
    row.total += 1;
    rows.set(className, row);
  }
  return [...rows.values()].sort((a, b) => a.className.localeCompare(b.className, "fr"));
}

/** One read snapshot; only aggregates leave the server. Oversized snapshots fail closed. */
export async function loadSectionDashboard({ db, caller, body }) {
  if (!body || Object.keys(body).some((key) => !["action", "schoolYearId", "section", "startDate", "endDate"].includes(key))
    || !id(body.schoolYearId)) fail(400, "Filtres invalides.");
  for (const field of ["startDate", "endDate"]) if (body[field] !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(body[field])) fail(400, "Date invalide.");
  if (body.startDate && body.endDate && body.startDate > body.endDate) fail(400, "Période invalide.");
  return db.runTransaction(async (tx) => {
    const scope = await requireActiveSectionAdministratorActor(db, caller, tx);
    if (body.section !== undefined && !scope.sectionIds.includes(body.section)) fail(403, "Section interdite.");
    const [school, year] = await Promise.all([tx.get(db.doc(`schools/${scope.schoolId}`)), tx.get(db.doc(`schoolYears/${body.schoolYearId}`))]);
    if (!school.exists || school.data().status !== "active" || !year.exists || year.data().schoolId !== scope.schoolId) fail(403, "Établissement ou année indisponible.");
    const currency = year.data().currency ?? school.data().currency;
    if (!["CDF", "USD"].includes(currency)) fail(409, "Devise à vérifier.");
    const read = async (query) => {
      const snapshot = await tx.get(query.limit(10001));
      if (snapshot.docs.length > 10000) fail(409, "Synthèse trop volumineuse : aucune donnée partielle affichée.");
      return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
    };
    const base = (kind) => db.collection(kind).where("schoolId", "==", scope.schoolId);
    const annual = (kind) => base(kind).where("schoolYearId", "==", body.schoolYearId);
    const sections = body.section ? [body.section] : scope.sectionIds;
    const students = (await read(annual("students").where("section", "in", sections))).filter((student) => !student.deletedAt && (student.status ?? "ACTIVE") === "ACTIVE");
    if (students.some((student) => student.schoolId !== scope.schoolId || student.schoolYearId !== body.schoolYearId || !sections.includes(student.section))) fail(403, "Élève hors périmètre.");
    const ids = new Set(students.map((student) => student.id));
    const [fees, rawPayments, parents, users] = await Promise.all([
      read(annual("feeTypes")), read(annual("payments")), read(base("parents")), read(base("users")),
    ]);
    const currentIds = [...new Set(rawPayments.filter((payment) => ids.has(payment.studentId) && payment.currentStudentId).map((payment) => payment.currentStudentId))];
    if (currentIds.some((value) => !id(value))) fail(409, "Référence historique invalide.");
    const current = new Map(await Promise.all(currentIds.map(async (studentId) => {
      const snapshot = await tx.get(db.doc(`students/${studentId}`));
      return [studentId, snapshot.exists ? snapshot.data() : null];
    })));
    const payments = rawPayments.filter((payment) => ids.has(payment.studentId)
      && (!payment.currentStudentId || current.get(payment.currentStudentId)?.schoolId === scope.schoolId
        && current.get(payment.currentStudentId)?.schoolYearId === payment.collectionSchoolYearId
        && scope.sectionIds.includes(current.get(payment.currentStudentId)?.section))
      && (!body.startDate || payment.paidAt?.slice(0, 10) >= body.startDate)
      && (!body.endDate || payment.paidAt?.slice(0, 10) <= body.endDate));
    const parentIds = new Set(students.map((student) => student.parentId).filter(Boolean));
    const parentCount = new Set(parents.filter((parent) => active(parent)
      && (parentIds.has(parent.id) || parent.studentIds?.some((studentId) => ids.has(studentId))))
      .map((parent) => parent.userId || parent.id)).size;
    const personnel = Object.fromEntries(["school_admin", "cashier", "discipline_director"].map((role) => [role, users.filter((user) => user.role === role && active(user)).length]));
    return { schoolId: scope.schoolId, schoolYearId: body.schoolYearId, sections, currency,
      students: students.length, classRows: sectionDashboardClassRows(students), parents: parentCount, personnel,
      ...sectionDashboardTotals(students, fees, payments, currency) };
  });
}
