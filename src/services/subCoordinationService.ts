import { resolveApiUrl } from "../config/apiUrl";
import type { AppUser, SubCoordination } from "../types";
import { normalizeEmailDomainLabel } from "../utils/schoolAccountCredentials";
import { getCurrentFirebaseIdToken } from "./auth";

export type CreateSubCoordinationInput = {
  circumscription: string;
  schoolIds: string[];
  coordinator: {
    lastName: string;
    middleName?: string;
    firstName?: string;
    phone: string;
    email: string;
    password: string;
  };
};

type CreateSubCoordinationResponse = {
  subCoordination: SubCoordination;
  coordinator: AppUser;
  schoolIds: string[];
};

async function call<T>(input: Record<string, unknown>) {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch(resolveApiUrl("/api/manage-coordination"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Opération Sous-coordination impossible.");
  return payload;
}

export function nextSubCoordinationEmail(coordinationName: string, users: AppUser[]) {
  const domain = `${normalizeEmailDomainLabel(coordinationName) || "acadea"}.com`;
  const existing = new Set(users.map((user) => user.email.trim().toLowerCase()));
  let number = 1;
  while (existing.has(`subcoord${String(number).padStart(3, "0")}@${domain}`)) number += 1;
  return `subcoord${String(number).padStart(3, "0")}@${domain}`;
}

export function createSubCoordination(input: CreateSubCoordinationInput) {
  return call<CreateSubCoordinationResponse>({ action: "create-sub-coordination", ...input });
}

export function addSubCoordinationSchool(subCoordinationId: string, schoolId: string) {
  return call({ action: "add-sub-school", subCoordinationId, schoolId });
}

export function removeSubCoordinationSchool(subCoordinationId: string, schoolId: string) {
  return call({ action: "remove-sub-school", subCoordinationId, schoolId });
}

export function transferSubCoordinationSchool(subCoordinationId: string, targetSubCoordinationId: string, schoolId: string) {
  return call({ action: "transfer-sub-school", subCoordinationId, targetSubCoordinationId, schoolId });
}

export function archiveSubCoordination(subCoordinationId: string) {
  return call({ action: "archive-sub-coordination", subCoordinationId });
}

export function reactivateSubCoordination(subCoordinationId: string) {
  return call({ action: "reactivate-sub-coordination", subCoordinationId });
}
