import { randomUUID } from "node:crypto";
import { FieldValue, getFirestore, type DocumentData } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { HttpsError, onCall } from "firebase-functions/v2/https";

const MAX_BYTES = 10 * 1024 * 1024;
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};
type Action = "upload" | "download" | "purge";
type Identity = { uid: string; role: unknown; schoolId: unknown };

export function assertCorrespondenceFileAccess(identity: Identity, profile: DocumentData | undefined, school: DocumentData | undefined, correspondence: DocumentData | undefined, action: Action) {
  const schoolId = identity.schoolId;
  if (identity.role !== "secretary" || typeof schoolId !== "string" || !schoolId || !profile
    || profile.role !== "secretary" || profile.schoolId !== schoolId || profile.status === "inactive" || profile.active === false) {
    throw new HttpsError("permission-denied", "Accès réservé au Secrétaire actif de cet établissement.");
  }
  if (!school || ["suspended", "inactive", "deleting"].includes(school.status)) {
    throw new HttpsError("permission-denied", "Cet établissement n'autorise pas l'accès aux pièces jointes.");
  }
  if (!correspondence || correspondence.schoolId !== schoolId) {
    throw new HttpsError("permission-denied", "Courrier hors établissement ou introuvable.");
  }
  if (action !== "download" && correspondence.status === "archived") {
    throw new HttpsError("failed-precondition", "Ce courrier archivé est en lecture seule.");
  }
  return schoolId;
}

export function correspondenceFilePrefix(schoolId: string, correspondenceId: string) {
  return `schools/${schoolId}/correspondences/${correspondenceId}/`;
}

export function assertCorrespondenceFilePath(path: unknown, schoolId: string, correspondenceId: string): string {
  const prefix = correspondenceFilePrefix(schoolId, correspondenceId);
  const fileName = typeof path === "string" && path.startsWith(prefix) ? path.slice(prefix.length) : "";
  if (!fileName || fileName === "." || fileName === ".." || fileName.includes("/") || fileName.includes("\\")) {
    throw new HttpsError("permission-denied", "Chemin de pièce jointe invalide.");
  }
  return path as string;
}

export function decodeCorrespondenceFile(input: { name: unknown; contentType: unknown; dataBase64: unknown }) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const contentType = input.contentType;
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  const encoded = input.dataBase64;
  if (!name || name.length > 120 || name.includes("/") || name.includes("\\") || !MIME_BY_EXTENSION[extension]
    || MIME_BY_EXTENSION[extension] !== contentType || typeof encoded !== "string"
    || !encoded || encoded.length > Math.ceil(MAX_BYTES / 3) * 4
    || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new HttpsError("invalid-argument", "Pièce jointe invalide.");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.length > MAX_BYTES || bytes.toString("base64") !== encoded) {
    throw new HttpsError("invalid-argument", "Pièce jointe invalide.");
  }
  return { name, contentType: contentType as string, bytes, extension };
}

export async function handleSecretaryCorrespondenceFile(request: { auth: { uid: string; token: Record<string, unknown> } | null; data: Record<string, unknown> }) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentification requise.");
  const identity: Identity = { uid: request.auth.uid, role: request.auth.token.role, schoolId: request.auth.token.schoolId };
  const action = request.data?.action;
  const correspondenceId = request.data?.correspondenceId;
  if ((action !== "upload" && action !== "download" && action !== "purge")
    || typeof correspondenceId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(correspondenceId)) {
    throw new HttpsError("invalid-argument", "Action ou courrier invalide.");
  }
  const db = getFirestore();
  const profileRef = db.doc(`users/${identity.uid}`);
  const schoolRef = typeof identity.schoolId === "string" && identity.schoolId ? db.doc(`schools/${identity.schoolId}`) : null;
  const correspondenceRef = db.doc(`correspondences/${correspondenceId}`);
  if (!schoolRef) throw new HttpsError("permission-denied", "Établissement invalide.");
  const readState = async () => {
    const [profile, school, correspondence] = await Promise.all([profileRef.get(), schoolRef.get(), correspondenceRef.get()]);
    const value = correspondence.data();
    const schoolId = assertCorrespondenceFileAccess(identity, profile.data(), school.data(), value, action);
    return { schoolId, correspondence: value ?? {} };
  };
  const state = await readState();
  const bucket = getStorage().bucket();

  if (action === "download") {
    const attachment = state.correspondence.attachment;
    const path = assertCorrespondenceFilePath(attachment?.path, state.schoolId, correspondenceId);
    const [bytes] = await bucket.file(path).download();
    if (!bytes.length || bytes.length > MAX_BYTES) throw new HttpsError("failed-precondition", "Taille de pièce jointe invalide.");
    const current = await readState();
    if (current.correspondence.attachment?.path !== path) throw new HttpsError("failed-precondition", "Cette pièce jointe a changé. Réessayez.");
    return { name: typeof attachment.name === "string" ? attachment.name : "document", contentType: typeof attachment.type === "string" ? attachment.type : "application/octet-stream", dataBase64: bytes.toString("base64") };
  }

  if (action === "purge") {
    const path = assertCorrespondenceFilePath(request.data?.path, state.schoolId, correspondenceId);
    if (state.correspondence.attachment?.path === path) throw new HttpsError("failed-precondition", "Une pièce jointe active ne peut pas être supprimée.");
    await bucket.file(path).delete({ ignoreNotFound: true });
    return { deleted: true };
  }

  const file = decodeCorrespondenceFile({ name: request.data?.name, contentType: request.data?.contentType, dataBase64: request.data?.dataBase64 });
  const path = `${correspondenceFilePrefix(state.schoolId, correspondenceId)}${randomUUID()}.${file.extension}`;
  const storageFile = bucket.file(path);
  await storageFile.save(file.bytes, { resumable: false, contentType: file.contentType, preconditionOpts: { ifGenerationMatch: 0 } });
  let oldPath: string | undefined;
  try {
    await db.runTransaction(async (transaction) => {
      const [profile, school, correspondence] = await Promise.all([
        transaction.get(profileRef), transaction.get(schoolRef), transaction.get(correspondenceRef),
      ]);
      const current = correspondence.data();
      assertCorrespondenceFileAccess(identity, profile.data(), school.data(), current, "upload");
      oldPath = typeof current?.attachment?.path === "string" ? current.attachment.path : undefined;
      transaction.update(correspondenceRef, {
        attachment: { name: file.name, type: file.contentType, size: file.bytes.length, path },
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (error) {
    await storageFile.delete({ ignoreNotFound: true }).catch(() => undefined);
    throw error;
  }
  if (oldPath && oldPath !== path) {
    try { await bucket.file(assertCorrespondenceFilePath(oldPath, state.schoolId, correspondenceId)).delete({ ignoreNotFound: true }); }
    catch { /* Une ancienne pièce reste inaccessible depuis l'application ; nettoyage différé. */ }
  }
  return { attachment: { name: file.name, type: file.contentType, size: file.bytes.length, path } };
}

export const secretaryCorrespondenceFile = onCall({ region: "europe-west1", memory: "512MiB", timeoutSeconds: 120, invoker: "public" }, async (request) =>
  handleSecretaryCorrespondenceFile({ auth: request.auth ? { uid: request.auth.uid, token: request.auth.token } : null, data: request.data }));
