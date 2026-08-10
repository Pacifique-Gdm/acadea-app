export type AvailabilityRequestStatus = "PENDING" | "APPROVED" | "REJECTED";
export type AvailabilityRequestType = "FULL_DAY" | "TIME_RANGE";

export interface TeacherAvailabilityRequest {
  id: string;
  schoolId: string;
  schoolYearId: string;
  teacherId: string;
  userId: string;
  requestedDate: string;
  requestType: AvailabilityRequestType;
  startTime?: string;
  endTime?: string;
  reason: string;
  status: AvailabilityRequestStatus;
  createdAt: string;
  createdBy: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewComment?: string;
  appliedAvailabilityIds?: string[];
}

export const availabilityRequestLabels: Record<AvailabilityRequestStatus, string> = { PENDING: "En attente", APPROVED: "Approuvée", REJECTED: "Rejetée" };

export function validateAvailabilityRequest(input: Pick<TeacherAvailabilityRequest, "requestedDate" | "requestType" | "startTime" | "endTime" | "reason">, today = new Date().toISOString().slice(0, 10)) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.requestedDate) || input.requestedDate < today) return "La date doit être aujourd’hui ou une date future.";
  if (!input.reason.trim()) return "Le motif est obligatoire.";
  if (input.requestType === "TIME_RANGE" && (!input.startTime || !input.endTime || input.startTime >= input.endTime)) return "L’heure de fin doit être postérieure à l’heure de début.";
  return "";
}
