import { getCurrentFirebaseIdToken } from "./auth";
import type { AppUser, AuditLog, ParentProfile, School, SchoolSection, SchoolYear, Student } from "../types";
import { resolveApiUrl } from "../config/apiUrl";
import { apiErrorMessage } from "../utils/rateLimitErrors";

// A lost HTTP response must not turn a confirmed creation into a second create.
// Kept only in memory; no password, token or request identifier is persisted locally.
const pendingCreationRequests = new Map<string, string>();
function requestIdFor(key: string) {
  let id = pendingCreationRequests.get(key);
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    pendingCreationRequests.set(key, id);
  }
  return id;
}

async function recoverCreation(endpoint: string, token: string, identity: Record<string, unknown>) {
  for (const delay of [0, 200, 500]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const response = await fetch(resolveApiUrl(endpoint), { method: "POST", headers: {
        Authorization: `Bearer ${token}`, "Content-Type": "application/json",
      }, body: JSON.stringify({ action: "recover-creation", ...identity }) });
      if (response.status === 202) continue;
      if (response.ok) return await response.json() as Record<string, unknown>;
      return null;
    } catch { /* The original request may still be finishing. */ }
  }
  return null;
}

const uncertainCreationMessage = "Réponse réseau perdue. La création peut déjà être confirmée par le serveur. Vérifiez la liste avant de réessayer ; aucun nouvel identifiant ne sera généré pour cette tentative.";

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
  const key = `school/${input.adminEmail.trim().toLowerCase()}`;
  const clientRequestId = requestIdFor(key);
  const identity = { clientRequestId, schoolName: input.schoolName, adminEmail: input.adminEmail };
  let response: Response;
  try { response = await fetch(resolveApiUrl("/api/provision-school-admin"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...input, clientRequestId }),
  }); } catch {
    const recovered = await recoverCreation("/api/provision-school-admin", token, identity);
    if (recovered?.school && recovered?.schoolYear && recovered?.adminUser && recovered?.auditLog) {
      pendingCreationRequests.delete(key);
      return recovered as ProvisionSchoolAdminResponse;
    }
    throw new Error(uncertainCreationMessage);
  }

  const payload = (await response.json().catch(() => ({}))) as Partial<ProvisionSchoolAdminResponse> & { error?: string; code?: string; details?: string };
  if (!response.ok) {
    if (response.status === 409 || response.status === 429 || response.status >= 500) {
      const recovered = await recoverCreation("/api/provision-school-admin", token, identity);
      if (recovered?.school && recovered?.schoolYear && recovered?.adminUser && recovered?.auditLog) {
        pendingCreationRequests.delete(key);
        return recovered as ProvisionSchoolAdminResponse;
      }
    }
    if (response.status < 500 && response.status !== 429) pendingCreationRequests.delete(key);
    const message = apiErrorMessage(response.status, payload, "Provisionnement impossible.");
    const diagnostic = [payload.code, payload.details].filter(Boolean).join(" — ");
    throw new Error(diagnostic ? `${message} Détail serveur : ${diagnostic}` : message);
  }

  if (!payload.school || !payload.schoolYear || !payload.adminUser || !payload.auditLog) {
    const recovered = await recoverCreation("/api/provision-school-admin", token, identity);
    if (recovered?.school && recovered?.schoolYear && recovered?.adminUser && recovered?.auditLog) {
      pendingCreationRequests.delete(key);
      return recovered as ProvisionSchoolAdminResponse;
    }
    throw new Error(uncertainCreationMessage);
  }

  pendingCreationRequests.delete(key);
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
  role: "kindergarten_admin" | "primary_admin" | "studies_prefect" | "school_admin" | "cashier" | "discipline_director" | "study_director" | "secretary" | "teacher";
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
  const role = typeof input.role === "string" ? input.role : "";
  const key = role ? JSON.stringify([role, input.schoolId, input.schoolYearId, String(input.email ?? "").trim().toLowerCase()]) : "";
  const clientRequestId = key ? requestIdFor(key) : "";
  const identity = { clientRequestId, role, schoolId: input.schoolId, schoolYearId: input.schoolYearId, email: input.email };
  let response: Response;
  try { response = await fetch(resolveApiUrl(endpoint), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(clientRequestId ? { ...input, clientRequestId } : input),
  }); } catch {
    const recovered = clientRequestId ? await recoverCreation(endpoint, token, identity) : null;
    if (recovered) { pendingCreationRequests.delete(key); return recovered as TResponse; }
    throw new Error(clientRequestId ? uncertainCreationMessage : "Connexion indisponible. L'opération n'a pas été confirmée par le serveur.");
  }

  const payload = (await response.json().catch(() => ({}))) as TResponse & { error?: string; code?: string; details?: string };
  if (!response.ok) {
    if (clientRequestId && (response.status === 409 || response.status === 429 || response.status >= 500)) {
      const recovered = await recoverCreation(endpoint, token, identity);
      if (recovered) { pendingCreationRequests.delete(key); return recovered as TResponse; }
    }
    if (key && response.status < 500 && response.status !== 429) pendingCreationRequests.delete(key);
    if (response.status === 404 && options?.showEndpointOnNotFound) {
      throw new Error(`Endpoint API introuvable (HTTP 404) : ${endpointUrl}. Lancez l'application avec npx vercel dev pour activer les routes /api.`);
    }
    const message = apiErrorMessage(response.status, payload, "Provisionnement impossible.");
    const diagnostic = [payload.code, payload.details].filter(Boolean).join(" — ");
    throw new Error(diagnostic ? `${message} Détail serveur : ${diagnostic}` : message);
  }

  if (clientRequestId && !Object.keys(payload).length) {
    const recovered = await recoverCreation(endpoint, token, identity);
    if (recovered) { pendingCreationRequests.delete(key); return recovered as TResponse; }
    throw new Error(uncertainCreationMessage);
  }
  if (key) pendingCreationRequests.delete(key);
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

export async function saveManualStudent(student: Student, intent: "create" | "update" = "create") {
  const key = `student/${student.schoolId}/${student.id}`;
  const clientRequestId = intent === "create" ? requestIdFor(key) : undefined;
  let payload: { student?: Student } | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      payload = await provisionSchoolAccount<{ student?: Student }>({ action: "save-manual-student", student, intent, ...(clientRequestId ? { clientRequestId } : {}) });
      break;
    } catch (cause) {
      if (!clientRequestId || !(cause instanceof Error) || !cause.message.includes("Connexion indisponible")) throw cause;
      if (attempt) throw new Error(uncertainCreationMessage);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  if (!payload?.student || payload.student.id !== student.id) throw new Error("Réponse d’enregistrement de l’élève incomplète.");
  if (clientRequestId) pendingCreationRequests.delete(key);
  return payload.student;
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

export async function requestSchoolSubclassDeletion(input: { schoolId: string; schoolYearId: string; subclassId: string; confirmation: string }) {
  const payload = await provisionSchoolAccount<{ subclassId?: string; updatedStudents?: number; status?: "deactivated" | "already-inactive" }>({
    action: "delete-school-subclass",
    ...input,
  }, { showEndpointOnNotFound: true });
  if (payload.subclassId !== input.subclassId || typeof payload.updatedStudents !== "number" || !payload.status) {
    throw new Error("Réponse de suppression de sous-classe incomplète.");
  }
  return payload;
}

export async function createSchoolSubclasses(input: { schoolId: string; schoolYearId: string; parentId: string; parentName: string; labels: string[]; classOptionKey?: string; confirmation: string }) {
  const payload = await provisionSchoolAccount<{ parentId?: string; subclassIds?: string[] }>({
    action: "create-school-subclasses",
    ...input,
  }, { showEndpointOnNotFound: true });
  if (payload.parentId !== input.parentId || !Array.isArray(payload.subclassIds) || payload.subclassIds.length !== input.labels.length) {
    throw new Error("Réponse de création de sous-classe incomplète.");
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
  status: "ready" | "reenrolled" | "already-reenrolled" | "completed" | "already-completed";
  created: boolean;
  sourceStudentId: string;
  targetStudentId?: string;
  schoolYearId: string;
};

export async function requestTerminalStudentReenrollment(input: {
  schoolId: string;
  sourceStudentId: string;
  mode: "inspect" | "reenroll";
  confirmation?: string;
  examResultConfirmed?: boolean;
}) {
  return provisionSchoolAccount<TerminalStudentReenrollmentStatus>({ action: "reenroll-terminal-student", ...input });
}

export async function requestTerminalStudentCompletion(input: {
  schoolId: string;
  sourceStudentId: string;
  confirmation: string;
  examResultConfirmed: boolean;
}) {
  return provisionSchoolAccount<TerminalStudentReenrollmentStatus>({ action: "complete-terminal-student", ...input });
}

export type UnlinkParentFromStudentInput = {
  schoolId: string;
  schoolYearId: string;
  studentId: string;
  parentId: string;
  confirmation: string;
};

export type LinkParentToStudentInput = {
  schoolId: string;
  schoolYearId: string;
  studentId: string;
  parentId: string;
  confirmation: string;
};

export type LinkParentToStudentResponse = {
  studentId: string;
  parentId: string;
  parentStudentIds: string[];
  parentUserStudentIds?: string[];
  previousParentId?: string;
  previousParentStudentIds?: string[];
  auditLogId: string;
};

export async function linkParentToStudent(input: LinkParentToStudentInput) {
  const payload = await provisionSchoolAccount<LinkParentToStudentResponse & { error?: string }>({
    action: "link-parent-to-student",
    ...input,
  }, { showEndpointOnNotFound: true });

  if (payload.studentId !== input.studentId
    || payload.parentId !== input.parentId
    || !Array.isArray(payload.parentStudentIds)
    || !payload.auditLogId) {
    throw new Error("Réponse de liaison parent incomplète.");
  }

  return payload;
}

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

type ManageSchoolAction = "update" | "change-acronym" | "change-currency" | "rename-option" | "suspend" | "reactivate" | "delete";

type ManageSchoolInput = {
  action: ManageSchoolAction;
  schoolId: string;
  patch?: Partial<School>;
  confirmation?: string;
  schoolYearId?: string;
  currency?: "USD" | "CDF";
  acronym?: string;
  option?: string;
  newName?: string;
};

type ManageSchoolResponse = {
  school?: School;
  schoolYear?: SchoolYear;
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

export type SectionAdministratorSummary = Pick<AppUser, "id" | "name" | "role" | "sectionIds" | "status" | "active">;
export async function manageSectionAdministrator(input: { schoolId: string; operation: "list" | "activate" | "deactivate" | "delete"; userId?: string; confirmation?: string }) {
  return provisionSchoolAccount<{ users?: SectionAdministratorSummary[] }>({ action: "manage-section-administrator", ...input });
}
