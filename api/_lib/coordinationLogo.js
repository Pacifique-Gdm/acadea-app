import { FieldValue } from "firebase-admin/firestore";
import { isValidLogoThumbnail } from "./logoThumbnail.js";
import { schoolLogoVersion } from "./schoolLogo.js";

// Logo de la coordination rangé à part, comme celui des écoles :
// `coordinationLogos/{coordinationId}` contient l'image complète (écrite par le
// serveur seulement) ; la coordination garde `logoVersion` et la vignette des
// listes `logoThumbUrl` (environ 4 Ko).
export const COORDINATION_LOGO_COLLECTION = "coordinationLogos";

/** Même repère que pour les écoles : empreinte SHA-256 du contenu (16 caractères). */
export const coordinationLogoVersion = schoolLogoVersion;

/**
 * Prépare l'enregistrement d'un nouveau logo dans un lot d'écritures.
 * Retourne les champs à poser sur le document de la coordination.
 */
export function stageCoordinationLogoWrite(db, writer, { coordinationId, logoUrl, logoThumbUrl, updatedAt, updatedBy }) {
  const logoRef = db.doc(`${COORDINATION_LOGO_COLLECTION}/${coordinationId}`);
  const logoVersion = coordinationLogoVersion(logoUrl);
  if (logoUrl) writer.set(logoRef, { coordinationId, logoUrl, logoVersion, updatedAt, updatedBy });
  else writer.delete(logoRef);
  const thumbnail = logoUrl && isValidLogoThumbnail(logoThumbUrl) ? logoThumbUrl : FieldValue.delete();
  return { logoUrl: FieldValue.delete(), logoVersion, logoThumbUrl: thumbnail };
}
