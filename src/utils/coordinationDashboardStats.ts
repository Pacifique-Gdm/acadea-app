import type { AppUser, Expense, FeeType, Payment, School, SchoolSection, SchoolYear, Student } from "../types";
import { buildDashboardFeeShares, buildDashboardFinancialAggregates } from "./dashboardStats";
import type { DashboardFeeProgressRow, DashboardFeeShare } from "./dashboardStats";
import { buildDashboardClassRows } from "./dashboardClassStats";
import { getClassSection } from "./studentClasses";

export type DashboardCurrency = "USD" | "CDF";

export type CoordinationDashboardModel = {
  students: Student[];
  feeTypes: FeeType[];
  payments: Payment[];
  expenses: Expense[];
  personnel: AppUser[];
  schoolYears: SchoolYear[];
};

export type CoordinationDashboardClassRow = {
  schoolId: string;
  schoolName: string;
  className: string;
  girls: number;
  boys: number;
  total: number;
};

export type CoordinationDashboardFinancialGroup = {
  currency: DashboardCurrency;
  expected: number;
  paid: number;
  expenses: number;
  remaining: number;
  recoveryRate: number;
  feeProgressRows: DashboardFeeProgressRow[];
  feeShares: DashboardFeeShare[];
  payments: Payment[];
  expenseRows: Expense[];
};

export type CoordinationDashboardStats = {
  alignedSchoolIds: string[];
  excludedSchoolIds: string[];
  students: Student[];
  feeTypes: FeeType[];
  payments: Payment[];
  expenses: Expense[];
  totalStudents: number;
  totalClasses: number;
  totalParents: number;
  administrators: number;
  cashiers: number;
  disciplineDirectors: number;
  classRows: CoordinationDashboardClassRow[];
  totalGirls: number;
  totalBoys: number;
  financialGroups: CoordinationDashboardFinancialGroup[];
};

export type CoordinationDashboardFilters = {
  referenceSchoolYear?: string;
  section?: "all" | SchoolSection;
  dateFilterActive?: boolean;
  startDate?: string;
  endDate?: string;
};

function uniqueBySchoolAndId<T extends { id: string; schoolId: string }>(rows: T[]) {
  return [...new Map(rows.map((row) => [`${row.schoolId}:${row.id}`, row])).values()];
}

function isDateInRange(value: string, filters: CoordinationDashboardFilters) {
  if (!filters.dateFilterActive) return true;
  const date = value.slice(0, 10);
  return (!filters.startDate || date >= filters.startDate) && (!filters.endDate || date <= filters.endDate);
}

function mergeFeeRows(groups: DashboardFeeProgressRow[][]) {
  const rows = new Map<string, { name: string; expected: number; paid: number }>();
  groups.flat().forEach((row) => {
    const key = row.name.trim().toLocaleLowerCase("fr");
    const current = rows.get(key) ?? { name: row.name, expected: 0, paid: 0 };
    rows.set(key, { name: current.name, expected: current.expected + row.expected, paid: current.paid + row.paid });
  });
  return [...rows.values()].map((row) => ({
    ...row,
    remaining: Math.max(row.expected - row.paid, 0),
    rate: row.expected > 0 ? Math.round((row.paid / row.expected) * 100) : 0,
  }));
}

export function buildCoordinationDashboardStats(
  schools: School[],
  model: CoordinationDashboardModel,
  filters: CoordinationDashboardFilters = {},
): CoordinationDashboardStats {
  const schoolById = new Map(schools.map((school) => [school.id, school]));
  const yearsById = new Map(model.schoolYears.map((year) => [year.id, year]));
  const effectiveReferenceYear = filters.referenceSchoolYear || yearsById.get(schools[0]?.activeSchoolYearId ?? "")?.name;
  const alignedSchools = schools.filter((school) => {
    const activeYear = yearsById.get(school.activeSchoolYearId);
    if (!activeYear || activeYear.schoolId !== school.id) return false;
    return !effectiveReferenceYear || activeYear.name === effectiveReferenceYear;
  });
  const alignedSchoolIds = new Set(alignedSchools.map((school) => school.id));
  const activeYearBySchoolId = new Map(alignedSchools.map((school) => [school.id, school.activeSchoolYearId]));
  const inActiveYear = (row: { schoolId: string; schoolYearId: string }) => alignedSchoolIds.has(row.schoolId) && activeYearBySchoolId.get(row.schoolId) === row.schoolYearId;

  const allStudents = uniqueBySchoolAndId(model.students.filter(inActiveYear))
    .filter((student) => (student.status ?? "ACTIVE") === "ACTIVE");
  const students = allStudents.filter((student) => !filters.section || filters.section === "all" || getClassSection(student.className) === filters.section);
  const studentKeys = new Set(students.map((student) => `${student.schoolId}:${student.id}`));
  const feeTypes = uniqueBySchoolAndId(model.feeTypes.filter(inActiveYear));
  const payments = uniqueBySchoolAndId(model.payments.filter(inActiveYear))
    .filter((payment) => studentKeys.has(`${payment.schoolId}:${payment.studentId}`) && isDateInRange(payment.paidAt, filters));
  const expenses = filters.section && filters.section !== "all"
    ? []
    : uniqueBySchoolAndId(model.expenses.filter(inActiveYear)).filter((expense) => isDateInRange(expense.spentAt, filters));
  const personnel = [...new Map(model.personnel.filter((person) => person.schoolId && schoolById.has(person.schoolId)).map((person) => [`${person.schoolId}:${person.id}`, person])).values()];

  const classRows = buildDashboardClassRows(students, (schoolId) => schoolById.get(schoolId)?.name ?? schoolId) as CoordinationDashboardClassRow[];

  const financialGroups = (["USD", "CDF"] as DashboardCurrency[]).flatMap((currency) => {
    const currencySchools = alignedSchools.filter((school) => (school.currency ?? "USD") === currency);
    if (currencySchools.length === 0) return [];
    const schoolAggregates = currencySchools.map((school) => {
      const schoolStudents = students.filter((student) => student.schoolId === school.id);
      const schoolFees = feeTypes.filter((fee) => fee.schoolId === school.id);
      const schoolPayments = payments.filter((payment) => payment.schoolId === school.id);
      return buildDashboardFinancialAggregates(schoolStudents, schoolFees, schoolPayments);
    });
    const feeProgressRows = mergeFeeRows(schoolAggregates.map((item) => item.feeProgressRows));
    const expected = schoolAggregates.reduce((sum, item) => sum + item.financialStats.expected, 0);
    const paid = schoolAggregates.reduce((sum, item) => sum + item.financialStats.paid, 0);
    const expenseRows = expenses.filter((expense) => (schoolById.get(expense.schoolId)?.currency ?? "USD") === currency);
    return [{
      currency,
      expected,
      paid,
      expenses: expenseRows.reduce((sum, expense) => sum + expense.amount, 0),
      remaining: Math.max(expected - paid, 0),
      recoveryRate: expected > 0 ? Math.round((paid / expected) * 100) : 0,
      feeProgressRows,
      feeShares: buildDashboardFeeShares(feeProgressRows),
      payments: payments.filter((payment) => (schoolById.get(payment.schoolId)?.currency ?? "USD") === currency),
      expenseRows,
    }];
  });

  return {
    alignedSchoolIds: [...alignedSchoolIds],
    excludedSchoolIds: schools.filter((school) => !alignedSchoolIds.has(school.id)).map((school) => school.id),
    students,
    feeTypes,
    payments,
    expenses,
    totalStudents: students.length,
    totalClasses: new Set(students.map((student) => `${student.schoolId}:${student.className}`)).size,
    totalParents: new Set(students.flatMap((student) => student.parentId ? [`${student.schoolId}:${student.parentId}`] : [])).size,
    administrators: personnel.filter((person) => person.role === "school_admin" || (person.role as string) === "admin").length,
    cashiers: personnel.filter((person) => person.role === "cashier").length,
    disciplineDirectors: personnel.filter((person) => person.role === "discipline_director").length,
    classRows,
    totalGirls: classRows.reduce((sum, row) => sum + row.girls, 0),
    totalBoys: classRows.reduce((sum, row) => sum + row.boys, 0),
    financialGroups,
  };
}
