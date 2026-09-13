import { doc, writeBatch, type Firestore } from "@firebase/firestore";
import type { AppUser } from "../../types";
import type { Timetable, TimetableEntry } from "./studyTypes";

export interface PersistGeneratedTimetableInput {
  user: AppUser;
  schoolId: string;
  schoolYearId: string;
  version: number;
  entries: TimetableEntry[];
  existing: Timetable[];
  metadata: Timetable["generationMetadata"];
}

const MAX_ENTRY_REFERENCE_PATHS_PER_BATCH = 4;

function entryReferencePaths(entry: TimetableEntry) {
  return [
    `assignment:${entry.assignmentId}`,
    `period:${entry.periodId}`,
    ...(entry.roomId ? [`room:${entry.roomId}`] : []),
  ];
}

export function timetableEntryBatches(entries: TimetableEntry[]) {
  const batches: TimetableEntry[][] = [];
  let current: TimetableEntry[] = [];
  let references = new Set<string>();
  for (const entry of entries) {
    const nextReferences = new Set([...references, ...entryReferencePaths(entry)]);
    if (current.length > 0 && (nextReferences.size > MAX_ENTRY_REFERENCE_PATHS_PER_BATCH || current.length >= 400)) {
      batches.push(current);
      current = [];
      references = new Set<string>();
    }
    current.push(entry);
    entryReferencePaths(entry).forEach((path) => references.add(path));
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function cleanupPendingTimetable(database: Firestore, scheduleId: string, entries: TimetableEntry[]) {
  for (let index = 0; index < entries.length; index += 400) {
    const batch = writeBatch(database);
    entries.slice(index, index + 400).forEach((entry) => batch.delete(doc(database, "timetableEntries", entry.id)));
    await batch.commit();
  }
  const batch = writeBatch(database);
  batch.delete(doc(database, "timetables", scheduleId));
  await batch.commit();
}

export async function persistGeneratedTimetable(database: Firestore, input: PersistGeneratedTimetableInput) {
  if (input.entries.length > 498) throw new Error("L’horaire dépasse la capacité d’enregistrement (498 créneaux).");
  const id = `${input.schoolId}__${input.schoolYearId}__v${input.version}`;
  if (input.existing.some((item) => item.id === id)) throw new Error("Cette version d’horaire existe déjà.");
  const now = new Date().toISOString();
  const pendingSchedule: Timetable = { id, schoolId: input.schoolId, schoolYearId: input.schoolYearId, version: input.version, status: "DRAFT", activeDraft: false, persistenceState: "PENDING", createdBy: input.user.id, createdAt: now, updatedAt: now, generationMetadata: input.metadata };
  const savedEntries = input.entries.map((entry) => ({ ...entry, id: `${id}__${entry.id}`, scheduleId: id, createdAt: now, updatedAt: now }));
  const creation = writeBatch(database);
  creation.set(doc(database, "timetables", id), pendingSchedule);
  await creation.commit();
  const persistedEntries: TimetableEntry[] = [];
  try {
    for (const entries of timetableEntryBatches(savedEntries)) {
      const batch = writeBatch(database);
      entries.forEach((entry) => batch.set(doc(database, "timetableEntries", entry.id), entry));
      await batch.commit();
      persistedEntries.push(...entries);
    }
    const finalization = writeBatch(database);
    input.existing.filter((item) => item.status === "DRAFT" && item.activeDraft).forEach((item) => finalization.update(doc(database, "timetables", item.id), { activeDraft: false, updatedAt: now }));
    finalization.update(doc(database, "timetables", id), { activeDraft: true, persistenceState: "COMPLETE", updatedAt: now });
    await finalization.commit();
    return { ...pendingSchedule, activeDraft: true, persistenceState: "COMPLETE" };
  } catch {
    try {
      await cleanupPendingTimetable(database, id, persistedEntries);
    } catch {
      // Un brouillon PENDING reste invisible et pourra être diagnostiqué sans
      // jamais remplacer un horaire actif si le nettoyage réseau échoue aussi.
    }
    throw new Error("L’horaire a été calculé mais n’a pas pu être enregistré. Aucun horaire partiel n’a été activé.");
  }
}
