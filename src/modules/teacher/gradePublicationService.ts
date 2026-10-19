import { resolveApiUrl } from "../../config/apiUrl";
import { getCurrentFirebaseIdToken } from "../../services/auth";
import type { ConsolidatedClassReport } from "./consolidatedGrades";
import type { EditableGradingSlot } from "./teacherGrading";

export type PublicationComparison = "gte" | "lt";
export type PublicationCriteria = {
  slot: EditableGradingSlot;
  percentage?: { operator: PublicationComparison; value: number };
  fee?: { feeTypeId: string; operator: PublicationComparison; amountMinor: number };
};
export type PublishedIndividualResult = {
  id: string;
  studentId: string;
  studentName: string;
  schoolYearId: string;
  className: string;
  yearName: string;
  slot: EditableGradingSlot;
  publishedAt: string;
  result: {
    courses: Array<{ classId: string; subjectId: string; name: string; score: number | null; maximum: number | null; status: "graded" | "not_graded" | "absent" }>;
    percentage: number;
    rank: number;
  };
};
export type PublishedChild = { studentId: string; studentName: string; className: string; publications: Array<{ slot: EditableGradingSlot; publicationId: string; publishedAt: string }> };

async function request<T>(body: Record<string, unknown>): Promise<T> {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch(resolveApiUrl("/api/manage-teacher-grading"), {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const payload = await response.json() as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error ?? "Publication des cotes indisponible.");
  return payload;
}

export const loadGradePublicationOptions = (schoolId: string, schoolYearId: string) =>
  request<{ currency: "USD" | "CDF"; feeTypes: Array<{ id: string; name: string; className: string | null; classOptionKey: string | null }> }>({ action: "grades-options", schoolId, schoolYearId });
export const loadDirectorConsolidatedReport = (schoolId: string, schoolYearId: string, classId: string) =>
  request<{ report: ConsolidatedClassReport }>({ action: "grades-report", schoolId, schoolYearId, classId });
export const publishGrades = (input: { schoolId: string; schoolYearId: string; classId: string; requestId: string } & PublicationCriteria) =>
  request<{ ok: true; publicationId: string; publishedCount: number; notificationCount: number; repeated: boolean }>({ action: "grades-publish", ...input });
export const withdrawGradePublication = (schoolId: string, schoolYearId: string, publicationId: string) =>
  request<{ ok: true; withdrawn?: true }>({ action: "grades-withdraw", schoolId, schoolYearId, publicationId });
export const listParentPublishedGrades = (schoolId: string, schoolYearId: string) =>
  request<{ children: PublishedChild[] }>({ action: "grades-parent-list", schoolId, schoolYearId });
export const readParentPublishedGrade = (schoolId: string, schoolYearId: string, studentId: string, slot: EditableGradingSlot) =>
  request<{ result: PublishedIndividualResult }>({ action: "grades-parent-read", schoolId, schoolYearId, studentId, slot });
