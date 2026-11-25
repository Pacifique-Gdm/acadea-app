// Lot 3 : enfants à la charge du membre du personnel connecté, lus par le serveur (aucune lecture directe des paiements).
import type { FeeType, Payment, Student } from "../types";
import { getCurrentFirebaseIdToken } from "./auth";
import { resolveApiUrl } from "../config/apiUrl";

export type StaffChildDecision = {
  id: string;
  reason: string;
  nature: "full" | "percent" | "fixed" | string;
  lines: Record<string, { feeName?: string; value?: number; officialMinor?: number; reductionMinor?: number }>;
};
export type StaffChild = { student: Student; decision: StaffChildDecision; payments: Payment[] };
export type StaffChildrenResult = { children: StaffChild[]; feeTypes: FeeType[]; currency: "USD" | "CDF"; schoolYearId?: string };

export async function loadStaffChildren(): Promise<StaffChildrenResult> {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch(resolveApiUrl("/api/manage-financial-transaction"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "list-staff-children" }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? "Chargement de vos enfants impossible.");
  return {
    children: Array.isArray(result.children) ? result.children : [],
    feeTypes: Array.isArray(result.feeTypes) ? result.feeTypes : [],
    currency: result.currency === "CDF" ? "CDF" : "USD",
    schoolYearId: typeof result.schoolYearId === "string" ? result.schoolYearId : undefined,
  };
}

/** Ce que l'enfant paie selon la décision de l'administrateur : rien, la moitié, ou une réduction. */
export function staffChildSupportLabel(decision: Pick<StaffChildDecision, "nature" | "lines">): string {
  if (decision.nature === "full") return "Prise en charge : rien à payer";
  const values = Object.values(decision.lines ?? {}).map((line) => line.value);
  if (decision.nature === "percent" && values.length > 0 && values.every((value) => value === 50)) return "Prise en charge : la moitié";
  if (decision.nature === "percent" && values.length > 0 && values.every((value) => value === 100)) return "Prise en charge : rien à payer";
  return "Prise en charge : réduction accordée";
}
