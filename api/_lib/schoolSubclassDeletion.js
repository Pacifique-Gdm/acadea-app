import { FieldValue } from "firebase-admin/firestore";
import { requireActiveSchoolYear } from "./schoolYear.js";

const confirmationText = "SUPPRIMER CETTE SOUS-CLASSE";
const maxStudentsPerTransaction = 400;

function reject(message, statusCode, code) {
  throw Object.assign(new Error(message), { statusCode, code });
}

/** Deactivates one operational subclass and detaches its students in one transaction. */
export async function deleteSchoolSubclass({ db, caller, body }) {
  const schoolId = typeof body.schoolId === "string" ? body.schoolId.trim() : "";
  const schoolYearId = typeof body.schoolYearId === "string" ? body.schoolYearId.trim() : "";
  const subclassId = typeof body.subclassId === "string" ? body.subclassId.trim() : "";
  if (!schoolId || !schoolYearId || !subclassId) reject("École, année et sous-classe requises.", 400, "invalid-argument");
  if (body.confirmation !== confirmationText) reject("Confirmation de suppression invalide.", 400, "invalid-confirmation");
  if (!["school_admin", "secretary"].includes(caller?.role) || caller.schoolId !== schoolId || !caller.uid) {
    reject("Suppression de sous-classe non autorisée.", 403, "permission-denied");
  }
  await requireActiveSchoolYear(db, schoolId, schoolYearId);
  const subclassRef = db.doc(`classes/${subclassId}`);
  const callerRef = db.doc(`users/${caller.uid}`);
  const bySubclass = db.collection("students").where("subClassId", "==", subclassId).limit(maxStudentsPerTransaction + 1);
  const byClass = db.collection("students").where("classId", "==", subclassId).limit(maxStudentsPerTransaction + 1);
  return db.runTransaction(async (transaction) => {
    const [actorSnapshot, subclassSnapshot, subclassStudents, classStudents] = await Promise.all([
      transaction.get(callerRef), transaction.get(subclassRef), transaction.get(bySubclass), transaction.get(byClass),
    ]);
    const actor = actorSnapshot.exists ? actorSnapshot.data() : undefined;
    if (!actor || actor.role !== caller.role || actor.schoolId !== schoolId || actor.status === "inactive" || actor.active === false) {
      reject("Compte utilisateur inactif ou non autorisé.", 403, "permission-denied");
    }
    if (!subclassSnapshot.exists) reject("Sous-classe introuvable.", 404, "not-found");
    const subclass = subclassSnapshot.data();
    if (subclass.schoolId !== schoolId || subclass.schoolYearId !== schoolYearId) reject("Sous-classe hors périmètre.", 403, "permission-denied");
    if (!subclass.parentClassId || !subclass.subClassLabel) reject("Cette classe n'est pas une sous-classe.", 400, "invalid-argument");
    const parentSnapshot = await transaction.get(db.doc(`classes/${subclass.parentClassId}`));
    const parent = parentSnapshot.exists ? parentSnapshot.data() : undefined;
    if (!parent || parent.schoolId !== schoolId || parent.schoolYearId !== schoolYearId || parent.parentClassId) reject("Classe parent invalide.", 409, "failed-precondition");
    if (subclass.active === false) return { subclassId, updatedStudents: 0, status: "already-inactive" };
    const students = new Map([...subclassStudents.docs, ...classStudents.docs].map((snapshot) => [snapshot.id, snapshot]));
    if (students.size > maxStudentsPerTransaction || subclassStudents.size > maxStudentsPerTransaction || classStudents.size > maxStudentsPerTransaction) {
      reject(`Suppression non lancée : plus de ${maxStudentsPerTransaction} élèves liés. Contactez l'assistance pour une opération paginée.`, 409, "too-many-students");
    }
    for (const snapshot of students.values()) {
      const student = snapshot.data();
      if (student.schoolId !== schoolId || student.schoolYearId !== schoolYearId) reject("Référence élève hors périmètre.", 409, "reference-mismatch");
    }
    for (const snapshot of students.values()) {
      const student = snapshot.data();
      transaction.update(snapshot.ref, {
        ...(student.subClassId === subclassId ? { subClassId: FieldValue.delete(), subClassLabel: FieldValue.delete() } : {}),
        ...(student.classId === subclassId ? { classId: subclass.parentClassId, className: parent.name } : {}),
      });
    }
    transaction.update(subclassRef, { active: false, updatedAt: new Date().toISOString(), updatedBy: caller.uid });
    return { subclassId, updatedStudents: students.size, status: "deactivated" };
  });
}
