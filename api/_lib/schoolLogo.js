import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";

// Logo de l'école rangé à part (voir src/services/schoolLogo.ts) :
// `schoolLogos/{schoolId}` contient l'image, l'école ne garde que `logoVersion`.
export const SCHOOL_LOGO_COLLECTION = "schoolLogos";

/** Repère court du logo : empreinte SHA-256 de son contenu (16 caractères). */
export function schoolLogoVersion(logoUrl) {
  return logoUrl ? createHash("sha256").update(logoUrl, "utf8").digest("hex").slice(0, 16) : "";
}

/**
 * Prépare l'enregistrement d'un nouveau logo dans un lot d'écritures (batch ou
 * transaction). Retourne les champs à poser sur le document de l'école.
 */
export function stageSchoolLogoWrite(db, writer, { schoolId, logoUrl, updatedAt, updatedBy }) {
  const logoRef = db.doc(`${SCHOOL_LOGO_COLLECTION}/${schoolId}`);
  const logoVersion = schoolLogoVersion(logoUrl);
  if (logoUrl) writer.set(logoRef, { schoolId, logoUrl, logoVersion, updatedAt, updatedBy });
  else writer.delete(logoRef);
  return { logoUrl: FieldValue.delete(), logoVersion };
}
