/** Retrait des anciennes photos intégrées aux fiches d'élèves (lot 9, étape 2).
 * Une ancienne photo (`photoUrl` en data:) n'est retirée que si :
 * - la fiche pointe déjà vers SA photo Storage (`photoPath` de la même école et du même élève) ;
 * - le fichier Storage existe et a exactement la taille de l'ancienne photo (copie identique) ;
 * - une sauvegarde de toutes les photos retirées a été écrite AVANT toute écriture ;
 * - la fiche n'a pas changé entre la lecture et le retrait (vérification en transaction).
 * Simulation par défaut : rien n'est écrit sans `apply`. */
const EMBEDDED = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;

export async function removeLegacyStudentPhotos({ db, statObject, deleteField, schoolId, apply = false, backup, countStudents, now = new Date().toISOString() }) {
  if (typeof schoolId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(schoolId)) throw new Error("Identifiant d'école invalide.");
  if (apply && typeof backup !== "function") throw new Error("Sauvegarde obligatoire avant le retrait.");
  if (apply && typeof deleteField !== "function") throw new Error("Retrait de champ indisponible.");
  const snapshot = await db.collection("students").where("schoolId", "==", schoolId).select("photoUrl", "photoPath").get();
  // Une lecture coupée en route (constatée une fois sur le staging) est refusée.
  if (typeof countStudents === "function") {
    const expected = await countStudents();
    if (snapshot.size !== expected) throw new Error(`Lecture incomplète des fiches (${snapshot.size} sur ${expected}) : relancez.`);
  }
  const verified = [];
  const kept = { noStoragePhoto: 0, foreignPath: 0, missingInStorage: 0, sizeMismatch: 0, unreadable: 0 };
  for (const document of snapshot.docs) {
    const { photoUrl, photoPath } = document.data();
    if (typeof photoUrl !== "string" || !photoUrl.startsWith("data:")) continue;
    if (typeof photoPath !== "string" || !photoPath) { kept.noStoragePhoto += 1; continue; }
    if (!photoPath.startsWith(`schools/${schoolId}/student-photos/${document.id}/`)) { kept.foreignPath += 1; continue; }
    const match = EMBEDDED.exec(photoUrl);
    if (!match) { kept.unreadable += 1; continue; }
    const bytes = Buffer.from(match[1], "base64").length;
    const stored = await statObject(photoPath);
    if (!stored) { kept.missingInStorage += 1; continue; }
    if (Number(stored.size) !== bytes) { kept.sizeMismatch += 1; continue; }
    verified.push({ id: document.id, photoUrl, photoPath, bytes });
  }
  const plan = { schoolId, students: snapshot.size, photosToRemove: verified.length, bytesFreed: verified.reduce((total, item) => total + item.photoUrl.length, 0), kept, applied: false };
  if (!apply || !verified.length) return plan;

  await backup({ schoolId, createdAt: now, kind: "legacy-photo-removal", photos: verified.map(({ id, photoUrl, photoPath }) => ({ id, photoUrl, photoPath })) });
  let removed = 0;
  let changed = 0;
  for (const item of verified) {
    const done = await db.runTransaction(async (transaction) => {
      const reference = db.doc(`students/${item.id}`);
      const current = await transaction.get(reference);
      const data = current.exists ? current.data() : undefined;
      if (!data || data.photoPath !== item.photoPath || data.photoUrl !== item.photoUrl) return false;
      transaction.update(reference, { photoUrl: deleteField() });
      return true;
    });
    if (done) removed += 1; else changed += 1;
  }
  return { ...plan, removed, changed, applied: true };
}
