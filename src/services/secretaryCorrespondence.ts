import { collection, doc, onSnapshot, query, runTransaction, setDoc, where } from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { auth, db, storage } from "../firebase";
import type { AppUser } from "../types";
import type { Correspondence, CorrespondenceAttachment } from "../modules/secretary/secretaryTypes";

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
    const items = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Correspondence)
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
  const counterRef = doc(db, "secretaryCounters", `${params.schoolId}_${params.schoolYearId}_correspondence`);
  return runTransaction(db, async (transaction) => {
    const counter = await transaction.get(counterRef);
    const sequence = Number(counter.data()?.value ?? 0) + 1;
    const now = new Date().toISOString();
    const item: Correspondence = {
      ...params.input, id: correspondenceRef.id,
      referenceNumber: `COR-${new Date().getFullYear()}-${String(sequence).padStart(5, "0")}`,
      createdBy: params.user.id, createdAt: now, updatedAt: now,
      schoolId: params.schoolId, schoolYearId: params.schoolYearId,
    };
    transaction.set(counterRef, { value: sequence, schoolId: params.schoolId, schoolYearId: params.schoolYearId, kind: "correspondence", updatedAt: now });
    transaction.set(correspondenceRef, item);
    return item;
  });
}

export async function updateCorrespondence(user: AppUser, current: Correspondence, patch: Partial<Pick<Correspondence, "direction" | "date" | "subject" | "sender" | "recipient" | "content" | "status">>) {
  assertSecretary(user, current.schoolId);
  if (!db || current.status === "archived") throw new Error("Cette correspondance est en lecture seule.");
  await setDoc(doc(db, "correspondences", current.id), { ...patch, updatedAt: new Date().toISOString() }, { merge: true });
}

export async function archiveCorrespondence(user: AppUser, current: Correspondence) {
  return updateCorrespondence(user, current, { status: "archived" });
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
    await setDoc(doc(db, "correspondences", current.id), { attachment, updatedAt: new Date().toISOString() }, { merge: true });
  } catch (error) {
    await deleteObject(target).catch(() => undefined);
    throw error;
  }
  if (current.attachment?.path) await deleteObject(ref(storage, current.attachment.path)).catch((error) => console.warn("Ancienne pièce jointe non supprimée.", error));
  return attachment;
}
