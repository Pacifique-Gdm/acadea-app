import { collection, doc, onSnapshot, query, where } from "@firebase/firestore";
import type { Firestore } from "@firebase/firestore";
import { db, firebaseReady } from "../firebase";
import type { AppUser, PersonnelProfile, Role, SchoolSection, ServicePersonnel } from "../types";
import { resolveApiUrl } from "../config/apiUrl";
import { getCurrentFirebaseIdToken } from "./auth";
import { apiErrorMessage } from "../utils/rateLimitErrors";

export const INTERNAL_PERSONNEL_ROLES = ["school_admin", "cashier", "discipline_director", "study_director", "secretary", "teacher"] as const satisfies readonly Role[];
export type InternalPersonnelRole = typeof INTERNAL_PERSONNEL_ROLES[number];
export type PersonnelRecord = AppUser | ServicePersonnel;
export const isServicePersonnel = (personnel: PersonnelRecord): personnel is ServicePersonnel => "kind" in personnel && personnel.kind === "service";

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

export function isArchivedPersonnel(user: PersonnelRecord) {
  return user.status === "inactive" || (user as AppUser & { active?: boolean }).active === false;
}

export type PersonnelIdentity = { lastName: string; middleName: string; firstName: string };

export function personnelIdentity(user: PersonnelRecord, profile?: Partial<PersonnelProfile>): PersonnelIdentity {
  if (profile?.lastName || profile?.middleName || profile?.firstName) {
    return {
      lastName: profile.lastName ?? "",
      middleName: profile.middleName ?? "",
      firstName: profile.firstName ?? "",
    };
  }
  // Les anciens comptes n'ont qu'un nom complet. On le conserve sans inventer
  // une séparation Nom/Postnom/Prénom potentiellement erronée.
  return { lastName: user.name ?? "", middleName: "", firstName: "" };
}

export function personnelDisplayName(identity: PersonnelIdentity) {
  return [identity.lastName, identity.middleName, identity.firstName].map((value) => value.trim()).filter(Boolean).join(" ");
}

export function normalizePersonnelSnapshot(users: readonly AppUser[]) {
  const byUid = new Map<string, AppUser>();
  users.filter(isInternalPersonnel).forEach((user) => {
    if (!byUid.has(user.id)) byUid.set(user.id, user);
  });
  return [...byUid.values()];
}

export function subscribeToSchoolPersonnel(input: { user: AppUser; schoolId: string; onData: (users: AppUser[]) => void; onError: (error: Error) => void }) {
  if (!firebaseReady || !db || !["school_admin", "study_director"].includes(input.user.role) || input.user.status === "inactive" || input.user.active === false || input.user.schoolId !== input.schoolId) return () => undefined;
  const roles = input.user.role === "study_director" ? ["teacher"] : [...INTERNAL_PERSONNEL_ROLES];
  return onSnapshot(
    query(collection(db as unknown as Firestore, "users"), where("schoolId", "==", input.schoolId), where("role", "in", roles)),
    (snapshot) => input.onData(normalizePersonnelSnapshot(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as AppUser))),
    input.onError,
  );
}

export function subscribeToServicePersonnel(input: { user: AppUser; schoolId: string; onData: (personnel: ServicePersonnel[]) => void; onError: (error: Error) => void }) {
  if (!firebaseReady || !db || input.user.role !== "school_admin" || input.user.schoolId !== input.schoolId || input.user.status === "inactive" || input.user.active === false) return () => undefined;
  return onSnapshot(
    query(collection(db as unknown as Firestore, "personnelProfiles"), where("schoolId", "==", input.schoolId)),
    (snapshot) => input.onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as ServicePersonnel).filter((item) => item.kind === "service")),
    input.onError,
  );
}

async function requestServicePersonnel(input: Record<string, unknown>) {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch(resolveApiUrl("/api/provision-school-account"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({})) as { personnel?: ServicePersonnel; error?: string; code?: string };
  if (!response.ok) throw new Error(apiErrorMessage(response.status, payload, "Gestion du personnel impossible."));
  if (!payload.personnel) throw new Error("Réponse de gestion du personnel incomplète.");
  return payload.personnel;
}

export function createServicePersonnel(input: { schoolId: string; name: string; phone: string; jobTitle: string; otherJobTitle?: string }) {
  return requestServicePersonnel({ action: "create-service-personnel", ...input });
}

export function updateServicePersonnel(input: { schoolId: string; personnelId: string; name: string; phone: string; sectionIds: SchoolSection[]; profile: Partial<PersonnelProfile> }) {
  return requestServicePersonnel({ action: "update-personnel", ...input });
}

export function changeServicePersonnelStatus(input: { schoolId: string; personnelId: string; archive: boolean }) {
  return requestServicePersonnel({ action: input.archive ? "archive-personnel" : "reactivate-personnel", schoolId: input.schoolId, personnelId: input.personnelId });
}

export function subscribeToPersonnelProfile(input: { user: AppUser; schoolId: string; personnelId: string; onData: (profile?: PersonnelProfile) => void; onError: (error: Error) => void }) {
  if (!firebaseReady || !db || !["school_admin", "study_director"].includes(input.user.role) || input.user.schoolId !== input.schoolId) return () => undefined;
  return onSnapshot(doc(db as unknown as Firestore, "personnelProfiles", input.personnelId), (snapshot) => {
    const data = snapshot.data();
    input.onData(snapshot.exists() && data?.schoolId === input.schoolId ? ({ id: snapshot.id, ...data } as PersonnelProfile) : undefined);
  }, input.onError);
}

type PersonnelAction = "update-personnel" | "archive-personnel" | "reactivate-personnel";
async function requestPersonnelAction(input: { action: PersonnelAction; schoolId: string; personnelId: string; name?: string; phone?: string; email?: string; section?: SchoolSection | null; sectionIds?: SchoolSection[]; profile?: Partial<PersonnelProfile> }) {
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

export function updatePersonnel(input: { schoolId: string; personnelId: string; name: string; phone: string; email: string; section?: SchoolSection | null; sectionIds?: SchoolSection[]; profile?: Partial<PersonnelProfile> }) {
  return requestPersonnelAction({ action: "update-personnel", ...input });
}

export function archivePersonnel(input: { schoolId: string; personnelId: string }) {
  return requestPersonnelAction({ action: "archive-personnel", ...input });
}

export function reactivatePersonnel(input: { schoolId: string; personnelId: string }) {
  return requestPersonnelAction({ action: "reactivate-personnel", ...input });
}
