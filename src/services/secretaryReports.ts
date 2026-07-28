import * as firestore from "firebase/firestore";
import { collection, doc, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { auth, db } from "../firebase";
import type { AppUser } from "../types";
import type { SecretaryReport, SecretaryReportType } from "../modules/secretary/secretaryTypes";

const serverTimestamp = (firestore as unknown as { serverTimestamp: () => unknown }).serverTimestamp;

function assertSecretary(user: AppUser, schoolId: string) {
  if (!auth?.currentUser || auth.currentUser.uid !== user.id || user.role !== "secretary" || user.status === "inactive" || user.schoolId !== schoolId) throw new Error("Votre session ne permet pas cette opération.");
}

export function subscribeToSecretaryReports(params: { user: AppUser; schoolId: string; schoolYearId: string; onData: (reports: SecretaryReport[]) => void; onError: () => void }) {
  if (!db || params.user.role !== "secretary" || params.user.status === "inactive" || params.user.schoolId !== params.schoolId) return () => undefined;
  return onSnapshot(query(collection(db, "secretaryReports"), where("schoolId", "==", params.schoolId), where("schoolYearId", "==", params.schoolYearId)), (snapshot) => {
    params.onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as SecretaryReport).sort((a, b) => b.documentDate.localeCompare(a.documentDate) || a.id.localeCompare(b.id)));
  }, params.onError);
}

export async function createSecretaryReport(params: { user: AppUser; schoolId: string; schoolYearId: string; type: SecretaryReportType; title: string; documentDate: string; startTime: string; endTime: string; structuredContent: Record<string, string> }) {
  assertSecretary(params.user, params.schoolId);
  if (!db) throw new Error("Service de données indisponible.");
  const reportRef = doc(collection(db, "secretaryReports"));
  const now = new Date().toISOString();
  const report: SecretaryReport = { id: reportRef.id, reportNumber: `RAP-${new Date().getFullYear()}-${reportRef.id.slice(0, 8).toUpperCase()}`, type: params.type, title: params.title, documentDate: params.documentDate, startTime: params.startTime, endTime: params.endTime, structuredContent: params.structuredContent, status: "draft", authorId: params.user.id, authorName: params.user.name, schoolId: params.schoolId, schoolYearId: params.schoolYearId, createdAt: now, updatedAt: now };
  await setDoc(reportRef, { ...report, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return report;
}

export async function updateSecretaryReport(user: AppUser, report: SecretaryReport, patch: Pick<SecretaryReport, "type" | "title" | "documentDate" | "startTime" | "endTime" | "structuredContent">) {
  assertSecretary(user, report.schoolId);
  if (!db || report.status !== "draft") throw new Error("Un rapport finalisé ou archivé est en lecture seule.");
  await setDoc(doc(db, "secretaryReports", report.id), { ...patch, updatedAt: serverTimestamp() }, { merge: true });
}

export async function finalizeSecretaryReport(user: AppUser, report: SecretaryReport) {
  assertSecretary(user, report.schoolId);
  if (!db || report.status !== "draft") throw new Error("Ce rapport ne peut pas être finalisé.");
  const now = new Date().toISOString();
  await setDoc(doc(db, "secretaryReports", report.id), { status: "finalized", finalizedAt: now, updatedAt: now }, { merge: true });
}

export async function archiveSecretaryReport(user: AppUser, report: SecretaryReport) {
  assertSecretary(user, report.schoolId);
  if (!db || report.status === "archived") return;
  const now = new Date().toISOString();
  await setDoc(doc(db, "secretaryReports", report.id), { status: "archived", archivedAt: now, updatedAt: now }, { merge: true });
}
