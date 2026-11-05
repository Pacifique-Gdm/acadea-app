import { requireActiveApiUser } from "./activeUser.js";
import { PublishedTimetableReadError } from "./publishedTimetableRead.js";
import { studyClassSection, userSectionIds } from "./timetableValidationBundle.js";

const denied = () => { throw new PublishedTimetableReadError(403, "permission-denied", "Consultation des classes non autorisée."); };
const identifier = value => typeof value === "string" && value.length > 0 && value.length <= 200 && !value.includes("/");

/** Read-only projection. Never grants direct Firestore access or returns student/personnel data. */
export async function readDisciplineClasses({ db, caller, schoolYearId }) {
  if (caller?.role !== "discipline_director" || !identifier(caller.uid) || !identifier(caller.schoolId)) denied();
  if (!identifier(schoolYearId)) throw new PublishedTimetableReadError(400, "invalid-argument", "Année scolaire invalide.");
  await requireActiveApiUser(db, caller);
  const [profileSnapshot, yearSnapshot] = await Promise.all([
    db.doc(`users/${caller.uid}`).get(), db.doc(`schoolYears/${schoolYearId}`).get(),
  ]);
  const profile = profileSnapshot.data();
  if (!profile || profile.archivedAt || !yearSnapshot.exists || yearSnapshot.data()?.schoolId !== caller.schoolId) denied();
  const sections = userSectionIds(profile);
  // Invalid assigned sections must never expand to the historical unbounded scope.
  if (!sections.length && (profile.section || profile.sectionIds?.length)) denied();
  const snapshot = await db.collection("classes").where("schoolId", "==", caller.schoolId).where("schoolYearId", "==", schoolYearId).limit(2001).get();
  if (snapshot.docs.length > 2000) throw new PublishedTimetableReadError(409, "failed-precondition", "Liste de classes trop volumineuse.");
  const records = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
  const sectionOf = (record, visited = new Set()) => {
    if (visited.has(record.id)) denied();
    visited.add(record.id);
    const parent = !record.section && records.find(item => item.id === record.parentClassId);
    return parent ? sectionOf(parent, visited) : studyClassSection(record);
  };
  return records.filter(record => record.schoolId === caller.schoolId && record.schoolYearId === schoolYearId && record.active !== false && typeof record.name === "string")
    .filter(record => !sections.length || sections.includes(sectionOf(record)))
    .map(record => {
      const result = { id: record.id, schoolId: caller.schoolId, schoolYearId, name: record.name, section: sectionOf(record), active: true };
      for (const key of ["option", "parentClassId", "classOptionKey", "subClassLabel"]) {
        if (typeof record[key] === "string") result[key] = record[key];
      }
      return result;
    });
}
