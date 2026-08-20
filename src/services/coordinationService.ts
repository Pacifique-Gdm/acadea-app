import { getCurrentFirebaseIdToken } from "./auth";
import { resolveApiUrl } from "../config/apiUrl";
import type { Coordination, AppUser } from "../types";

type CoordinationInput = { name: string; code?: string; phone?: string; email?: string; address?: string; schoolIds: string[]; coordinator: { name: string; email: string; password: string } };
type CoordinationResponse = { coordination: Coordination; coordinator: AppUser; schoolIds: string[] };

async function call(input: Record<string, unknown>) {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch(resolveApiUrl("/api/manage-coordination"), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Opération Coordination impossible.");
  return payload;
}

export async function createCoordination(input: CoordinationInput) { return call({ action: "create", ...input }) as Promise<CoordinationResponse>; }
export async function addCoordinationSchool(coordinationId: string, schoolId: string) { return call({ action: "add-school", coordinationId, schoolId }); }
export async function removeCoordinationSchool(coordinationId: string, schoolId: string) { return call({ action: "remove-school", coordinationId, schoolId }); }
