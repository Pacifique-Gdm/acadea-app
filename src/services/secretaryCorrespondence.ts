import * as firestore from "firebase/firestore";
import { collection, doc, onSnapshot, query, runTransaction, setDoc, where } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { app, auth, db, storage } from "../firebase";
import type { AppUser } from "../types";
import type { Correspondence, CorrespondenceAttachment } from "../modules/secretary/secretaryTypes";
import { correspondenceServiceCode, generateOutgoingCorrespondenceReference } from "../utils/outgoingCorrespondenceReference";

const serverTimestamp = (firestore as unknown as { serverTimestamp: () => unknown }).serverTimestamp;

export const MAX_CORRESPONDENCE_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const mimeByExtension: Record<string, readonly string[]> = {
  pdf: ["application/pdf"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  jpg: ["image/jpeg"], jpeg: ["image/jpeg"], png: ["image/png"],
};

function assertSecretary(user: AppUser, schoolId: string) {
  if (!auth?.currentUser || auth.currentUser.uid !== user.id || user.role !== "secretary" || user.status === "inactive" || user.schoolId !== schoolId) {
    throw new Error("Votre session ne permet pas cette opération.");
  }
}

function withoutUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function deepWithoutUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepWithoutUndefined);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, deepWithoutUndefined(item)]));
  return value;
}

function timestampToIso(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") return value.toDate().toISOString();
  return "";
}

export function validateCorrespondenceAttachment(file: Pick<File, "name" | "type" | "size">) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!mimeByExtension[extension]?.includes(file.type)) return "Format de fichier non autorisé.";
  if (file.size <= 0 || file.size > MAX_CORRESPONDENCE_ATTACHMENT_BYTES) return "La pièce jointe doit avoir une taille maximale de 10 Mo.";
  return "";
}

export function subscribeToCorrespondences(params: {
  user: AppUser; schoolId: string; schoolYearId: string;
  onData: (items: Correspondence[]) => void; onError: (error: Error) => void;
}) {
  if (!db || params.user.role !== "secretary" || params.user.status === "inactive" || params.user.schoolId !== params.schoolId) return () => undefined;
  const request = query(collection(db, "correspondences"), where("schoolId", "==", params.schoolId), where("schoolYearId", "==", params.schoolYearId));
  return onSnapshot(request, (snapshot) => {
    const items = snapshot.docs.map((snapshotItem) => {
      const data = snapshotItem.data();
      return { id: snapshotItem.id, ...data, createdAt: timestampToIso(data.createdAt), updatedAt: timestampToIso(data.updatedAt) } as Correspondence;
    })
      .sort((left, right) => right.date.localeCompare(left.date) || right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
    params.onData(items);
  }, (error) => params.onError(error));
}

export async function createCorrespondence(params: {
  user: AppUser; schoolId: string; schoolYearId: string;
  input: Omit<Correspondence, "id" | "referenceNumber" | "createdBy" | "createdAt" | "updatedAt" | "schoolId" | "schoolYearId" | "attachment">;
}) {
  assertSecretary(params.user, params.schoolId);
  if (!db) throw new Error("Service de données indisponible.");
  const correspondenceRef = doc(collection(db, "correspondences"));
  const now = new Date().toISOString();
  const referenceYear = Number(params.input.date.slice(0, 4)) || new Date().getFullYear();
  const serviceCode = correspondenceServiceCode(params.input.outgoing?.issuingDepartment, params.user.role);
  let referenceNumber = `COR-${referenceYear}-${correspondenceRef.id.slice(0, 8).toUpperCase()}`;
  const item: Correspondence = {
    ...withoutUndefined(params.input),
    id: correspondenceRef.id,
    referenceNumber,
    createdBy: params.user.id,
    createdAt: now,
    updatedAt: now,
    schoolId: params.schoolId,
    schoolYearId: params.schoolYearId,
  };
  if (params.input.direction === "outgoing") {
    const counterId = `${params.schoolId}_${serviceCode}_${referenceYear}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    const counterRef = doc(db, "secretaryCounters", counterId);
    await runTransaction(db, async (transaction) => {
      const counterSnapshot = await transaction.get(counterRef);
      const currentValue = Number(counterSnapshot.data()?.value ?? 0);
      const nextValue = currentValue + 1;
      referenceNumber = generateOutgoingCorrespondenceReference({ schoolName: params.input.sender, serviceCode, order: nextValue, year: referenceYear });
      item.referenceNumber = referenceNumber;
      transaction.set(counterRef, { schoolId: params.schoolId, schoolYearId: params.schoolYearId, kind: "correspondence", serviceCode, year: referenceYear, value: nextValue, updatedAt: serverTimestamp() });
      transaction.set(correspondenceRef, deepWithoutUndefined({ ...item, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    });
  } else {
    await setDoc(correspondenceRef, deepWithoutUndefined({ ...item, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  }
  return item;
}

export async function updateCorrespondence(user: AppUser, current: Correspondence, patch: Partial<Pick<Correspondence, "direction" | "date" | "subject" | "sender" | "recipient" | "content" | "copiePourInformation" | "status" | "outgoing" | "pdfSettings" | "archivedFromStatus">>) {
  assertSecretary(user, current.schoolId);
  if (!db) throw new Error("Service de données indisponible.");
  if (current.status === "archived" && Object.keys(patch).some((key) => !["status", "archivedFromStatus", "outgoing"].includes(key))) throw new Error("Cette correspondance est en lecture seule.");
  const removeAttachment = patch.direction === "outgoing" && Boolean(current.attachment);
  await setDoc(doc(db, "correspondences", current.id), {
    ...deepWithoutUndefined(withoutUndefined(patch)) as Record<string, unknown>,
    ...(removeAttachment ? { attachment: null } : {}),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  if (removeAttachment && current.attachment?.path && storage) {
    await deleteObject(ref(storage, current.attachment.path)).catch((error) => console.warn("Ancienne pièce jointe non supprimée.", error));
  }
}

export async function archiveCorrespondence(user: AppUser, current: Correspondence) {
  return manageCorrespondence(user, current, "archive");
}

export async function unarchiveCorrespondence(user: AppUser, current: Correspondence) {
  if (current.status !== "archived") throw new Error("Ce courrier n'est pas archivé.");
  return manageCorrespondence(user, current, "restore");
}

async function manageCorrespondence(user: AppUser, current: Correspondence, action: "archive" | "restore" | "delete", confirmation?: string) {
  assertSecretary(user, current.schoolId);
  if (!app) throw new Error("Service de données indisponible.");
  const callable = httpsCallable<{ kind: "correspondence"; documentId: string; action: "archive" | "restore" | "delete"; confirmation?: string }, { storageCleanupSucceeded: boolean }>(getFunctions(app, "europe-west1"), "secretaryDeleteDocument");
  return (await callable({ kind: "correspondence", documentId: current.id, action, ...(confirmation ? { confirmation } : {}) })).data;
}

export async function deleteCorrespondencePermanently(user: AppUser, current: Correspondence, confirmation: string) {
  return manageCorrespondence(user, current, "delete", confirmation);
}

export async function replaceCorrespondenceAttachment(user: AppUser, current: Correspondence, file: File): Promise<CorrespondenceAttachment> {
  assertSecretary(user, current.schoolId);
  const validation = validateCorrespondenceAttachment(file);
  if (validation) throw new Error(validation);
  if (!db || !storage) throw new Error("Service de fichiers indisponible.");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120);
  const path = `schools/${current.schoolId}/correspondences/${current.id}/${Date.now()}-${safeName}`;
  const target = ref(storage, path);
  await uploadBytes(target, file, { contentType: file.type });
  const attachment: CorrespondenceAttachment = { name: file.name, type: file.type, size: file.size, path, url: await getDownloadURL(target) };
  try {
    await setDoc(doc(db, "correspondences", current.id), { attachment, updatedAt: serverTimestamp() }, { merge: true });
  } catch (error) {
    await deleteObject(target).catch(() => undefined);
    throw error;
  }
  if (current.attachment?.path) await deleteObject(ref(storage, current.attachment.path)).catch((error) => console.warn("Ancienne pièce jointe non supprimée.", error));
  return attachment;
}
