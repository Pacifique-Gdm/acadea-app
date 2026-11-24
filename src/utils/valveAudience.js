// Public d'une publication Valves, lisible par les règles de sécurité.
// Partagé par l'écran (publication, modification) et par le script de reprise
// `scripts/valvesAudienceBackfill.mjs` : un seul calcul, le même partout.
//
// - « Tous les parents » : audienceAll = true, audienceParentIds = [].
// - Section ou classe : audienceAll = false, audienceParentIds = parents d'un enfant
//   ACTIF de cette école et de cette année, dans la section ou la classe visée.
// La liste est calculée à la publication (et recalculée à chaque modification).
import { getClassSection } from "./studentYearTransition.js";

const VALVE_CLASS_SEPARATOR = "::option::";
/** Plus grande liste acceptée par les règles (taille du document maîtrisée). */
export const MAX_VALVE_AUDIENCE_PARENTS = 5000;

export function normalizeValveAudienceVisibility(value) {
  if (value === "parents" || value === "all" || value === "staff") return "all_parents";
  return typeof value === "string" ? value : "";
}

export function valveStudentClassKey(student) {
  const option = typeof student?.option === "string" ? student.option.trim() : "";
  return getClassSection(student?.className) === "Secondaire" && option ? `${student.className}${VALVE_CLASS_SEPARATOR}${option}` : student?.className;
}

export function isEnrolledValveStudent(student) {
  return (student?.status ?? "ACTIVE") === "ACTIVE";
}

/** La publication vise-t-elle cet élève (sans regarder son statut) ? */
export function valveTargetsStudent(publication, student) {
  const visibility = normalizeValveAudienceVisibility(publication?.visibility);
  if (visibility === "all_parents") return true;
  if (visibility === "class") return Boolean(publication?.targetClassKey) && valveStudentClassKey(student) === publication.targetClassKey;
  return Boolean(visibility) && getClassSection(student?.className) === visibility;
}

/** Calcule { audienceAll, audienceParentIds } pour une publication. */
export function computeValveAudience(publication, parents = [], students = []) {
  const visibility = normalizeValveAudienceVisibility(publication?.visibility);
  if (visibility === "all_parents") return { audienceAll: true, audienceParentIds: [] };
  const targeted = students.filter((student) => student?.schoolId === publication?.schoolId
    && (!student?.schoolYearId || student.schoolYearId === publication?.schoolYearId)
    && isEnrolledValveStudent(student)
    && valveTargetsStudent(publication, student));
  const ids = new Set();
  for (const student of targeted) if (typeof student.parentId === "string" && student.parentId) ids.add(student.parentId);
  for (const parent of parents) {
    if (!parent?.id || (parent.schoolId && parent.schoolId !== publication?.schoolId)) continue;
    const studentIds = Array.isArray(parent.studentIds) ? parent.studentIds : [];
    if (targeted.some((student) => student.parentId === parent.id || studentIds.includes(student.id))) ids.add(parent.id);
  }
  return { audienceAll: false, audienceParentIds: [...ids].sort() };
}

/** Cas douteux pour la reprise : visibilité absente ou inconnue, classe précise sans classe. */
export function valveAudienceDoubt(publication, knownSections = ["Maternelle", "Primaire", "CTEB", "Secondaire"]) {
  const raw = publication?.visibility;
  const visibility = normalizeValveAudienceVisibility(raw);
  if (!raw) return "visibilité absente";
  if (visibility === "class" && !publication?.targetClassKey) return "classe précise sans classe";
  if (visibility !== "all_parents" && visibility !== "class" && !knownSections.includes(visibility)) return `visibilité inconnue (${String(raw)})`;
  return "";
}
