export class FinancialApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string);
}

export type FinancialOperationResult = {
  payment?: {
    id: string;
    schoolId: string;
    schoolYearId: string;
    studentId: string;
    feeTypeId: string;
    amount: number;
    receiptNumber: string;
    [key: string]: unknown;
  };
  expense?: {
    id: string;
    schoolId: string;
    schoolYearId: string;
    amount: number;
    [key: string]: unknown;
  };
  deletedId?: string;
  kind?: "payment" | "expense";
  idempotent: boolean;
};

export function executeFinancialOperation(input: {
  db: unknown;
  caller: { uid: string; role?: unknown; schoolId?: unknown; email?: unknown };
  body: Record<string, unknown>;
  now?: string;
}): Promise<FinancialOperationResult>;
