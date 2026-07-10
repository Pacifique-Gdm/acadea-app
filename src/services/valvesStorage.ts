import { deleteObject, getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
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

export type ValveAttachmentUploadProgress = {
  currentFile: number;
  totalFiles: number;
  fileName: string;
  percent: number;
};

const VALVE_ATTACHMENT_UPLOAD_TIMEOUT_MS = 60_000;

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
  onProgress?: (progress: Omit<ValveAttachmentUploadProgress, "currentFile" | "totalFiles">) => void;
}): Promise<ValveAttachmentUploadResult> {
  if (!storage) {
    throw new Error("Firebase Storage indisponible.");
  }

  const blob = dataUrlToBlob(params.attachment.dataUrl);
  const fileName = sanitizeStorageSegment(params.attachment.name);
  const attachmentPath = `valves/${params.schoolId}/${params.schoolYearId}/${params.publicationId}/${Date.now()}-${fileName}`;
  const attachmentRef = ref(storage, attachmentPath);
  const uploadTask = uploadBytesResumable(attachmentRef, blob, { contentType: params.attachment.type });
  const snapshot = await new Promise<import("firebase/storage").UploadTaskSnapshot>((resolve, reject) => {
    let settled = false;
    let unsubscribe = () => {};
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      unsubscribe();
      uploadTask.cancel();
      reject(new Error("UPLOAD_TIMEOUT"));
    }, VALVE_ATTACHMENT_UPLOAD_TIMEOUT_MS);
    const cleanup = () => {
      settled = true;
      window.clearTimeout(timeoutId);
      unsubscribe();
    };

    unsubscribe = uploadTask.on(
      "state_changed",
      (progressSnapshot) => {
        const percent = progressSnapshot.totalBytes > 0 ? Math.round((progressSnapshot.bytesTransferred / progressSnapshot.totalBytes) * 100) : 0;
        params.onProgress?.({
          fileName: params.attachment.name,
          percent: Math.min(100, Math.max(0, percent)),
        });
      },
      (error) => {
        if (settled) return;
        cleanup();
        reject(error);
      },
      () => {
        if (settled) return;
        cleanup();
        resolve(uploadTask.snapshot);
      },
    );
  });
  const attachmentUrl = await getDownloadURL(snapshot.ref);

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
  onProgress?: (progress: ValveAttachmentUploadProgress) => void;
}): Promise<ValvePublicationAttachment[]> {
  const uploadedAttachments: ValvePublicationAttachment[] = [];

  try {
    for (const [index, attachment] of params.attachments.entries()) {
      const uploadedAttachment = await uploadValveAttachment({
        schoolId: params.schoolId,
        schoolYearId: params.schoolYearId,
        publicationId: params.publicationId,
        attachment,
        onProgress: (progress) => {
          params.onProgress?.({
            ...progress,
            currentFile: index + 1,
            totalFiles: params.attachments.length,
          });
        },
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
