import { collection, onSnapshot, query, where } from "@firebase/firestore";
import type { Firestore } from "@firebase/firestore";
import { db, firebaseReady } from "../firebase";
import type { AppUser, Role, SchoolSection } from "../types";
import { resolveApiUrl } from "../config/apiUrl";
import { getCurrentFirebaseIdToken } from "./auth";
import { apiErrorMessage } from "../utils/rateLimitErrors";

export const INTERNAL_PERSONNEL_ROLES = ["school_admin", "cashier", "discipline_director", "study_director", "secretary", "teacher"] as const satisfies readonly Role[];
export type InternalPersonnelRole = typeof INTERNAL_PERSONNEL_ROLES[number];

export const personnelRoleLabels: Record<InternalPersonnelRole, string> = {
  school_admin: "Administrateur",
  cashier: "Caissier",
  discipline_director: "Directeur de Discipline",
  study_director: "Directeur des études",
  secretary: "Secrétaire",
  teacher: "Enseignant",
};

export function isInternalPersonnel(user: AppUser): user is AppUser & { role: InternalPersonnelRole } {
  return Boolean(user.schoolId) && INTERNAL_PERSONNEL_ROLES.includes(user.role as InternalPersonnelRole);
}

export function isArchivedPersonnel(user: AppUser) {
  return user.status === "inactive" || (user as AppUser & { active?: boolean }).active === false;
}

export function subscribeToSchoolPersonnel(input: { user: AppUser; schoolId: string; onData: (users: AppUser[]) => void; onError: (error: Error) => void }) {
  if (!firebaseReady || !db || input.user.role !== "school_admin" || input.user.status === "inactive" || input.user.active === false || input.user.schoolId !== input.schoolId) return () => undefined;
  return onSnapshot(
    query(collection(db as unknown as Firestore, "users"), where("schoolId", "==", input.schoolId), where("role", "in", [...INTERNAL_PERSONNEL_ROLES])),
    (snapshot) => input.onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as AppUser).filter(isInternalPersonnel)),
    input.onError,
  );
}

type PersonnelAction = "update-personnel" | "archive-personnel" | "reactivate-personnel";
async function requestPersonnelAction(input: { action: PersonnelAction; schoolId: string; personnelId: string; name?: string; phone?: string; email?: string; section?: SchoolSection | null; sectionIds?: SchoolSection[] }) {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch(resolveApiUrl("/api/provision-school-account"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({})) as { user?: AppUser; authStatus?: "disabled" | "enabled"; error?: string; code?: string };
  if (!response.ok) throw new Error(apiErrorMessage(response.status, payload, "Gestion du personnel impossible."));
  if (!payload.user) throw new Error("Réponse de gestion du personnel incomplète.");
  return payload;
}

export function updatePersonnel(input: { schoolId: string; personnelId: string; name: string; phone: string; email: string; section?: SchoolSection | null; sectionIds?: SchoolSection[] }) {
  return requestPersonnelAction({ action: "update-personnel", ...input });
}

export function archivePersonnel(input: { schoolId: string; personnelId: string }) {
  return requestPersonnelAction({ action: "archive-personnel", ...input });
}

export function reactivatePersonnel(input: { schoolId: string; personnelId: string }) {
  return requestPersonnelAction({ action: "reactivate-personnel", ...input });
}
