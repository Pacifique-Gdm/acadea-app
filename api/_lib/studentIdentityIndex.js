import { createHash } from "node:crypto";
import { studentAlphabeticalKey, studentIdentityKey } from "../../src/utils/studentSearch.js";

/** Index des identités d'élèves par école (lot 8).
 * Tant que le marqueur d'une école n'indique pas « complete », l'inscription
 * garde l'ancienne vérification complète des doublons : le code est sûr même
 * s'il est mis en production avant la migration. La migration ne lit que les
 * noms (jamais les photos) et n'efface rien. */
export const IDENTITY_INDEX_VERSION = 1;
const BATCH_LIMIT = 400;

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

  const writes = [
    ...locksToCreate.map((lock) => (batch) => batch.create(db.doc(`studentIdentityLocks/${identityLockId(schoolId, lock.key)}`), { schoolId, studentId: lock.studentId, key: lock.key, createdBy: "identity-index-migration", createdAt: now })),
    ...missingSortName.map((row) => (batch) => batch.update(db.doc(`students/${row.id}`), { sortName: row.sortName })),
  ];
  for (let offset = 0; offset < writes.length; offset += BATCH_LIMIT) {
    const batch = db.batch();
    for (const write of writes.slice(offset, offset + BATCH_LIMIT)) write(batch);
    await batch.commit();
  }
  await identityIndexStateRef(db, schoolId).set({ schoolId, status: "complete", version: IDENTITY_INDEX_VERSION, completedAt: now,
    students: plan.students, identities: plan.identities, locksCreated: plan.locksToCreate, sortNameBackfilled: plan.sortNameToBackfill });
  return { ...plan, applied: true };
}
