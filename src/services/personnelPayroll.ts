import { resolveApiUrl } from "../config/apiUrl";
import { getCurrentFirebaseIdToken } from "./auth";
import { apiErrorMessage } from "../utils/rateLimitErrors";
import type { PersonnelPayment } from "../types";

export type PayrollBeneficiary = { id: string; name: string; jobTitle: string; hasAccount: boolean };
export type PayrollHistoryCursor = { paidAt: string; id: string };
export type PayrollHistoryEntry = PersonnelPayment & { updatedAt?: string };
export type PayrollCashBalance = { schoolId: string; schoolYearId: string; currency: "CDF" | "USD"; availableCents: number; receivedCents: number; spentCents: number };

export class PayrollCashError extends Error {
  constructor(message: string, readonly code: string, readonly balance?: PayrollCashBalance, readonly requestedCents?: number, readonly shortfallCents?: number) {
    super(message);
  }
}

async function request(body: Record<string, unknown>) {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch(resolveApiUrl("/api/manage-financial-transaction"), {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as { error?: string; code?: string; personnel?: PayrollBeneficiary[]; advances?: PersonnelPayment[]; payments?: PersonnelPayment[]; payment?: PersonnelPayment; nextCursor?: PayrollHistoryCursor | null;
    schoolId?: string; schoolYearId?: string; currency?: "CDF" | "USD"; availableCents?: number; receivedCents?: number; spentCents?: number; requestedCents?: number; shortfallCents?: number };
  if (!response.ok) {
    const balance = typeof payload.availableCents === "number" && payload.schoolId && payload.schoolYearId && payload.currency
      ? { schoolId: payload.schoolId, schoolYearId: payload.schoolYearId, currency: payload.currency, availableCents: payload.availableCents,
        receivedCents: payload.receivedCents ?? 0, spentCents: payload.spentCents ?? 0 } : undefined;
    throw new PayrollCashError(apiErrorMessage(response.status, payload, "Paiement du personnel impossible."), payload.code ?? "internal", balance, payload.requestedCents, payload.shortfallCents);
  }
  return payload;
}

export async function loadPayrollCashBalance(schoolYearId: string): Promise<PayrollCashBalance> {
  const result = await request({ action: "list-payroll-cash-balance", schoolYearId });
  if (!result.schoolId || result.schoolYearId !== schoolYearId || !result.currency || typeof result.availableCents !== "number" || !Number.isSafeInteger(result.availableCents)
    || typeof result.receivedCents !== "number" || !Number.isSafeInteger(result.receivedCents)
    || typeof result.spentCents !== "number" || !Number.isSafeInteger(result.spentCents)) throw new Error("Solde de caisse incomplet.");
  return { schoolId: result.schoolId, schoolYearId, currency: result.currency, availableCents: result.availableCents,
    receivedCents: result.receivedCents, spentCents: result.spentCents };
}

export async function listPayrollPersonnel() {
  const result = await request({ action: "list-payroll-personnel" });
  if (!Array.isArray(result.personnel)) throw new Error("Liste du personnel incomplète.");
  return result.personnel;
}

export async function listPayrollAdvances(beneficiaryId: string) {
  const result = await request({ action: "list-payroll-advances", beneficiaryId });
  if (!Array.isArray(result.advances)) throw new Error("Liste des avances incomplète.");
  return result.advances;
}

export async function listPersonnelPayments(beneficiaryId: string) {
  const result = await request({ action: "list-personnel-payments", beneficiaryId });
  if (!Array.isArray(result.payments)) throw new Error("Liste des paiements incomplète.");
  return result.payments;
}

export async function listOwnPayroll() {
  const result = await request({ action: "list-own-payroll" });
  if (!Array.isArray(result.payments)) throw new Error("Liste des paiements incomplète.");
  return result.payments;
}

export async function listPayrollHistoryPage(schoolId = "", cursor?: PayrollHistoryCursor, dates: { startDate?: string; endDate?: string } = {}) {
  const result = await request({ action: "list-payroll-history", ...(schoolId ? { schoolId } : {}), ...(cursor ? { cursor } : {}),
    ...(dates.startDate ? { startDate: dates.startDate } : {}), ...(dates.endDate ? { endDate: dates.endDate } : {}) });
  if (!Array.isArray(result.payments)) throw new Error("Historique de paie incomplet.");
  return { payments: result.payments as PayrollHistoryEntry[], nextCursor: result.nextCursor ?? null };
}

export async function createPersonnelPayment(input: {
  schoolYearId: string; beneficiaryId: string; kind: PersonnelPayment["kind"]; periodMonth?: number; periodYear?: number;
  paidAt: string; amount: number; recoveries: Array<{ advanceId: string; amount: number }>;
  deduction: number; deductionReason: string; cnss: number; tax: number; description: string; clientRequestId: string;
}) {
  const result = await request({ action: "create-personnel-payment", ...input });
  if (!result.payment) throw new Error("Paiement du personnel incomplet.");
  return result.payment;
}

export async function updatePersonnelPayment(input: { paymentId: string; amount: number; deduction?: number; deductionReason?: string; cnss?: number; tax?: number;
  description?: string; paidAt?: string; periodMonth?: number; periodYear?: number; reason: string; confirmation: string; expectedUpdatedAt: string; clientRequestId: string }) {
  const result = await request({ action: "update-personnel-payment", ...input });
  if (!result.payment) throw new Error("Correction du paiement du personnel incomplète.");
  return result.payment;
}
