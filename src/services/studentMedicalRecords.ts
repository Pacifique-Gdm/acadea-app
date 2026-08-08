import * as firestore from "firebase/firestore";
import { collection, doc, onSnapshot, query, runTransaction, where } from "firebase/firestore";
import { auth, db } from "../firebase";
import type { AppUser } from "../types";
import type { StudentMedicalRecord, StudentMedicalRecordStatus } from "../modules/secretary/secretaryTypes";
import { requiredMedicalRecordFields } from "../modules/secretary/medicalRecordFields";

const serverTimestamp = (firestore as unknown as { serverTimestamp: () => unknown }).serverTimestamp;

const medicalRecordRoles = new Set<AppUser["role"]>(["school_admin", "secretary"]);

export function canManageStudentMedicalRecords(user: AppUser, schoolId: string) {
  return medicalRecordRoles.has(user.role) && user.status !== "inactive" && user.schoolId === schoolId;
}

export function canReadOwnChildrenMedicalRecords(user: AppUser, schoolId: string) {
  return user.role === "parent" && user.status !== "inactive" && user.schoolId === schoolId && Boolean(user.parentId);
}

function assertMedicalRecordUser(user: AppUser, schoolId: string) {
  if (!auth?.currentUser || auth.currentUser.uid !== user.id || !canManageStudentMedicalRecords(user, schoolId)) {
    throw new Error("Votre session ne permet pas de gérer les fiches médicales.");
  }
}

export function medicalRecordSaveErrorMessage(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (code === "permission-denied" || code === "firestore/permission-denied") {
    return "Vous n'avez pas l'autorisation d'enregistrer cette fiche médicale. Vérifiez votre rôle et l'établissement actif.";
  }
  if (code === "unavailable" || code === "firestore/unavailable") {
    return "Impossible d'enregistrer la fiche médicale pour le moment. Réessayez.";
  }
  return error instanceof Error && error.message ? error.message : "Impossible d'enregistrer la fiche médicale.";
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

export function cleanMedicalRecordInput(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, String(value ?? "").trim()]));
}

export function subscribeToStudentMedicalRecords(params: {
  user: AppUser;
  schoolId: string;
  schoolYearId: string;
  onData: (records: StudentMedicalRecord[]) => void;
  onError: (error: Error) => void;
}) {
  if (!db || !canManageStudentMedicalRecords(params.user, params.schoolId)) return () => undefined;
  const request = query(collection(db, "studentMedicalRecords"), where("schoolId", "==", params.schoolId), where("schoolYearId", "==", params.schoolYearId));
  return onSnapshot(request, (snapshot) => params.onData(snapshot.docs.map((item) => {
    const data = item.data();
    return { id: item.id, ...data, createdAt: timestampToIso(data.createdAt), updatedAt: timestampToIso(data.updatedAt) } as StudentMedicalRecord;
  })), (error) => params.onError(error));
}

export function subscribeToParentMedicalRecords(params: {
  user: AppUser;
  schoolId: string;
  schoolYearId: string;
  students: Array<{ id: string; schoolId: string; schoolYearId: string; parentId?: string }>;
  onData: (records: StudentMedicalRecord[]) => void;
  onError: (error: Error) => void;
}) {
  if (!db || !canReadOwnChildrenMedicalRecords(params.user, params.schoolId)) return () => undefined;
  const childIds = [...new Set(params.students
    .filter((student) => student.schoolId === params.schoolId && student.schoolYearId === params.schoolYearId && student.parentId === params.user.parentId)
    .map((student) => student.id))];
  if (!childIds.length) {
    params.onData([]);
    return () => undefined;
  }
  const records = new Map<string, StudentMedicalRecord>();
  const emit = () => params.onData(childIds.flatMap((studentId) => records.get(studentId) ?? []));
  type MedicalRecordSnapshot = { id: string; exists: () => boolean; data: () => Record<string, unknown> };
  const subscribeToDocument = onSnapshot as unknown as (
    reference: unknown,
    next: (snapshot: MedicalRecordSnapshot) => void,
    error: (error: Error) => void,
  ) => () => void;
  const unsubscribes = childIds.map((studentId) => subscribeToDocument(doc(db, "studentMedicalRecords", studentId), (snapshot) => {
    if (!snapshot.exists()) records.delete(studentId);
    else {
      const data = snapshot.data();
      if (data.schoolId === params.schoolId && data.schoolYearId === params.schoolYearId && data.studentId === studentId) {
        records.set(studentId, { id: snapshot.id, ...data, createdAt: timestampToIso(data.createdAt), updatedAt: timestampToIso(data.updatedAt) } as StudentMedicalRecord);
      }
    }
    emit();
  }, (error) => params.onError(error)));
  return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
}

export async function saveStudentMedicalRecord(params: {
  user: AppUser;
  studentId: string;
  schoolId: string;
  schoolYearId: string;
  input: Omit<StudentMedicalRecord, "id" | "studentId" | "schoolId" | "schoolYearId" | "createdBy" | "createdAt" | "updatedAt">;
}) {
  assertMedicalRecordUser(params.user, params.schoolId);
  if (!db) throw new Error("Service de données indisponible.");
  const recordRef = doc(db, "studentMedicalRecords", params.studentId);
  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(recordRef);
    const cleanInput = cleanMedicalRecordInput(params.input);
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
