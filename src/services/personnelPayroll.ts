import { resolveApiUrl } from "../config/apiUrl";
import { getCurrentFirebaseIdToken } from "./auth";
import { apiErrorMessage } from "../utils/rateLimitErrors";
import type { PersonnelPayment } from "../types";

export type PayrollBeneficiary = { id: string; name: string; jobTitle: string; hasAccount: boolean };

async function request(body: Record<string, unknown>) {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch(resolveApiUrl("/api/manage-financial-transaction"), {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as { error?: string; code?: string; personnel?: PayrollBeneficiary[]; advances?: PersonnelPayment[]; payments?: PersonnelPayment[]; payment?: PersonnelPayment };
  if (!response.ok) throw new Error(apiErrorMessage(response.status, payload, "Paiement du personnel impossible."));
  return payload;
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

export async function createPersonnelPayment(input: {
  schoolYearId: string; beneficiaryId: string; kind: PersonnelPayment["kind"]; periodMonth?: number; periodYear?: number;
  paidAt: string; amount: number; recoveries: Array<{ advanceId: string; amount: number }>;
  deduction: number; deductionReason: string; cnss: number; tax: number; description: string; clientRequestId: string;
}) {
  const result = await request({ action: "create-personnel-payment", ...input });
  if (!result.payment) throw new Error("Paiement du personnel incomplet.");
  return result.payment;
}
