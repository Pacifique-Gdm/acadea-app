/**
 * Exemple additif pour un futur backend Node/Prisma.
 * Non importé par l'application Vite actuelle afin de préserver la stabilité.
 *
 * GET /api/reports?startDate=2026-06-01&endDate=2026-06-30&schoolId=...&academicYearId=...&type=range
 */

type ReportQuery = {
  startDate: string;
  endDate: string;
  schoolId: string;
  academicYearId: string;
  type: "daily" | "range";
};

type PrismaLike = {
  payment: {
    aggregate: (args: unknown) => Promise<{ _sum: { amount: number | null } }>;
    findMany: (args: unknown) => Promise<unknown[]>;
  };
  expense: {
    aggregate: (args: unknown) => Promise<{ _sum: { amount: number | null } }>;
    findMany: (args: unknown) => Promise<unknown[]>;
  };
  feeType: {
    aggregate: (args: unknown) => Promise<{ _sum: { amount: number | null } }>;
  };
  student: {
    count: (args: unknown) => Promise<number>;
  };
};

export async function getReports(prisma: PrismaLike, query: ReportQuery) {
  const where = {
    schoolId: query.schoolId,
    academicYearId: query.academicYearId,
    createdAt: {
      gte: new Date(query.startDate),
      lte: new Date(`${query.endDate}T23:59:59.999Z`),
    },
  };

  const [paymentsTotal, expensesTotal, payments, expenses, feeTotal, studentCount] = await Promise.all([
    prisma.payment.aggregate({ where, _sum: { amount: true } }),
    prisma.expense.aggregate({ where, _sum: { amount: true } }),
    prisma.payment.findMany({
      where,
      select: { id: true, studentId: true, amount: true, feeType: true, receiptNumber: true, cashierName: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.expense.findMany({
      where,
      select: { id: true, amount: true, category: true, description: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.feeType.aggregate({ where: { schoolId: query.schoolId, academicYearId: query.academicYearId }, _sum: { amount: true } }),
    prisma.student.count({ where: { schoolId: query.schoolId, academicYearId: query.academicYearId, status: "ACTIVE" } }),
  ]);

  const paymentAmount = paymentsTotal._sum.amount ?? 0;
  const expenseAmount = expensesTotal._sum.amount ?? 0;
  const expected = (feeTotal._sum.amount ?? 0) * studentCount;

  return {
    summary: {
      payments: paymentAmount,
      expenses: expenseAmount,
      netBalance: paymentAmount - expenseAmount,
      expected,
      remaining: Math.max(expected - paymentAmount, 0),
      recoveryRate: expected > 0 ? Math.round((paymentAmount / expected) * 100) : 0,
      type: query.type,
    },
    payments,
    expenses,
  };
}
