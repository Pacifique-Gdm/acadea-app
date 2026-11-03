import { resolveApiUrl } from "../config/apiUrl";
import { getCurrentFirebaseIdToken } from "./auth";
import type { AuditLog, FeeType } from "../types";

export type FeeTypeSaveRequest = { schoolYearId: string; requestId: string; editingFeeId?: string; fees: Pick<FeeType, "id" | "name" | "amount" | "className" | "classOptionKey">[] };
export type FeeTypeSaveResult = { fees: FeeType[]; audit: AuditLog; idempotent: boolean };
export type FeeKindAddRequest = { schoolYearId: string; requestId: string; name: string };
export type FeeKindAddResult = { name: string; customFeeKindChoices: string[]; idempotent: boolean };

export class FeeTypeSaveError extends Error {
  constructor(message: string, readonly confirmed: boolean, readonly status?: number, readonly code?: string) { super(message); }
}

async function sendFeeRequest(action: "save-fee-types" | "add-fee-kind", request: FeeTypeSaveRequest | FeeKindAddRequest) {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch(resolveApiUrl("/api/manage-financial-transaction"), {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, ...request }),
  });
  const payload = await response.json().catch(() => ({})) as Partial<FeeTypeSaveResult & FeeKindAddResult> & { error?: string; code?: string };
  if (!response.ok) {
    const confirmed = [400, 401, 403, 409, 429].includes(response.status);
    throw new FeeTypeSaveError(payload.error ?? "Enregistrement du type de frais non confirmé.", confirmed, response.status, payload.code);
  }
  return payload;
}

export async function addFeeKind(request: FeeKindAddRequest): Promise<FeeKindAddResult> {
  const payload = await sendFeeRequest("add-fee-kind", request);
  if (typeof payload.name !== "string" || !Array.isArray(payload.customFeeKindChoices) || payload.customFeeKindChoices.some(item => typeof item !== "string")) throw new FeeTypeSaveError("Réponse serveur incomplète. Vérifiez la même demande avant de recréer ce libellé.", false);
  return payload as FeeKindAddResult;
}

export async function saveFeeTypes(request: FeeTypeSaveRequest): Promise<FeeTypeSaveResult> {
  const payload = await sendFeeRequest("save-fee-types", request);
  if (!Array.isArray(payload.fees) || !payload.audit) throw new FeeTypeSaveError("Réponse serveur incomplète. Vérifiez l'enregistrement avant toute nouvelle saisie.", false);
  return payload as FeeTypeSaveResult;
}
