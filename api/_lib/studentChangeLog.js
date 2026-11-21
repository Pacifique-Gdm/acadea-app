// Lot C : historique des fiches élèves (qui, quand, avant / après), écrit par le serveur seul,
// dans la même transaction que la fiche. Lu par l'administrateur de l'école.

/** Champs suivis. La photo n'est jamais copiée : seul son changement est noté. */
export const STUDENT_TRACKED_FIELDS = Object.freeze([
  "matricule", "nom", "postnom", "prenom", "sexe", "birthDate", "address", "phone",
  "className", "classId", "subClassId", "classOptionKey", "section", "option", "parentId", "status",
]);

const textValue = (value) => (value === undefined || value === null ? "" : String(value));
const photoKey = (student) => textValue(student?.photoPath) || (student?.photoUrl ? `integree:${String(student.photoUrl).length}` : "");

/** Champs modifiés entre deux fiches : { before, after, fields }. Une création compare à une fiche vide. */
export function studentChanges(previous, next) {
  const before = {};
  const after = {};
  for (const field of STUDENT_TRACKED_FIELDS) {
    const oldValue = textValue(previous?.[field]);
    const newValue = textValue(next?.[field]);
    if (oldValue === newValue) continue;
    if (previous) before[field] = oldValue;
    after[field] = newValue;
  }
  if (photoKey(previous) !== photoKey(next)) {
    if (previous) before.photo = photoKey(previous) ? "présente" : "aucune";
    after.photo = photoKey(next) ? (previous ? "modifiée" : "présente") : "aucune";
  }
  return { before, after, fields: Object.keys(after) };
}

/** Ligne d'historique prête à écrire dans `studentChangeLogs`. */
export function buildStudentChangeLog({ id, actor, previous, student, now }) {
  const changes = studentChanges(previous, student);
  return {
    id,
    schoolId: student.schoolId,
    schoolYearId: student.schoolYearId,
    studentId: student.id,
    matricule: textValue(student.matricule),
    studentName: [student.nom, student.postnom, student.prenom].map(textValue).filter(Boolean).join(" "),
    action: previous ? "update" : "create",
    actorId: actor.uid,
    actorRole: actor.role,
    actorName: textValue(actor.name) || actor.uid,
    before: changes.before,
    after: changes.after,
    fields: changes.fields,
    createdAt: now,
  };
}
