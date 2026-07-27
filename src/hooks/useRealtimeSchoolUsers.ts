import { useEffect } from "react";
import { collection, onSnapshot, query, where } from "@firebase/firestore";
import type { Firestore } from "@firebase/firestore";
import { db, firebaseReady } from "../firebase";
import type { AppUser } from "../types";

export function reconcileRealtimeSchoolUsers(current: AppUser[], incoming: AppUser[], schoolId: string) {
  const outsideSchool = current.filter((user) => user.schoolId !== schoolId);
  const schoolUsers = new Map(incoming.filter((user) => user.schoolId === schoolId).map((user) => [user.id, user]));
  return [...outsideSchool, ...schoolUsers.values()];
}

export function subscribeToRealtimeSchoolUsers(database: Firestore, user: AppUser, schoolId: string, onUsers: (users: AppUser[]) => void) {
  if (user.role !== "super_admin" || user.status === "inactive" || !schoolId) return undefined;
  return onSnapshot(
    query(collection(database, "users"), where("schoolId", "==", schoolId)),
    (snapshot) => onUsers(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as AppUser)),
    (error) => console.warn("Actualisation des utilisateurs de l’école indisponible.", error),
  );
}

export function useRealtimeSchoolUsers({ user, schoolId, onUsers }: { user: AppUser; schoolId: string; onUsers: (users: AppUser[]) => void }) {
  useEffect(() => {
    if (!firebaseReady || !db || user.role !== "super_admin" || user.status === "inactive" || !schoolId) return undefined;
    return subscribeToRealtimeSchoolUsers(db as unknown as Firestore, user, schoolId, onUsers);
  }, [onUsers, schoolId, user]);
}
