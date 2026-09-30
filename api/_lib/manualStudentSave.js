import { createHash } from "node:crypto";
import { studentForPersistence } from "../../src/utils/studentYearTransition.js";
import { studentIdentityKey } from "../../src/utils/studentSearch.js";

const DUPLICATE_MESSAGE = "Un élève avec le même nom, post-nom et prénom existe déjà.";
const EDITABLE_FIELDS = ["nom", "postnom", "prenom", "sexe", "birthDate", "address", "phone", "className", "classId", "subClassId", "classOptionKey", "section", "option", "photoUrl"];
const OPTIONAL_FIELDS = ["classId", "subClassId", "classOptionKey", "section", "option", "photoUrl"];

function reject(message, statusCode = 400, code = "invalid-argument") {
  throw Object.assign(new Error(message), { statusCode, code });
}

function safeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,150}$/.test(value) ? value : "";
}

function boundedText(value, maxLength = 250, trim = true) {
  if (typeof value !== "string" || value.length > maxLength) reject("Fiche élève invalide.");
  return trim ? value.trim() : value;
}

function validatedFields(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) reject("Fiche élève invalide.");
  const result = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in input) result[field] = boundedText(input[field], field === "photoUrl" ? 900_000 : 250, !["nom", "postnom", "prenom"].includes(field));
  }
  if (!result.nom?.trim() || !result.className) reject("Le nom et la classe de l’élève sont obligatoires.");
  if (result.sexe && !["M", "F"].includes(result.sexe)) reject("Sexe invalide.");
  return result;
}

async function validClassReferences(transaction, db, student) {
  let parent;
  if (student.classId) {
    const snapshot = await transaction.get(db.doc(`classes/${student.classId}`));
    parent = snapshot.exists ? snapshot.data() : undefined;
    if (!parent || parent.schoolId !== student.schoolId || parent.schoolYearId !== student.schoolYearId || parent.parentClassId || parent.active === false) reject("Classe hors périmètre.", 403, "permission-denied");
  }
  if (student.subClassId) {
    const snapshot = await transaction.get(db.doc(`classes/${student.subClassId}`));
    const subclass = snapshot.exists ? snapshot.data() : undefined;
    if (!parent || !subclass || subclass.schoolId !== student.schoolId || subclass.schoolYearId !== student.schoolYearId || subclass.parentClassId !== student.classId || subclass.active === false || (subclass.classOptionKey && subclass.classOptionKey !== student.classOptionKey)) reject("Sous-classe hors périmètre.", 403, "permission-denied");
  }
}

function identityLockId(schoolId, key) {
  return createHash("sha256").update(`${schoolId}\0${key}`).digest("hex");
}

export async function saveManualStudent({ db, caller, body }) {
  const input = body?.student;
  const id = safeId(input?.id);
  const schoolId = safeId(input?.schoolId);
  const schoolYearId = safeId(input?.schoolYearId);
  if (!id || !schoolId || !schoolYearId) reject("Identifiants de la fiche élève invalides.");
  if (!["school_admin", "secretary"].includes(caller?.role) || caller.schoolId !== schoolId || !caller.uid) reject("Enregistrement de l’élève non autorisé.", 403, "permission-denied");
  const fields = validatedFields(input);
  const studentRef = db.doc(`students/${id}`);
  const actorRef = db.doc(`users/${caller.uid}`);
  const schoolRef = db.doc(`schools/${schoolId}`);
  const yearRef = db.doc(`schoolYears/${schoolYearId}`);
  const schoolStudentsQuery = db.collection("students").where("schoolId", "==", schoolId);
  return db.runTransaction(async (transaction) => {
    const [actorSnapshot, schoolSnapshot, yearSnapshot, existingSnapshot] = await Promise.all([
      transaction.get(actorRef), transaction.get(schoolRef), transaction.get(yearRef), transaction.get(studentRef),
    ]);
    const actor = actorSnapshot.exists ? actorSnapshot.data() : undefined;
    if (!actor || actor.role !== caller.role || actor.schoolId !== schoolId || actor.status === "inactive" || actor.active === false) reject("Compte utilisateur inactif ou hors périmètre.", 403, "permission-denied");
    if (!schoolSnapshot.exists || ["deleting", "inactive", "suspended"].includes(schoolSnapshot.data()?.status)) reject("École inactive ou introuvable.", 409, "failed-precondition");
    if (!yearSnapshot.exists || yearSnapshot.data()?.schoolId !== schoolId || yearSnapshot.data()?.status !== "active") reject("Année scolaire inactive ou hors périmètre.", 409, "failed-precondition");
    const existing = existingSnapshot.exists ? existingSnapshot.data() : undefined;
    if (existing && (existing.schoolId !== schoolId || existing.schoolYearId !== schoolYearId || existing.deletedAt || existing.status !== "ACTIVE")) reject("Élève hors périmètre ou archivé.", 403, "permission-denied");
    if (!existing && (!id.startsWith("student-") || input.status !== "ACTIVE")) reject("Création d’élève invalide.");
    const next = existing ? { ...existing, ...fields } : {
      id, schoolId, schoolYearId, annee_scolaire_id: schoolYearId,
      matricule: boundedText(input.matricule, 100), status: "ACTIVE",
      postnom: "", prenom: "", sexe: "M", birthDate: "", address: "", phone: "",
      ...fields,
      biometric: input.biometric && typeof input.biometric === "object" && !Array.isArray(input.biometric) ? input.biometric : undefined,
    };
    if (!existing && !next.matricule) reject("Matricule requis.");
    if (existing) for (const key of OPTIONAL_FIELDS) if (!(key in fields)) delete next[key];
    await validClassReferences(transaction, db, next);
    const oldKey = existing ? studentIdentityKey(existing) : "";
    const newKey = studentIdentityKey(next);
    const identityChanged = !existing || oldKey !== newKey;
    let oldLockRef;
    let oldLockSnapshot;
    let newLockRef;
    if (identityChanged) {
      const students = await transaction.get(schoolStudentsQuery);
      if (students.docs.some((snapshot) => snapshot.id !== id && studentIdentityKey(snapshot.data()) === newKey)) reject(DUPLICATE_MESSAGE, 409, "duplicate-student");
      newLockRef = db.doc(`studentIdentityLocks/${identityLockId(schoolId, newKey)}`);
      const newLockSnapshot = await transaction.get(newLockRef);
      if (newLockSnapshot.exists && newLockSnapshot.data()?.studentId !== id) reject(DUPLICATE_MESSAGE, 409, "duplicate-student");
      if (existing) {
        oldLockRef = db.doc(`studentIdentityLocks/${identityLockId(schoolId, oldKey)}`);
        oldLockSnapshot = await transaction.get(oldLockRef);
        if (oldLockSnapshot.exists && oldLockSnapshot.data()?.studentId === id && !students.docs.some((snapshot) => snapshot.id !== id && studentIdentityKey(snapshot.data()) === oldKey)) transaction.delete(oldLockRef);
      }
    }
    const student = studentForPersistence(next);
    if (existing) transaction.set(studentRef, student);
    else transaction.create(studentRef, student);
    if (identityChanged) transaction.set(newLockRef, { schoolId, studentId: id, key: newKey });
    return { student };
  });
}
