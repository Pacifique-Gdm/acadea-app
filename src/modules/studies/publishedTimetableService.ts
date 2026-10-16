import { resolveApiUrl } from "../../config/apiUrl";
import { getCurrentFirebaseIdToken } from "../../services/auth";
import type { AppUser } from "../../types";
import type { StudyDay } from "./studyTypes";

export type PublishedTimetableRow = {
  dayOfWeek: StudyDay | "unknown";
  periodLabel: string;
  startTime: string | null;
  classLabel: string;
  subjectLabel: string;
  teacherDisplayName: string;
};
export type PublishedTimetableSnapshot = { version: number; rows: PublishedTimetableRow[] } | null;

const publishedReaderRoles = new Set<AppUser["role"]>(["school_admin", "secretary", "discipline_director", "study_director", "teacher"]);

export function canReadPublishedTimetable(user: AppUser) {
  return publishedReaderRoles.has(user.role) && user.status !== "inactive" && user.active !== false && Boolean(user.schoolId);
}

export function subscribeToActivePublishedTimetable(input: {
  user: AppUser;
  schoolId: string;
  schoolYearId: string;
  onData: (value: PublishedTimetableSnapshot) => void;
  onError: (error: Error) => void;
}): () => void {
  if (!canReadPublishedTimetable(input.user) || input.user.schoolId !== input.schoolId || !input.schoolId || !input.schoolYearId) {
    throw new Error("Consultation de l’horaire publié non autorisée.");
  }
  let active = true;
  let inFlight = false;
  const refresh = async () => {
    if (!active || inFlight) return;
    inFlight = true;
    try {
      const token = await getCurrentFirebaseIdToken();
      const query = new URLSearchParams({ view: "published-timetable", schoolYearId: input.schoolYearId });
      const response = await fetch(resolveApiUrl(`/api/manage-teacher-availability-request?${query}`), {
        method: "GET", headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      const payload = await response.json() as { timetable?: PublishedTimetableSnapshot; error?: string };
      if (!response.ok) throw new Error(payload.error || "Horaire publié indisponible.");
      if (active) input.onData(payload.timetable ?? null);
    } catch (cause) {
      if (active) input.onError(cause instanceof Error ? cause : new Error("Horaire publié indisponible."));
    } finally {
      inFlight = false;
    }
  };
  void refresh();
  const interval = setInterval(() => { void refresh(); }, 60_000);
  return () => { active = false; clearInterval(interval); };
}
