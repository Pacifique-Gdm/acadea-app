import { getCurrentFirebaseIdToken } from "../../services/auth";
import { resolveApiUrl } from "../../config/apiUrl";
import type { ScheduleValidationReport, Timetable } from "./studyTypes";

export class TimetableWorkflowError extends Error {
  constructor(message: string, public report?: ScheduleValidationReport) { super(message); }
}
const requests = new Map<string, string>();
export async function requestTimetableTransition(action: "timetable-validate" | "timetable-publish", schedule: Timetable, existing: Timetable[] = []) {
  const key = `${action}:${schedule.id}:${schedule.updatedAt}`;
  // Retain identity after a network failure; never inject a session.
  const requestId = requests.get(key) ?? crypto.randomUUID();
  requests.set(key, requestId);
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch(resolveApiUrl("/api/manage-teacher-grading"), {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, schoolId: schedule.schoolId, schoolYearId: schedule.schoolYearId, scheduleId: schedule.id,
      expectedUpdatedAt: schedule.updatedAt, requestId,
      expectedPublishedIds: existing.filter((item) => item.status === "PUBLISHED" && item.activePublished).map((item) => item.id).sort() }),
  });
  const payload = await response.json() as { error?: string; report?: ScheduleValidationReport; status?: string };
  if (!response.ok) throw new TimetableWorkflowError(payload.error ?? "Opération d’horaire impossible.", payload.report);
  return payload;
}
