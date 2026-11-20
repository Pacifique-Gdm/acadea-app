import { useEffect, useRef } from "react";
import { doc, onSnapshot, type Firestore } from "@firebase/firestore";
import { db } from "../../firebase";
import type { AppData } from "../../types";
import type { SuperAdminSchoolData } from "../../services/superAdminData";

/**
 * Version 1.16.5 : données du drawer d'une école gardées en mémoire pendant la session.
 * Au retour sur une école déjà ouverte, les données s'affichent tout de suite, sans nouvelle lecture.
 * Elles ne sont relues que si le compteur de changements de l'école (`feeAllocationChangeCounters`, déjà tenu
 * par le serveur depuis la version 1.15.2) a bougé, ou avec le bouton « Actualiser ».
 */
export type SchoolDrawerData = Omit<SuperAdminSchoolData, "admins">;
export type SchoolDrawerCacheEntry = { data: SchoolDrawerData; counter?: number };
export type SchoolDrawerCache = Map<string, SchoolDrawerCacheEntry>;

export const schoolDrawerKey = (schoolId: string, schoolYearId: string) => `${schoolId}__${schoolYearId}`;

/** Lecture du serveur seulement sans données gardées ou sur demande (bouton « Actualiser »). */
export function needsSchoolDrawerLoad(cache: SchoolDrawerCache, key: string, force = false): boolean {
  return force || !cache.has(key);
}

/**
 * Nouveau relevé du compteur de l'école affichée. Premier relevé : il est seulement noté (les données viennent
 * d'être lues). Ensuite, on ne relit que si la valeur a changé depuis les données gardées.
 */
export function counterAsksReload(entry: SchoolDrawerCacheEntry | undefined, count: number): boolean {
  if (!entry) return false;
  if (entry.counter === undefined) { entry.counter = count; return false; }
  return entry.counter !== count;
}

/** Copie des données de l'école affichée (avec les changements faits dans le drawer) avant de la quitter. */
export function snapshotSchoolDrawerData(data: AppData, schoolId: string): SchoolDrawerData {
  const ofSchool = <T extends { schoolId?: string }>(items: T[]) => items.filter((item) => item.schoolId === schoolId);
  return {
    users: ofSchool(data.users),
    students: ofSchool(data.students),
    parents: ofSchool(data.parents),
    feeTypes: ofSchool(data.feeTypes),
    payments: ofSchool(data.payments),
    expenses: ofSchool(data.expenses),
    messages: ofSchool(data.messages),
    notifications: ofSchool(data.notifications),
    auditLogs: ofSchool(data.auditLogs),
    valves: ofSchool(data.valves),
    biometricTerminals: ofSchool(data.biometricTerminals),
  };
}

/** Écoute le seul compteur de l'école et de l'année affichées dans le drawer (une lecture par ouverture). */
export function useSchoolChangeCounter(key: string, onCount: (key: string, count: number) => void, database: unknown = db) {
  const callback = useRef(onCount);
  useEffect(() => { callback.current = onCount; });
  useEffect(() => {
    if (!database || !key) return undefined;
    const store = database as unknown as Firestore;
    return onSnapshot(doc(store, "feeAllocationChangeCounters", key), (snapshot) => {
      callback.current(key, Number(snapshot.data()?.count ?? 0));
    }, () => { /* Compteur indisponible : les données gardées restent et le bouton « Actualiser » reste possible. */ });
  }, [key, database]);
}
