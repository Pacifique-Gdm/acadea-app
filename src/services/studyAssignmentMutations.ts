import { resolveApiUrl } from "../config/apiUrl";
import { getCurrentFirebaseIdToken } from "./auth";
import { apiErrorMessage } from "../utils/rateLimitErrors";
import type { AssignmentSessionPattern } from "../modules/studies/studyTypes";
import type { AssignmentClassSelection } from "../modules/studies/studyCourseScope";

async function mutate(input: Record<string, unknown>) {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch(resolveApiUrl("/api/provision-school-account"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({})) as { error?: string; code?: string; count?: number };
  if (!response.ok) throw new Error(apiErrorMessage(response.status, payload, "Affectation pédagogique impossible."));
  return payload;
}

export async function saveStudyAssignmentsServer(input: {
  schoolId: string; schoolYearId: string; teacherId: string; subjectIds: string[];
  classSelections: AssignmentClassSelection[]; legacyClasses: unknown[];
  weeklyPeriods: number; sessionPattern: AssignmentSessionPattern | null;
  titularClassIds: string[]; existingTitularIds: string[];
  active: boolean; currentId?: string;
}) {
  return mutate({ action: "save-study-assignments", ...input });
}

export async function setStudyAssignmentActiveServer(input: { schoolId: string; schoolYearId: string; assignmentId: string; active: boolean }) {
  return mutate({ action: "set-study-assignment-active", ...input });
}
