import { getCurrentFirebaseIdToken } from "./auth";
import type { AppUser, AuditLog, ParentProfile, School, SchoolSection, SchoolYear } from "../types";
import { resolveApiUrl } from "../config/apiUrl";
import { apiErrorMessage } from "../utils/rateLimitErrors";

type ProvisionSchoolAdminInput = {
  schoolName: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  subscriptionPlan?: School["subscriptionPlan"];
  educationLevels?: string[];
  schoolType?: School["schoolType"];
  schoolOptions?: string[];
  currency?: "USD" | "CDF";
};

type ProvisionSchoolAdminResponse = {
  school: School;
  schoolYear: SchoolYear;
  adminUser: AppUser;
  auditLog: AuditLog;
};

export async function provisionSchoolAdmin(input: ProvisionSchoolAdminInput) {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch(resolveApiUrl("/api/provision-school-admin"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const payload = (await response.json().catch(() => ({}))) as Partial<ProvisionSchoolAdminResponse> & { error?: string; code?: string; details?: string };
  if (!response.ok) {
    const message = apiErrorMessage(response.status, payload, "Provisionnement impossible.");
    const diagnostic = [payload.code, payload.details].filter(Boolean).join(" — ");
    throw new Error(diagnostic ? `${message} Détail serveur : ${diagnostic}` : message);
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

type ProvisionSchoolUserInput = ProvisionCashierInput & {
  role: "school_admin" | "cashier" | "discipline_director" | "study_director" | "secretary" | "teacher";
  section?: SchoolSection;
  sectionIds?: SchoolSection[];
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

function getProvisionEndpointUrl(endpoint: string) {
  const resolvedEndpoint = resolveApiUrl(endpoint);
  return typeof window === "undefined" ? resolvedEndpoint : new URL(resolvedEndpoint, window.location.origin).href;
}

async function provisionSchoolAccount<TResponse>(input: Record<string, unknown>, options?: { showEndpointOnNotFound?: boolean }) {
  const token = await getCurrentFirebaseIdToken();
  const endpoint = "/api/provision-school-account";
  const endpointUrl = getProvisionEndpointUrl(endpoint);
  const response = await fetch(resolveApiUrl(endpoint), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const payload = (await response.json().catch(() => ({}))) as TResponse & { error?: string; code?: string; details?: string };
  if (!response.ok) {
    if (response.status === 404 && options?.showEndpointOnNotFound) {
      throw new Error(`Endpoint API introuvable (HTTP 404) : ${endpointUrl}. Lancez l'application avec npx vercel dev pour activer les routes /api.`);
    }
    const message = apiErrorMessage(response.status, payload, "Provisionnement impossible.");
    const diagnostic = [payload.code, payload.details].filter(Boolean).join(" — ");
    throw new Error(diagnostic ? `${message} Détail serveur : ${diagnostic}` : message);
  }

  return payload;
}

export async function provisionSchoolUser(input: ProvisionSchoolUserInput) {
  const payload = await provisionSchoolAccount<{ user?: AppUser }>({
    ...input,
  }, { showEndpointOnNotFound: true });

  if (!payload.user) {
    throw new Error("Reponse de provisionnement utilisateur incomplete.");
  }

  return payload.user;
}

export async function provisionCashier(input: ProvisionCashierInput) {
  return provisionSchoolUser({ role: "cashier", ...input });
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

type DeleteParentAccountInput = {
  schoolId: string;
  parentId: string;
  confirmation: string;
};

export type DeleteParentAccountResponse = {
  status: "complete" | "partial";
  parentId: string;
  authUid?: string;
  authStatus: "deleted" | "already-missing" | "failed" | "skipped" | "missing-uid";
  authError?: string;
  firestoreDeletedCount: number;
  firestoreUpdatedCount: number;
};

export async function deleteParentAccount(input: DeleteParentAccountInput) {
  const payload = await provisionSchoolAccount<DeleteParentAccountResponse & { error?: string }>({
    action: "delete-parent",
    ...input,
  }, { showEndpointOnNotFound: true });

  if (!payload.parentId || !payload.status) {
    throw new Error("Reponse de suppression parent incomplete.");
  }

  return payload;
}

export type ArchivedStudentsImportStatus = {
  status: "empty" | "ready" | "partial" | "legacy-incomplete" | "complete";
  sourceCount: number; uniqueCount?: number; importedCount: number; existingCount: number;
  remaining: number; complete: boolean; sourceYearId: string; schoolYearId: string;
  phase?: string;
  promotedCount?: number;
  terminalExitCount?: number;
  schoolCycleExitCount?: number;
  skippedCount?: number;
  importedCollections?: Record<string, number>;
};

export async function requestArchivedStudentsImport(input: {
  schoolId: string; schoolYearId: string; sourceYearId: string;
  mode: "inspect" | "import"; confirmation?: string;
}) {
  return provisionSchoolAccount<ArchivedStudentsImportStatus>({ action: "import-archived-students", ...input });
}

export type TerminalStudentReenrollmentStatus = {
  status: "ready" | "reenrolled" | "already-reenrolled";
  created: boolean;
  sourceStudentId: string;
  targetStudentId: string;
  schoolYearId: string;
};

export async function requestTerminalStudentReenrollment(input: {
  schoolId: string;
  sourceStudentId: string;
  mode: "inspect" | "reenroll";
  confirmation?: string;
}) {
  return provisionSchoolAccount<TerminalStudentReenrollmentStatus>({ action: "reenroll-terminal-student", ...input });
}

export type UnlinkParentFromStudentInput = {
  schoolId: string;
  schoolYearId: string;
  studentId: string;
  parentId: string;
  confirmation: string;
};

export type UnlinkParentFromStudentResponse = {
  studentId: string;
  parentId: string;
  parentStudentIds: string[];
  auditLogId: string;
};

export async function unlinkParentFromStudent(input: UnlinkParentFromStudentInput) {
  const payload = await provisionSchoolAccount<UnlinkParentFromStudentResponse & { error?: string }>({
    action: "unlink-parent-from-student",
    ...input,
  }, { showEndpointOnNotFound: true });

  if (payload.studentId !== input.studentId
    || payload.parentId !== input.parentId
    || !Array.isArray(payload.parentStudentIds)
    || !payload.auditLogId) {
    throw new Error("Réponse de déliaison parent incomplète.");
  }

  return payload;
}

type RemoveSchoolAdminInput = {
  schoolId: string;
  adminId: string;
  confirmation: string;
};

export type RemoveSchoolAdminResponse = {
  adminId: string;
  status: "inactive";
  authStatus: "disabled";
  removedAt: string;
};

export async function removeSchoolAdmin(input: RemoveSchoolAdminInput) {
  const payload = await provisionSchoolAccount<RemoveSchoolAdminResponse & { error?: string }>({
    action: "remove-school-admin",
    ...input,
  }, { showEndpointOnNotFound: true });

  if (!payload.adminId || payload.status !== "inactive" || payload.authStatus !== "disabled" || !payload.removedAt) {
    throw new Error("Reponse de retrait administrateur incomplete.");
  }

  return payload;
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
  const response = await fetch(resolveApiUrl("/api/manage-school"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const payload = (await response.json().catch(() => ({}))) as ManageSchoolResponse & { error?: string; code?: string; details?: string };
  if (!response.ok) {
    const message = apiErrorMessage(response.status, payload, "Operation ecole impossible.");
    const diagnostic = [payload.code, payload.details].filter(Boolean).join(" — ");
    throw new Error(diagnostic ? `${message} Detail serveur : ${diagnostic}` : message);
  }

  return payload;
}
