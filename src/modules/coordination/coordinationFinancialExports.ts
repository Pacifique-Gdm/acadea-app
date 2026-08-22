import type { Coordination, Expense, Payment, School, Student } from "../../types";
import { escapePdfHtml, pdfSection, pdfTable, renderAcadPdfPreview } from "../../utils/pdf";
import { formatCurrencyMoney, resolveSchoolCurrency } from "../../utils/currency";
import { coordinationPdfInstitution } from "./coordinationPdfInstitution";

type FinancialExportKind = "payments" | "expenses";

type ExportFinancialTransactionsOptions = {
  kind: FinancialExportKind;
  source: "students" | "control";
  coordination: Coordination;
  schools: School[];
  selectedSchoolId: string;
  students: Student[];
  payments: Payment[];
  expenses: Expense[];
  filtersLabel: string;
};

function studentKey(student: Pick<Student, "schoolId" | "id">) {
  return `${student.schoolId}:${student.id}`;
}

export function selectCoordinationPaymentsForStudents(payments: Payment[], students: Student[]) {
  const visibleStudentKeys = new Set(students.map(studentKey));
  return payments.filter((payment) => visibleStudentKeys.has(`${payment.schoolId}:${payment.studentId}`));
}

export function selectCoordinationExpensesForStudentScope(expenses: Expense[], students: Student[]) {
  const visibleSchoolIds = new Set(students.map((student) => student.schoolId));
  return expenses.filter((expense) => visibleSchoolIds.has(expense.schoolId));
}

export async function exportCoordinationFinancialTransactions({
  kind,
  source,
  coordination,
  schools,
  selectedSchoolId,
  students,
  payments,
  expenses,
  filtersLabel,
}: ExportFinancialTransactionsOptions) {
  const contextSchool = schools.find((school) => school.id === selectedSchoolId) ?? schools[0];
  if (!contextSchool) return;

  const schoolById = new Map(schools.map((school) => [school.id, school]));
  const studentByKey = new Map(students.map((student) => [studentKey(student), student]));
  const rows = kind === "payments"
    ? selectCoordinationPaymentsForStudents(payments, students)
    : selectCoordinationExpensesForStudentScope(expenses, students);
  const currencies = [...new Set((rows.length ? rows.map((row) => resolveSchoolCurrency(schoolById.get(row.schoolId) ?? {})) : schools.map(resolveSchoolCurrency)))];
  const sections = currencies.map((currency) => kind === "payments"
    ? pdfSection(`Paiements — ${currency}`, pdfTable([
      { header: "Élève", render: (payment) => { const student = studentByKey.get(`${payment.schoolId}:${payment.studentId}`); return escapePdfHtml(student ? `${student.nom} ${student.postnom} ${student.prenom}`.trim() : payment.studentId); } },
      { header: "École", render: (payment) => escapePdfHtml(schoolById.get(payment.schoolId)?.name ?? payment.schoolId) },
      { header: "Date", render: (payment) => escapePdfHtml(payment.paidAt) },
      { header: "Montant", render: (payment) => escapePdfHtml(formatCurrencyMoney(payment.amount, currency)) },
    ], (rows as Payment[]).filter((payment) => resolveSchoolCurrency(schoolById.get(payment.schoolId) ?? {}) === currency), "Aucun paiement dans cette devise."))
    : pdfSection(`Dépenses — ${currency}`, pdfTable([
      { header: "École", render: (expense) => escapePdfHtml(schoolById.get(expense.schoolId)?.name ?? expense.schoolId) },
      { header: "Catégorie", render: (expense) => escapePdfHtml(expense.category) },
      { header: "Description", render: (expense) => escapePdfHtml(expense.description) },
      { header: "Date", render: (expense) => escapePdfHtml(expense.spentAt) },
      { header: "Montant", render: (expense) => escapePdfHtml(formatCurrencyMoney(expense.amount, currency)) },
    ], (rows as Expense[]).filter((expense) => resolveSchoolCurrency(schoolById.get(expense.schoolId) ?? {}) === currency), "Aucune dépense dans cette devise.")));

  await renderAcadPdfPreview({
    filename: `coordination-${source}-${kind}-${selectedSchoolId || "toutes"}.pdf`,
    title: `${kind === "payments" ? "Paiements" : "Dépenses"} — Coordination`,
    school: coordinationPdfInstitution(coordination, contextSchool),
    subtitle: `${selectedSchoolId ? contextSchool.name : "Toutes les écoles"} | ${filtersLabel}`,
    sections,
  });
}
