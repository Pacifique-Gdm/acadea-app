import { getCurrentFirebaseIdToken } from "./auth";
import type { AppUser, AuditLog, ParentProfile, School, SchoolYear } from "../types";

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

type ProvisionCashierInput = {
  schoolId: string;
  schoolYearId: string;
  name: string;
  email: string;
  password: string;
  phone: string;
};

type ProvisionParentInput = {
  schoolId: string;
  schoolYearId: string;
  parentId?: string;
  name: string;
  email: string;
  password: string;
  phone: string;
  address: string;
  studentIds: string[];
  status: ParentProfile["status"];
};

async function provisionSchoolAccount<TResponse>(input: Record<string, unknown>) {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch("/api/provision-school-account", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const payload = (await response.json().catch(() => ({}))) as TResponse & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "Provisionnement impossible.");
  }

  return payload;
}

export async function provisionCashier(input: ProvisionCashierInput) {
  const payload = await provisionSchoolAccount<{ user?: AppUser }>({
    role: "cashier",
    ...input,
  });

  if (!payload.user) {
    throw new Error("Reponse de provisionnement caissier incomplete.");
  }

  return payload.user;
}

export async function provisionParent(input: ProvisionParentInput) {
  const payload = await provisionSchoolAccount<{ parent?: ParentProfile; user?: AppUser }>({
    role: "parent",
    ...input,
  });

  if (!payload.parent || !payload.user) {
    throw new Error("Reponse de provisionnement parent incomplete.");
  }

  return { parent: payload.parent, user: payload.user };
}

type ManageSchoolAction = "update" | "suspend" | "reactivate" | "delete";

type ManageSchoolInput = {
  action: ManageSchoolAction;
  schoolId: string;
  patch?: Partial<School>;
  confirmation?: string;
};

type ManageSchoolResponse = {
  school?: School;
  schoolId?: string;
  deletedCount?: number;
};

export async function manageSchool(input: ManageSchoolInput) {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch("/api/manage-school", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const payload = (await response.json().catch(() => ({}))) as ManageSchoolResponse & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "Operation ecole impossible.");
  }

  return payload;
}
