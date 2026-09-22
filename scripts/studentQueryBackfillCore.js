const TECHNICAL_FIELDS = ["sortName", "searchPrefixes", "searchArchived"];

const owns = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function equalField(left, right) {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }
  return left === right;
}

export function planStudentQueryFields(student, projector) {
  const projected = projector(student);
  if (typeof projected.sortName !== "string" || !projected.sortName || !Array.isArray(projected.searchPrefixes)
    || !projected.searchPrefixes.every((value) => typeof value === "string")
    || typeof projected.searchArchived !== "boolean") {
    throw new Error("Projection technique élève invalide : aucune écriture autorisée.");
  }
  const changes = {};
  const original = {};
  for (const field of TECHNICAL_FIELDS) {
    original[field] = { existed: owns(student, field), value: owns(student, field) ? student[field] : null };
    if (!owns(student, field) || !equalField(student[field], projected[field])) changes[field] = projected[field];
  }
  return { changes, original, projected, changedFields: Object.keys(changes) };
}

export function virtualSecondRun(student, firstPlan, projector) {
  return planStudentQueryFields({ ...student, ...firstPlan.changes }, projector).changedFields.length;
}

export function sameUpdateTime(left, right) {
  return Number.isInteger(left?.seconds) && Number.isInteger(left?.nanoseconds)
    && Number.isInteger(right?.seconds) && Number.isInteger(right?.nanoseconds)
    && left.seconds === right.seconds && left.nanoseconds === right.nanoseconds;
}

export function rollbackStudentQueryFields(original, changedFields, deleteValue) {
  const rollback = {};
  for (const field of changedFields) {
    if (!TECHNICAL_FIELDS.includes(field)) throw new Error(`Champ de rollback interdit : ${field}`);
    if (!owns(original, field)) throw new Error(`Champ de sauvegarde absent : ${field}`);
    rollback[field] = original[field].existed ? original[field].value : deleteValue;
  }
  return rollback;
}

export { TECHNICAL_FIELDS };
