import { useEffect } from "react";
import { collection, onSnapshot, query, where } from "@firebase/firestore";
import type { Firestore } from "@firebase/firestore";
import { db, firebaseReady } from "../firebase";
import type { AppUser, ValvePublication } from "../types";

const valveRoles = new Set<AppUser["role"]>(["school_admin", "cashier", "discipline_director", "parent"]);

export type RealtimeValvesScope = {
  schoolId: string;
  schoolYearId: string;
};

export function canSubscribeToRealtimeValves(user: AppUser | null, schoolId: string, schoolYearId: string) {
  return Boolean(
    user
      && user.status !== "inactive"
      && valveRoles.has(user.role)
      && user.schoolId === schoolId
      && schoolId
      && schoolYearId,
  );
}

export function reconcileRealtimeValves(
  current: ValvePublication[],
  incoming: ValvePublication[],
  scope: RealtimeValvesScope,
) {
  const previousOrder = new Map(current.map((publication, index) => [publication.id, index]));
  const incomingOrder = new Map(incoming.map((publication, index) => [publication.id, index]));
  const outsideScope = current.filter(
    (publication) => publication.schoolId !== scope.schoolId || publication.schoolYearId !== scope.schoolYearId,
  );
  const scopedById = new Map<string, ValvePublication>();
  incoming.forEach((publication) => {
    if (publication.schoolId === scope.schoolId && publication.schoolYearId === scope.schoolYearId) {
      scopedById.set(publication.id, publication);
    }
  });
  return [...outsideScope, ...scopedById.values()].sort((first, second) => {
    const dateOrder = (second.createdAt ?? "").localeCompare(first.createdAt ?? "");
    if (dateOrder !== 0) return dateOrder;
    const firstOrder = previousOrder.get(first.id) ?? current.length + (incomingOrder.get(first.id) ?? 0);
    const secondOrder = previousOrder.get(second.id) ?? current.length + (incomingOrder.get(second.id) ?? 0);
    return firstOrder - secondOrder;
  });
}

type SubscribeOptions = {
  database: Firestore;
  user: AppUser;
  schoolId: string;
  schoolYearId: string;
  onValves: (valves: ValvePublication[], scope: RealtimeValvesScope) => void;
};

export function subscribeToRealtimeValves({ database, user, schoolId, schoolYearId, onValves }: SubscribeOptions) {
  if (!canSubscribeToRealtimeValves(user, schoolId, schoolYearId)) return undefined;
  const scope = { schoolId, schoolYearId };
  const valvesQuery = query(
    collection(database, "valves"),
    where("schoolId", "==", schoolId),
    where("schoolYearId", "==", schoolYearId),
  );
  return onSnapshot(
    valvesQuery,
    (snapshot) => {
      const valves = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as ValvePublication);
      onValves(valves, scope);
    },
    (error) => {
      console.warn("Écoute en temps réel des Valves indisponible.", error);
    },
  );
}

export function useRealtimeValves({
  user,
  schoolId,
  schoolYearId,
  onValves,
}: {
  user: AppUser | null;
  schoolId: string;
  schoolYearId: string;
  onValves: SubscribeOptions["onValves"];
}) {
  useEffect(() => {
    if (!firebaseReady || !db || !user || !canSubscribeToRealtimeValves(user, schoolId, schoolYearId)) return undefined;
    return subscribeToRealtimeValves({
      database: db as unknown as Firestore,
      user,
      schoolId,
      schoolYearId,
      onValves,
    });
  }, [onValves, schoolId, schoolYearId, user]);
}
