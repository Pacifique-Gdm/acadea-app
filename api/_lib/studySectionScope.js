// Lot R2 (Réglages par section) : un compte Direction des études AVEC sections ne voit et ne traite
// que les enseignants de SES sections. Un compte SANS section garde toute l'école (comportement inchangé).
//
// Un enseignant est « dans les sections » du compte si :
//  - il n'a lui-même aucune section (il reste visible par tous, comme dans la liste des enseignants) ;
//  - ou l'une de ses sections est une section du compte ;
//  - ou il a une affectation active dans une classe d'une section du compte.

import { normalizeSchoolSection, resolveSectionAuthority, userSectionIds } from "./sectionAuthority.js";

const clean = (values) => [...new Set(values.filter((value) => typeof value === "string" && value))];

/** Sections d'un profil (compte ou enseignant) : `sectionIds`, sinon l'ancienne `section`. */
export function profileSections(profile) {
  const values = Array.isArray(profile?.sectionIds) && profile.sectionIds.length ? profile.sectionIds : profile?.section ? [profile.section] : [];
  return clean(values);
}

/**
 * Lot B (règle unique des sections) : sections à appliquer pour un compte.
 * Liste vide = toute l'école (compte sans section, ou dont les sections couvrent toutes celles de l'école).
 * Sinon ses sections présentes dans l'école ; à défaut (sections absentes de l'école) ses propres sections,
 * pour ne jamais élargir un compte limité à toute l'école.
 */
export const NO_VALID_SECTION = "__aucune-section-valide__";

export function authoritySections(user, school) {
  // Sections renseignées mais toutes invalides : le compte reste limité (il ne voit que ce qui n'a pas de section).
  if (!userSectionIds(user ?? {}).length && profileSections(user).length) return [NO_VALID_SECTION];
  const authority = resolveSectionAuthority(user ?? {}, school ?? {});
  if (authority.wholeSchool) return [];
  return authority.sections.length ? authority.sections : userSectionIds(user ?? {});
}

/** Même calcul en lisant l'école seulement si le compte a des sections (sinon : toute l'école, sans lecture). */
export async function authoritySectionsFor(db, user, schoolId) {
  if (!profileSections(user).length) return [];
  let school = {};
  try {
    const snapshot = await db.doc(`schools/${schoolId}`).get();
    school = snapshot?.exists ? snapshot.data() ?? {} : {};
  } catch {
    // École illisible : on prend les 4 sections possibles, ce qui ne peut jamais élargir un compte limité.
  }
  return authoritySections(user, school);
}

/** Section d'un élément (classe, élève) comparable aux sections d'un compte. */
export function comparableSection(value) {
  return normalizeSchoolSection(value) ?? value;
}

/**
 * Sections d'un enseignant : celles de son COMPTE (`users`, là où l'application les enregistre et où l'écran les lit),
 * sinon celles de sa fiche (`teachers`).
 */
export function teacherSections(teacher, teacherUser) {
  const fromAccount = profileSections(teacherUser);
  return fromAccount.length ? fromAccount : profileSections(teacher);
}

/** Calcul pur. `classSectionById` : Map identifiant de classe → section. */
export function teacherInSections({ sections, teacherId, teacher, teacherUser, assignments = [], classSectionById = new Map() }) {
  if (!sections.length) return true;
  const own = teacherSections(teacher, teacherUser);
  if (!own.length) return true;
  if (own.some((section) => sections.includes(section))) return true;
  return assignments.some((assignment) => assignment.teacherId === teacherId && assignment.active !== false
    && sections.includes(classSectionById.get(assignment.classId)));
}

const serialize = (snapshot) => (snapshot.docs ?? []).map((item) => ({ id: item.id, ...item.data() }));

/**
 * Lit les affectations actives d'UN enseignant et la section de leurs classes, puis dit s'il est dans les sections.
 * `read` lit un document ou une requête (transaction.get ou lecture simple). Aucune lecture si le compte n'a pas de section
 * ou si les sections de l'enseignant suffisent à décider.
 */
export async function teacherInSectionsWithReads({ db, read, sections, schoolId, schoolYearId, teacherId, teacher, teacherUser }) {
  if (!sections.length) return true;
  const own = teacherSections(teacher, teacherUser);
  if (!own.length || own.some((section) => sections.includes(section))) return true;
  const assignments = serialize(await read(db.collection("pedagogicalAssignments").where("schoolId", "==", schoolId)
    .where("schoolYearId", "==", schoolYearId).where("teacherId", "==", teacherId).where("active", "==", true)));
  const classIds = clean(assignments.map((assignment) => assignment.classId));
  const classSectionById = new Map();
  for (const classId of classIds) {
    const snapshot = await read(db.collection("classes").doc(classId));
    const data = snapshot?.exists ? snapshot.data() : undefined;
    if (data?.schoolId === schoolId && data?.schoolYearId === schoolYearId) classSectionById.set(classId, data.section);
  }
  return teacherInSections({ sections, teacherId, teacher, teacherUser, assignments, classSectionById });
}

/** Comptes utilisateurs (userId) des enseignants de l'année qui sont dans les sections du compte. */
export async function teacherUserIdsInSections({ db, sections, schoolId, schoolYearId }) {
  const scoped = (name) => db.collection(name).where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId);
  const [teachers, assignments, classes, teacherUsers] = await Promise.all([
    scoped("teachers").get().then(serialize),
    scoped("pedagogicalAssignments").where("active", "==", true).get().then(serialize),
    scoped("classes").get().then(serialize),
    db.collection("users").where("schoolId", "==", schoolId).where("role", "==", "teacher").get().then(serialize),
  ]);
  const userById = new Map(teacherUsers.map((item) => [item.id, item]));
  const classSectionById = new Map(classes.map((item) => [item.id, item.section]));
  return new Set(teachers
    .filter((teacher) => teacherInSections({ sections, teacherId: teacher.id, teacher, teacherUser: userById.get(teacher.userId), assignments, classSectionById }))
    .map((teacher) => teacher.userId)
    .filter((userId) => typeof userId === "string" && userId));
}
