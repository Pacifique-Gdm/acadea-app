import { deleteObject, getBlob, ref, uploadBytes } from "firebase/storage";
import { storage } from "../firebase";
import type { Student } from "../types";

/** Photos d'élèves dans Firebase Storage (lot 9).
 * - Lecture toujours avec l'identité de l'utilisateur (règles Storage appliquées),
 *   jamais par adresse de téléchargement à jeton.
 * - L'application lit d'abord la photo Storage (`photoPath`), sinon l'ancienne
 *   photo intégrée à la fiche (`photoUrl`), qui n'est jamais effacée ici. */
export const STUDENT_PHOTO_MAX_BYTES = 400 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export function studentPhotoPathMatches(path: unknown, schoolId: string, studentId: string) {
  return typeof path === "string" && path.startsWith(`schools/${schoolId}/student-photos/${studentId}/`)
    && /^[0-9a-fA-F-]{36}\.(jpg|png|webp)$/.test(path.slice(`schools/${schoolId}/student-photos/${studentId}/`.length));
}

export function isEmbeddedPhoto(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:image/");
}

/** Une photo doit partir dans Storage seulement si elle vient d'être choisie
 * (données intégrées différentes de la photo déjà enregistrée) et sans chemin Storage. */
export function needsStorageUpload(student: Pick<Student, "photoUrl" | "photoPath">, previousPhoto: string) {
  return !student.photoPath && isEmbeddedPhoto(student.photoUrl) && student.photoUrl !== previousPhoto;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error("Photo invalide.");
  const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: match[1] });
}

export async function uploadStudentPhoto(input: { schoolId: string; studentId: string; dataUrl: string }) {
  if (!storage) throw new Error("Stockage indisponible.");
  const blob = dataUrlToBlob(input.dataUrl);
  if (!blob.size || blob.size > STUDENT_PHOTO_MAX_BYTES) throw new Error("La photo ne doit pas dépasser 400 Ko.");
  const path = `schools/${input.schoolId}/student-photos/${input.studentId}/${crypto.randomUUID()}.${TYPES[blob.type]}`;
  await uploadBytes(ref(storage, path), blob, { contentType: blob.type, customMetadata: { schoolId: input.schoolId, studentId: input.studentId } });
  return path;
}

/** Retire une photo envoyée pour une inscription finalement refusée. */
export async function deleteStudentPhoto(path: string) {
  if (storage && path) await deleteObject(ref(storage, path)).catch(() => undefined);
}

const objectUrls = new Map<string, Promise<string>>();

/** Adresse locale (blob:) de la photo Storage, lue avec l'identité de l'utilisateur. */
export function loadStudentPhotoUrl(path: string): Promise<string> {
  const known = objectUrls.get(path);
  if (known) return known;
  if (!storage) return Promise.reject(new Error("Stockage indisponible."));
  const pending = getBlob(ref(storage, path)).then((blob) => URL.createObjectURL(blob));
  pending.catch(() => objectUrls.delete(path));
  objectUrls.set(path, pending);
  return pending;
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Lecture de la photo impossible."));
    reader.readAsDataURL(blob);
  });
}

/** Pour les PDF : la photo est intégrée sous forme de données (Storage d'abord, sinon l'ancienne). */
export async function withPhotoForPdf<T extends Pick<Student, "photoUrl" | "photoPath">>(student: T, read = (path: string) => getBlob(ref(storage!, path))): Promise<T> {
  if (!student.photoPath || !storage) return student;
  try {
    return { ...student, photoUrl: await blobToDataUrl(await read(student.photoPath)) };
  } catch {
    return student;
  }
}
