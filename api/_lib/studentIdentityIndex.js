import { createHash } from "node:crypto";
import { studentAlphabeticalKey, studentIdentityKey } from "../../src/utils/studentSearch.js";

/** Index des identités d'élèves par école (lot 8).
 * Tant que le marqueur d'une école n'indique pas « complete », l'inscription
 * garde l'ancienne vérification complète des doublons : le code est sûr même
 * s'il est mis en production avant la migration. La migration ne lit que les
 * noms (jamais les photos) et n'efface rien. */
export const IDENTITY_INDEX_VERSION = 1;

export function identityLockId(schoolId, key) {
  return createHash("sha256").update(`${schoolId}\0${key}`).digest("hex");
}

export function identityIndexStateRef(db, schoolId) {
  return db.doc(`studentIdentityIndexStates/${schoolId}`);
}

export function identityIndexReady(snapshot) {
  const data = snapshot?.exists ? snapshot.data() : undefined;
  return data?.status === "complete" && data?.version === IDENTITY_INDEX_VERSION;
}

/** Élèves de l'école dont le nom trié correspond : les seuls doublons possibles. */
export function identityCandidatesQuery(db, schoolId, student) {
  return db.collection("students").where("schoolId", "==", schoolId).where("sortName", "==", studentAlphabeticalKey(student));
}

/** Prépare (simulation) ou applique la migration d'une école :
 * - un verrou d'identité pour chaque identité qui n'en a pas ;
 * - le champ de tri `sortName` sur les fiches anciennes qui ne l'ont pas ;
 * - le marqueur « complete » en dernier. */
export async function migrateStudentIdentityIndex({ db, schoolId, apply = false, now = new Date().toISOString() }) {
  if (typeof schoolId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(schoolId)) throw new Error("Identifiant d'école invalide.");
  const snapshot = await db.collection("students").where("schoolId", "==", schoolId).select("nom", "postnom", "prenom", "sortName").get();
  const byKey = new Map();
  const missingSortName = [];
  for (const document of snapshot.docs) {
    const data = document.data();
    const key = studentIdentityKey(data);
    byKey.set(key, [...(byKey.get(key) ?? []), document.id]);
    const expected = studentAlphabeticalKey(data);
    if (data.sortName !== expected) missingSortName.push({ id: document.id, sortName: expected });
  }
  const keys = [...byKey.keys()].sort();
  const lockSnapshots = keys.length ? await db.getAll(...keys.map((key) => db.doc(`studentIdentityLocks/${identityLockId(schoolId, key)}`))) : [];
  const locksToCreate = keys.filter((_key, index) => !lockSnapshots[index].exists)
    .map((key) => ({ key, studentId: [...byKey.get(key)].sort()[0] }));
  const plan = { schoolId, students: snapshot.size, identities: keys.length, locksToCreate: locksToCreate.length, sortNameToBackfill: missingSortName.length, applied: false };
  if (!apply) return plan;

  // Chaque écriture vérifie, dans une transaction, que la fiche n'a pas changé
  // depuis la lecture : un élève renommé entre-temps n'est jamais remis à l'ancien nom.
  let conflicts = 0;
  for (const lock of locksToCreate) {
    const written = await db.runTransaction(async (transaction) => {
      const lockRef = db.doc(`studentIdentityLocks/${identityLockId(schoolId, lock.key)}`);
      const [lockSnapshot, studentSnapshot] = await Promise.all([transaction.get(lockRef), transaction.get(db.doc(`students/${lock.studentId}`))]);
      const student = studentSnapshot.exists ? studentSnapshot.data() : undefined;
      if (lockSnapshot.exists || student?.schoolId !== schoolId || studentIdentityKey(student) !== lock.key) return false;
      transaction.create(lockRef, { schoolId, studentId: lock.studentId, key: lock.key, createdBy: "identity-index-migration", createdAt: now });
      return true;
    });
    if (!written) conflicts += 1;
  }
  for (const row of missingSortName) {
    const written = await db.runTransaction(async (transaction) => {
      const reference = db.doc(`students/${row.id}`);
      const snapshot = await transaction.get(reference);
      const current = snapshot.exists ? snapshot.data() : undefined;
      if (!current || current.schoolId !== schoolId || studentAlphabeticalKey(current) !== row.sortName || current.sortName === row.sortName) return false;
      transaction.update(reference, { sortName: row.sortName });
      return true;
    });
    if (!written) conflicts += 1;
  }
  // Contrôle de cohérence AVANT le marqueur : chaque identité a son verrou et
  // chaque fiche son nom de recherche exact ; sinon la migration sera relancée.
  const check = await db.collection("students").where("schoolId", "==", schoolId).select("nom", "postnom", "prenom", "sortName").get();
  const checkKeys = [...new Set(check.docs.map((document) => studentIdentityKey(document.data())))];
  const checkLocks = checkKeys.length ? await db.getAll(...checkKeys.map((key) => db.doc(`studentIdentityLocks/${identityLockId(schoolId, key)}`))) : [];
  const consistent = checkLocks.every((snapshot) => snapshot.exists)
    && check.docs.every((document) => document.data().sortName === studentAlphabeticalKey(document.data()));
  if (!consistent) return { ...plan, applied: true, consistent: false, conflicts };
  await identityIndexStateRef(db, schoolId).set({ schoolId, status: "complete", version: IDENTITY_INDEX_VERSION, completedAt: now,
    students: check.size, identities: checkKeys.length, locksCreated: plan.locksToCreate - conflicts, sortNameBackfilled: plan.sortNameToBackfill });
  return { ...plan, applied: true, consistent: true, conflicts };
}
