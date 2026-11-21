import { useEffect, useRef } from "react";
import { doc, onSnapshot, type Firestore } from "@firebase/firestore";
import { db } from "../../firebase";
import type { AuditLog, School, SchoolClass } from "../../types";
import type { SchoolDrawerDetail, SchoolDrawerSummary, SchoolHistoryLog } from "../../services/schoolDrawerSummary";
import { CLASSES } from "../../types";
import { formatStudentClassName } from "../../utils/studentClasses";
import { schoolOptionDisplayName } from "../../utils/schoolOptions";
import { isSessionAuditAction } from "../../utils/audit";
import { activityTimestamp } from "../../utils/activityHistory";

/**
 * Version 1.16.5 : données du drawer d'une école gardées en mémoire pendant la session.
 * Au retour sur une école déjà ouverte, les données s'affichent tout de suite, sans nouvelle lecture.
 * Elles ne sont relues que si le compteur de changements de l'école (`feeAllocationChangeCounters`, déjà tenu
 * par le serveur depuis la version 1.15.2) a bougé, ou avec le bouton « Actualiser ».
 */
/** Lot SA-4 : ce qui est gardé n'est plus la copie des collections de l'école, mais les nombres et l'historique reçus. */
export type SchoolDrawerData = SchoolDrawerDetail;
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

/** Répartition par classe à afficher, dans l'ordre des classes, avec le nom d'option choisi par l'école. */
export function schoolClassEnrollment(summary: SchoolDrawerSummary | undefined, school: School | undefined) {
  if (!summary || !school) return [];
  return summary.classes
    .map((item) => ({
      label: formatStudentClassName({ className: item.className as SchoolClass, option: item.option ? schoolOptionDisplayName(school, item.option) : item.option }),
      className: item.className as SchoolClass,
      count: item.count,
    }))
    .sort((first, second) => {
      const classOrder = CLASSES.indexOf(first.className) - CLASSES.indexOf(second.className);
      return classOrder || first.label.localeCompare(second.label, "fr");
    });
}

type TimelineLog = Pick<AuditLog, "id" | "action" | "actorName" | "createdAt">;

/**
 * Historique affiché : pages reçues du serveur et lignes écrites pendant la session (actions faites dans le drawer),
 * sans doublon ni connexion, de la plus récente à la plus ancienne.
 */
export function mergeSchoolHistory(localLogs: AuditLog[], serverLogs: SchoolHistoryLog[], schoolId: string, schoolYearId?: string): TimelineLog[] {
  const local = localLogs.filter((log) => log.schoolId === schoolId && (!schoolYearId || !log.schoolYearId || log.schoolYearId === schoolYearId));
  const rows = new Map<string, TimelineLog>();
  for (const log of [...serverLogs, ...local]) if (!rows.has(log.id) && !isSessionAuditAction(log.action)) rows.set(log.id, log);
  return [...rows.values()].sort((first, second) => activityTimestamp(second.createdAt) - activityTimestamp(first.createdAt));
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
