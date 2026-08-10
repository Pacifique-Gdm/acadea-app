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

export async function persistGeneratedTimetable(database: Firestore, input: PersistGeneratedTimetableInput) {
  if (input.entries.length > 498) throw new Error("L’horaire dépasse la capacité d’un enregistrement atomique (498 créneaux).");
  const id = `${input.schoolId}__${input.schoolYearId}__v${input.version}`;
  if (input.existing.some((item) => item.id === id)) throw new Error("Cette version d’horaire existe déjà.");
  const now = new Date().toISOString();
  const schedule: Timetable = { id, schoolId: input.schoolId, schoolYearId: input.schoolYearId, version: input.version, status: "DRAFT", activeDraft: true, createdBy: input.user.id, createdAt: now, updatedAt: now, generationMetadata: input.metadata };
  const batch = writeBatch(database);
  input.existing.filter((item) => item.status === "DRAFT" && item.activeDraft).forEach((item) => batch.update(doc(database, "timetables", item.id), { activeDraft: false, updatedAt: now }));
  batch.set(doc(database, "timetables", id), schedule);
  input.entries.forEach((entry) => {
    const saved = { ...entry, id: `${id}__${entry.id}`, scheduleId: id, createdAt: now, updatedAt: now };
    batch.set(doc(database, "timetableEntries", saved.id), saved);
  });
  await batch.commit();
  return schedule;
}
