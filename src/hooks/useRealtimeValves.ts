import { useEffect } from "react";
import { collection, onSnapshot, query, where } from "@firebase/firestore";
import type { Firestore } from "@firebase/firestore";
import { db, firebaseReady } from "../firebase";
import type { AppUser, ValvePublication } from "../types";

const valveRoles = new Set<AppUser["role"]>(["school_admin", "cashier", "discipline_director", "secretary", "parent"]);

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

/** Requêtes Valves permises par les règles. Un parent ne lit que ce qui le concerne : les
 * publications « Tous les parents » et celles dont il fait partie du public. */
export function valveQueries(database: Firestore, user: Pick<AppUser, "role" | "parentId">, schoolId: string, schoolYearId: string) {
  const scope = [where("schoolId", "==", schoolId), where("schoolYearId", "==", schoolYearId)];
  if (user.role !== "parent") return [query(collection(database, "valves"), ...scope)];
  if (!user.parentId) return [];
  return [
    query(collection(database, "valves"), ...scope, where("audienceAll", "==", true)),
    query(collection(database, "valves"), ...scope, where("audienceParentIds", "array-contains", user.parentId)),
  ];
}

export function subscribeToRealtimeValves({ database, user, schoolId, schoolYearId, onValves }: SubscribeOptions) {
  if (!canSubscribeToRealtimeValves(user, schoolId, schoolYearId)) return undefined;
  const scope = { schoolId, schoolYearId };
  const queries = valveQueries(database, user, schoolId, schoolYearId);
  if (queries.length === 0) return undefined;
  // Une liste par requête ; l'écran reçoit leur réunion, sans doublon, dès que toutes ont répondu.
  const parts: Array<ValvePublication[] | undefined> = queries.map(() => undefined);
  const unsubscribes = queries.map((valvesQuery, index) => onSnapshot(
    valvesQuery,
    (snapshot) => {
      parts[index] = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as ValvePublication);
      if (parts.some((part) => part === undefined)) return;
      const merged = new Map<string, ValvePublication>();
      for (const part of parts) for (const publication of part ?? []) merged.set(publication.id, publication);
      onValves([...merged.values()], scope);
    },
    (error) => {
      console.warn("Écoute en temps réel des Valves indisponible.", error);
    },
  ));
  return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
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
