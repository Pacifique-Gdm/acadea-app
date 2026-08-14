import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "../firebase";

export const PERSONNEL_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function uploadPersonnelPhoto(input: { schoolId: string; personnelId: string; file: File; previousPath?: string }) {
  if (!storage) throw new Error("Stockage indisponible.");
  if (!ALLOWED_TYPES.has(input.file.type)) throw new Error("La photo doit être au format JPEG, PNG ou WebP.");
  if (!input.file.size || input.file.size > PERSONNEL_PHOTO_MAX_BYTES) throw new Error("La photo ne doit pas dépasser 5 Mo.");
  const extension = input.file.type === "image/png" ? "png" : input.file.type === "image/webp" ? "webp" : "jpg";
  const path = `personnel-photos/${input.schoolId}/${input.personnelId}/${crypto.randomUUID()}.${extension}`;
  const target = ref(storage, path);
  await uploadBytes(target, input.file, { contentType: input.file.type, customMetadata: { schoolId: input.schoolId, personnelId: input.personnelId } });
  const url = await getDownloadURL(target);
  return { photoPath: path, photoUrl: url };
}

export async function deletePersonnelPhoto(path?: string) {
  if (storage && path) await deleteObject(ref(storage, path)).catch(() => undefined);
}
