import { resolveApiUrl } from "../config/apiUrl";
import { getCurrentFirebaseIdToken } from "./auth";
import type { AuditLog, FeeType } from "../types";

export type FeeTypeSaveRequest = { schoolYearId: string; requestId: string; editingFeeId?: string; fees: Pick<FeeType, "id" | "name" | "amount" | "className" | "classOptionKey">[] };
export type FeeTypeSaveResult = { fees: FeeType[]; audit: AuditLog; idempotent: boolean };

export class FeeTypeSaveError extends Error {
  constructor(message: string, readonly confirmed: boolean) { super(message); }
}

export async function saveFeeTypes(request: FeeTypeSaveRequest): Promise<FeeTypeSaveResult> {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch(resolveApiUrl("/api/manage-fee-type"), {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(request),
  });
  const payload = await response.json().catch(() => ({})) as Partial<FeeTypeSaveResult> & { error?: string; code?: string };
  if (!response.ok) {
    const confirmed = [400, 401, 403, 409].includes(response.status);
    throw new FeeTypeSaveError(payload.error ?? "Enregistrement du type de frais non confirmé.", confirmed);
  }
  if (!Array.isArray(payload.fees) || !payload.audit) throw new FeeTypeSaveError("Réponse serveur incomplète. Vérifiez l'enregistrement avant toute nouvelle saisie.", false);
  return payload as FeeTypeSaveResult;
}
