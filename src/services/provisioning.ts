import { getCurrentFirebaseIdToken } from "./auth";
import type { AppUser, AuditLog, School, SchoolYear } from "../types";

type ProvisionSchoolAdminInput = {
  schoolName: string;
  adminEmail: string;
  adminPassword: string;
  subscriptionPlan: School["subscriptionPlan"];
};

type ProvisionSchoolAdminResponse = {
  school: School;
  schoolYear: SchoolYear;
  adminUser: AppUser;
  auditLog: AuditLog;
};

export async function provisionSchoolAdmin(input: ProvisionSchoolAdminInput) {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch("/api/provision-school-admin", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const payload = (await response.json().catch(() => ({}))) as Partial<ProvisionSchoolAdminResponse> & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "Provisionnement impossible.");
  }

  if (!payload.school || !payload.schoolYear || !payload.adminUser || !payload.auditLog) {
    throw new Error("Réponse de provisionnement incomplète.");
  }

  return payload as ProvisionSchoolAdminResponse;
}
