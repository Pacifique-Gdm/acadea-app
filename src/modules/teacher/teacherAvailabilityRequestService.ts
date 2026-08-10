import { collection, doc, onSnapshot, query, setDoc, where, type Firestore } from "@firebase/firestore";
import { db } from "../../firebase";
import type { AppUser } from "../../types";
import type { TeacherAvailabilityRequest, AvailabilityRequestType } from "../studies/teacherAvailabilityRequests";
import { validateAvailabilityRequest } from "../studies/teacherAvailabilityRequests";

export function subscribeToOwnAvailabilityRequests(input: { user: AppUser; schoolId: string; schoolYearId: string; teacherId: string; onData: (items: TeacherAvailabilityRequest[]) => void; onError: (error: Error) => void }) {
  if (!db || input.user.role !== "teacher" || input.user.schoolId !== input.schoolId || input.user.status === "inactive" || input.user.active === false) throw new Error("Accès Enseignant non autorisé.");
  return onSnapshot(query(collection(db as unknown as Firestore, "teacherAvailabilityRequests"), where("schoolId", "==", input.schoolId), where("schoolYearId", "==", input.schoolYearId), where("teacherId", "==", input.teacherId), where("userId", "==", input.user.id)), snapshot => input.onData(snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as TeacherAvailabilityRequest).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))), input.onError);
}

export async function createAvailabilityRequest(input: { user: AppUser; schoolId: string; schoolYearId: string; teacherId: string; requestedDate: string; requestType: AvailabilityRequestType; startTime?: string; endTime?: string; reason: string; existing: TeacherAvailabilityRequest[] }) {
  if (!db || input.user.role !== "teacher" || input.user.schoolId !== input.schoolId || input.user.status === "inactive" || input.user.active === false) throw new Error("Accès Enseignant non autorisé.");
  const error = validateAvailabilityRequest(input); if (error) throw new Error(error);
  const duplicate = input.existing.some(item => item.status === "PENDING" && item.requestedDate === input.requestedDate && item.requestType === input.requestType && (item.startTime ?? "") === (input.startTime ?? "") && (item.endTime ?? "") === (input.endTime ?? ""));
  if (duplicate) throw new Error("Une demande identique est déjà en attente.");
  const slot = input.requestType === "FULL_DAY" ? "full-day" : `${input.startTime}-${input.endTime}`.replace(/:/g, "");
  const id = `${input.schoolId}__${input.schoolYearId}__${input.teacherId}__${input.requestedDate}__${slot}`; const now = new Date().toISOString();
  const payload: TeacherAvailabilityRequest = { id, schoolId: input.schoolId, schoolYearId: input.schoolYearId, teacherId: input.teacherId, userId: input.user.id, requestedDate: input.requestedDate, requestType: input.requestType, ...(input.requestType === "TIME_RANGE" ? { startTime: input.startTime, endTime: input.endTime } : {}), reason: input.reason.trim(), status: "PENDING", createdAt: now, createdBy: input.user.id };
  await setDoc(doc(db as unknown as Firestore, "teacherAvailabilityRequests", id), payload);
  return payload;
}
