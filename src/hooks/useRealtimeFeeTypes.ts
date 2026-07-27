import { useEffect } from "react";
import { collection, onSnapshot, query, where } from "@firebase/firestore";
import type { Firestore } from "@firebase/firestore";
import { db, firebaseReady } from "../firebase";
import type { AppUser, FeeType } from "../types";

const allowedRoles = new Set<AppUser["role"]>(["school_admin", "cashier"]);

export function canSubscribeToRealtimeFeeTypes(user: AppUser | null, schoolId: string, schoolYearId: string) {
  return Boolean(user && user.status !== "inactive" && allowedRoles.has(user.role) && user.schoolId === schoolId && schoolId && schoolYearId);
}

export function reconcileRealtimeFeeTypes(current: FeeType[], incoming: FeeType[], schoolId: string, schoolYearId: string) {
  const outsideScope = current.filter((fee) => fee.schoolId !== schoolId || fee.schoolYearId !== schoolYearId);
  const scoped = new Map<string, FeeType>();
  incoming.forEach((fee) => {
    if (fee.schoolId === schoolId && fee.schoolYearId === schoolYearId) scoped.set(fee.id, fee);
  });
  return [...outsideScope, ...scoped.values()];
}

export function subscribeToRealtimeFeeTypes(database: Firestore, user: AppUser, schoolId: string, schoolYearId: string, onFees: (fees: FeeType[]) => void) {
  if (!canSubscribeToRealtimeFeeTypes(user, schoolId, schoolYearId)) return undefined;
  return onSnapshot(
    query(collection(database, "feeTypes"), where("schoolId", "==", schoolId), where("schoolYearId", "==", schoolYearId)),
    (snapshot) => onFees(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as FeeType)),
    (error) => console.warn("Écoute en temps réel des types de frais indisponible.", error),
  );
}

export function useRealtimeFeeTypes({ user, schoolId, schoolYearId, onFees }: {
  user: AppUser | null;
  schoolId: string;
  schoolYearId: string;
  onFees: (fees: FeeType[]) => void;
}) {
  useEffect(() => {
    if (!firebaseReady || !db || !user || !canSubscribeToRealtimeFeeTypes(user, schoolId, schoolYearId)) return undefined;
    return subscribeToRealtimeFeeTypes(db as unknown as Firestore, user, schoolId, schoolYearId, onFees);
  }, [onFees, schoolId, schoolYearId, user]);
}
