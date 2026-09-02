import { useEffect } from "react";
import { collection, onSnapshot, query, where } from "@firebase/firestore";
import type { Firestore } from "@firebase/firestore";
import { db, firebaseReady } from "../firebase";
import type { AppUser } from "../types";

export const DASHBOARD_PERSONNEL_ROLES = ["school_admin", "cashier", "discipline_director"] as const;
const SCHOOL_ADMIN_PERSONNEL_ROLES = ["school_admin", "cashier", "discipline_director", "study_director", "secretary", "teacher"] as const;

export function reconcileRealtimeSchoolUsers(current: AppUser[], incoming: AppUser[], schoolId: string) {
  const outsideSchool = current.filter((user) => user.schoolId !== schoolId);
  const schoolUsers = new Map(incoming.filter((user) => user.schoolId === schoolId).map((user) => [user.id, user]));
  return [...outsideSchool, ...schoolUsers.values()];
}

export function subscribeToRealtimeSchoolUsers(database: Firestore, user: AppUser, schoolId: string, onUsers: (users: AppUser[]) => void) {
  if (!["super_admin", "school_admin", "cashier"].includes(user.role) || user.status === "inactive" || user.active === false || !schoolId) return undefined;
  if (user.role !== "super_admin" && user.schoolId !== schoolId) return undefined;
  const roles = user.role === "cashier" ? DASHBOARD_PERSONNEL_ROLES : user.role === "school_admin" ? SCHOOL_ADMIN_PERSONNEL_ROLES : undefined;
  const usersQuery = roles
    ? query(collection(database, "users"), where("schoolId", "==", schoolId), where("role", "in", [...roles]))
    : query(collection(database, "users"), where("schoolId", "==", schoolId));
  return onSnapshot(
    usersQuery,
    (snapshot) => onUsers(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as AppUser)),
    (error) => console.warn("Actualisation des utilisateurs de l’école indisponible.", error),
  );
}

export function useRealtimeSchoolUsers({ user, schoolId, onUsers }: { user: AppUser | null; schoolId: string; onUsers: (users: AppUser[]) => void }) {
  useEffect(() => {
    if (!firebaseReady || !db || !user || !schoolId) return undefined;
    return subscribeToRealtimeSchoolUsers(db as unknown as Firestore, user, schoolId, onUsers);
  }, [onUsers, schoolId, user]);
}
