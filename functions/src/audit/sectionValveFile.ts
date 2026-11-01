import { getFirestore, type DocumentData } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { HttpsError } from "firebase-functions/v2/https";

const roles = ["kindergarten_admin", "primary_admin", "studies_prefect"];
const sections = ["Maternelle", "Primaire", "CTEB", "Secondaire"];
const maxBytes = 10 * 1024 * 1024;
const types = ["application/pdf", "image/jpeg", "image/png", "text/plain", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation"];
const deny = () => { throw new HttpsError("permission-denied", "Document hors du périmètre autorisé."); };

export function assertSectionValveFile(token: Record<string, unknown>, profile: DocumentData | undefined, school: DocumentData | undefined, publication: DocumentData | undefined, id: string, path: string) {
  if (!profile || !roles.includes(String(token.role)) || profile.role !== token.role || profile.schoolId !== token.schoolId
    || profile.status !== "active" || profile.active === false || !Array.isArray(profile.sectionIds) || !profile.sectionIds.length
    || profile.sectionIds.some((section: unknown) => !sections.includes(String(section))) || school?.status !== "active"
    || !publication || publication.schoolId !== token.schoolId || !profile.sectionIds.includes(publication.visibility)) return deny();
  const prefix = `valves/${token.schoolId}/${publication.schoolYearId}/${id}/`;
  const tail = path.startsWith(prefix) ? path.slice(prefix.length) : "";
  if (!tail || tail.includes("/") || tail.includes("\\") || tail.includes("..")) return deny();
  const items = Array.isArray(publication.attachments) ? publication.attachments : [{ path: publication.attachmentPath, name: publication.attachmentName, type: publication.attachmentType, size: publication.attachmentSize }];
  const file = items.find((item: { path?: string }) => item?.path === path);
  if (!file || !types.includes(file.type) || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > maxBytes) return deny();
  return { path, type: file.type as string, size: file.size as number, name: typeof file.name === "string" ? file.name.slice(0, 120) : "document" };
}

export async function handleSectionValveFile(request: { auth: { uid: string; token: Record<string, unknown> } | null; data: Record<string, unknown> }) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentification requise.");
  const { valveId, path } = request.data;
  const { uid, token } = request.auth;
  if (typeof valveId !== "string" || !/^[\w-]{1,180}$/.test(valveId) || typeof path !== "string" || path.length > 700
    || typeof token.schoolId !== "string" || !/^[\w-]{1,180}$/.test(token.schoolId)) throw new HttpsError("invalid-argument", "Référence invalide.");
  const db = getFirestore();
  const read = () => db.runTransaction(async (tx) => {
    const [profile, school, publication] = await tx.getAll(db.doc(`users/${uid}`), db.doc(`schools/${token.schoolId}`), db.doc(`valves/${valveId}`));
    return assertSectionValveFile(token, profile?.data(), school?.data(), publication?.data(), valveId, path);
  });
  const file = await read();
  const storageFile = getStorage().bucket().file(file.path);
  const [metadata] = await storageFile.getMetadata();
  if (Number(metadata.size) !== file.size || metadata.contentType !== file.type) throw new HttpsError("failed-precondition", "Fichier incohérent.");
  const [bytes] = await storageFile.download({ start: 0, end: maxBytes });
  const current = await read();
  if (bytes.length !== file.size || current.path !== file.path || current.size !== file.size || current.type !== file.type) throw new HttpsError("failed-precondition", "Document modifié. Réessayez.");
  return { name: file.name, contentType: file.type, dataBase64: bytes.toString("base64") };
}
