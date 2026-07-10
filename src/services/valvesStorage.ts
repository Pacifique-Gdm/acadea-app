import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "../firebase";
import type { ValvePublicationAttachment } from "../types";

export type ValveAttachmentUploadInput = {
  name: string;
  type: string;
  dataUrl: string;
};

export type ValveAttachmentUploadResult = {
  attachmentName: string;
  attachmentType: string;
  attachmentUrl: string;
  attachmentPath: string;
  attachmentSize: number;
};

function sanitizeStorageSegment(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "fichier";
}

function dataUrlToBlob(dataUrl: string) {
  const [header, base64Data] = dataUrl.split(",");
  const mimeMatch = header.match(/^data:([^;]+);base64$/);
  if (!mimeMatch || !base64Data) {
    throw new Error("Piece jointe Valves invalide.");
  }
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeMatch[1] });
}

export async function uploadValveAttachment(params: {
  schoolId: string;
  schoolYearId: string;
  publicationId: string;
  attachment: ValveAttachmentUploadInput;
}): Promise<ValveAttachmentUploadResult> {
  if (!storage) {
    throw new Error("Firebase Storage indisponible.");
  }

  const blob = dataUrlToBlob(params.attachment.dataUrl);
  const fileName = sanitizeStorageSegment(params.attachment.name);
  const attachmentPath = `valves/${params.schoolId}/${params.schoolYearId}/${params.publicationId}/${Date.now()}-${fileName}`;
  const attachmentRef = ref(storage, attachmentPath);
  const snapshot = await uploadBytes(attachmentRef, blob, { contentType: params.attachment.type });
  const attachmentUrl = await getDownloadURL(attachmentRef);

  return {
    attachmentName: params.attachment.name,
    attachmentType: params.attachment.type,
    attachmentUrl,
    attachmentPath: snapshot.metadata.fullPath,
    attachmentSize: snapshot.metadata.size,
  };
}

export async function uploadValveAttachments(params: {
  schoolId: string;
  schoolYearId: string;
  publicationId: string;
  attachments: ValveAttachmentUploadInput[];
}): Promise<ValvePublicationAttachment[]> {
  const uploadedAttachments: ValvePublicationAttachment[] = [];

  try {
    for (const attachment of params.attachments) {
      const uploadedAttachment = await uploadValveAttachment({
        schoolId: params.schoolId,
        schoolYearId: params.schoolYearId,
        publicationId: params.publicationId,
        attachment,
      });
      uploadedAttachments.push({
        name: uploadedAttachment.attachmentName,
        type: uploadedAttachment.attachmentType,
        url: uploadedAttachment.attachmentUrl,
        path: uploadedAttachment.attachmentPath,
        size: uploadedAttachment.attachmentSize,
      });
    }
  } catch (error) {
    await deleteValveAttachments(uploadedAttachments.map((attachment) => attachment.path));
    throw error;
  }

  return uploadedAttachments;
}

export async function deleteValveAttachment(attachmentPath?: string) {
  if (!attachmentPath || !storage) return;
  await deleteObject(ref(storage, attachmentPath));
}

export async function deleteValveAttachments(attachmentPaths: Array<string | undefined>) {
  await Promise.all(
    attachmentPaths
      .filter((attachmentPath): attachmentPath is string => Boolean(attachmentPath))
      .map((attachmentPath) =>
        deleteValveAttachment(attachmentPath).catch((error) => {
          console.warn("Suppression de la pièce jointe Valves indisponible.", error);
        }),
      ),
  );
}
