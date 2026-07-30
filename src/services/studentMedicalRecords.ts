import * as firestore from "firebase/firestore";
import { collection, doc, onSnapshot, query, runTransaction, where } from "firebase/firestore";
import { auth, db } from "../firebase";
import type { AppUser } from "../types";
import type { StudentMedicalRecord, StudentMedicalRecordStatus } from "../modules/secretary/secretaryTypes";
import { requiredMedicalRecordFields } from "../modules/secretary/medicalRecordFields";

const serverTimestamp = (firestore as unknown as { serverTimestamp: () => unknown }).serverTimestamp;

function assertSecretary(user: AppUser, schoolId: string) {
  if (!auth?.currentUser || auth.currentUser.uid !== user.id || user.role !== "secretary" || user.status === "inactive" || user.schoolId !== schoolId) {
    throw new Error("Votre session ne permet pas de gérer les fiches médicales.");
  }
}

function timestampToIso(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") return value.toDate().toISOString();
  return "";
}

export function getMedicalRecordStatus(record?: StudentMedicalRecord): StudentMedicalRecordStatus {
  if (!record) return "missing";
  return requiredMedicalRecordFields.every((field) => String(record[field] ?? "").trim()) ? "complete" : "incomplete";
}

export function subscribeToStudentMedicalRecords(params: {
  user: AppUser;
  schoolId: string;
  schoolYearId: string;
  onData: (records: StudentMedicalRecord[]) => void;
  onError: (error: Error) => void;
}) {
  if (!db || params.user.role !== "secretary" || params.user.status === "inactive" || params.user.schoolId !== params.schoolId) return () => undefined;
  const request = query(collection(db, "studentMedicalRecords"), where("schoolId", "==", params.schoolId), where("schoolYearId", "==", params.schoolYearId));
  return onSnapshot(request, (snapshot) => params.onData(snapshot.docs.map((item) => {
    const data = item.data();
    return { id: item.id, ...data, createdAt: timestampToIso(data.createdAt), updatedAt: timestampToIso(data.updatedAt) } as StudentMedicalRecord;
  })), (error) => params.onError(error));
}

export async function saveStudentMedicalRecord(params: {
  user: AppUser;
  studentId: string;
  schoolId: string;
  schoolYearId: string;
  input: Omit<StudentMedicalRecord, "id" | "studentId" | "schoolId" | "schoolYearId" | "createdBy" | "createdAt" | "updatedAt">;
}) {
  assertSecretary(params.user, params.schoolId);
  if (!db) throw new Error("Service de données indisponible.");
  const recordRef = doc(db, "studentMedicalRecords", params.studentId);
  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(recordRef);
    const cleanInput = Object.fromEntries(Object.entries(params.input).map(([key, value]) => [key, String(value ?? "").trim()]));
    transaction.set(recordRef, {
      ...cleanInput,
      id: params.studentId,
      studentId: params.studentId,
      schoolId: params.schoolId,
      schoolYearId: params.schoolYearId,
      createdBy: current.data()?.createdBy ?? params.user.id,
      ...(current.data() ? {} : { createdAt: serverTimestamp() }),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  });
}
