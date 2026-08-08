import { deleteObject, ref, uploadBytes } from "firebase/storage";
import { storage } from "../firebase";
import { messageAttachmentExtension, validateMessageAttachments } from "../utils/messageAttachments";

export type PendingMessageAttachment = { name: string; type: string; size: number; path: string };

function safeName(value: string) {
  return Array.from(value)
    .map((character) => character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? "-" : character)
    .join("")
    .slice(0, 120) || "fichier";
}

export async function uploadPendingMessageAttachments(input: { schoolId: string; schoolYearId: string; senderId: string; draftId: string; files: File[] }) {
  if (!storage) throw new Error("Firebase Storage indisponible.");
  const error = validateMessageAttachments(input.files);
  if (error) throw new Error(error);
  const uploaded: PendingMessageAttachment[] = [];
  try {
    for (const file of input.files) {
      const path = `message-uploads/${input.schoolId}/${input.senderId}/${input.draftId}/${crypto.randomUUID()}${messageAttachmentExtension(file.name)}`;
      const snapshot = await uploadBytes(ref(storage, path), file, { contentType: file.type, customMetadata: { schoolId: input.schoolId, schoolYearId: input.schoolYearId, senderId: input.senderId, draftId: input.draftId, originalName: safeName(file.name) } });
      uploaded.push({ name: file.name, type: file.type, size: snapshot.metadata.size, path: snapshot.metadata.fullPath });
    }
    return uploaded;
  } catch (cause) {
    await deletePendingMessageAttachments(uploaded);
    throw cause;
  }
}

export async function deletePendingMessageAttachments(items: PendingMessageAttachment[]) {
  if (!storage) return;
  const firebaseStorage = storage;
  await Promise.allSettled(items.map((item) => deleteObject(ref(firebaseStorage, item.path))));
}
