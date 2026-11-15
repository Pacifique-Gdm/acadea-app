import { randomUUID } from "node:crypto";

/** Migration des photos d'élèves vers Storage (lot 9).
 * - COPIE seulement : l'ancienne photo intégrée (`photoUrl`) n'est jamais effacée ;
 * - une sauvegarde de chaque photo copiée est écrite AVANT toute écriture ;
 * - simulation par défaut ; une fiche déjà dotée d'un `photoPath` est ignorée (relance sans doublon). */
const EMBEDDED = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
const EXTENSION = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export async function migrateStudentPhotos({ db, bucket, schoolId, apply = false, backup, countStudents, now = new Date().toISOString(), newId = randomUUID }) {
  if (typeof schoolId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(schoolId)) throw new Error("Identifiant d'école invalide.");
  if (apply && typeof backup !== "function") throw new Error("Sauvegarde obligatoire avant la migration.");
  const snapshot = await db.collection("students").where("schoolId", "==", schoolId).select("photoUrl", "photoPath").get();
  // Une lecture coupée en route (constatée une fois sur le staging) est refusée avant toute écriture.
  if (typeof countStudents === "function") {
    const expected = await countStudents();
    if (snapshot.size !== expected) throw new Error(`Lecture incomplète des fiches (${snapshot.size} sur ${expected}) : relancez.`);
  }
  const candidates = [];
  let invalid = 0;
  let otherPhotos = 0;
  for (const document of snapshot.docs) {
    const { photoUrl, photoPath } = document.data();
    if (photoPath || typeof photoUrl !== "string" || !photoUrl) continue;
    // Photo d'un autre type (adresse web…) : jamais copiée, mais comptée.
    if (!photoUrl.startsWith("data:image/")) { otherPhotos += 1; continue; }
    const match = EMBEDDED.exec(photoUrl);
    if (!match) { invalid += 1; continue; }
    candidates.push({ id: document.id, contentType: match[1], bytes: Buffer.from(match[2], "base64"), photoUrl });
  }
  const plan = { schoolId, students: snapshot.size, photosToCopy: candidates.length, unreadablePhotos: invalid, otherPhotos,
    bytes: candidates.reduce((total, item) => total + item.bytes.length, 0), applied: false };
  if (!apply || !candidates.length) return plan;

  await backup({ schoolId, createdAt: now, photos: candidates.map(({ id, photoUrl }) => ({ id, photoUrl })) });
  let copied = 0;
  let skipped = 0;
  for (const item of candidates) {
    const path = `schools/${schoolId}/student-photos/${item.id}/${newId()}.${EXTENSION[item.contentType]}`;
    await bucket.file(path).save(item.bytes, { contentType: item.contentType, resumable: false, metadata: { metadata: { schoolId, studentId: item.id, migratedFrom: "photoUrl" } } });
    // La fiche doit être restée telle qu'elle a été lue (pas de nouvelle photo
    // entre-temps) ; sinon la copie est retirée et la photo récente conservée.
    const updated = await db.runTransaction(async (transaction) => {
      const reference = db.doc(`students/${item.id}`);
      const snapshot = await transaction.get(reference);
      const current = snapshot.exists ? snapshot.data() : undefined;
      if (!current || current.photoPath || current.photoUrl !== item.photoUrl) return false;
      transaction.update(reference, { photoPath: path, photoMigratedAt: now });
      return true;
    });
    if (updated) copied += 1;
    else { skipped += 1; await bucket.file(path).delete().catch(() => undefined); }
  }
  return { ...plan, copied, skipped, applied: true };
}
