import { ref, uploadBytes } from "firebase/storage";
import { auth, storage } from "../firebase";

/** Lot « 3 étapes », point 1 : photo facultative d'une justification (reçu papier, cahier de caisse…).
 * Elle est envoyée dans le dossier de l'Administrateur ; seul le serveur la lit ensuite. */
export const PROOF_PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const PROOF_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export function proofPhotoProblem(file: File): string | null {
  if (!PROOF_PHOTO_TYPES[file.type]) return "Choisissez une photo JPEG, PNG ou WEBP.";
  if (file.size <= 0 || file.size > PROOF_PHOTO_MAX_BYTES) return "La photo doit faire 5 Mo au plus.";
  return null;
}

export async function uploadProofPhoto(schoolId: string, file: File): Promise<string> {
  const problem = proofPhotoProblem(file);
  if (problem) throw new Error(problem);
  if (!storage || !auth?.currentUser) throw new Error("Envoi de la photo indisponible : réessayez.");
  const path = `fee-allocation-proofs/${schoolId}/${auth.currentUser.uid}/${crypto.randomUUID().replaceAll("-", "")}.${PROOF_PHOTO_TYPES[file.type]}`;
  await uploadBytes(ref(storage, path), file, { contentType: file.type });
  return path;
}
