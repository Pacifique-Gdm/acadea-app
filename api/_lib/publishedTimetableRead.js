const READER_ROLES = new Set(["school_admin", "secretary", "discipline_director", "study_director", "teacher"]);
const DAY_ORDER = new Map(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].map((day, index) => [day, index]));

export class PublishedTimetableReadError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new PublishedTimetableReadError(status, code, message); };
const identifier = (value) => typeof value === "string" && value.length > 0 && value.length <= 200 && !value.includes("/");
const scoped = (data, schoolId, schoolYearId) => data?.schoolId === schoolId && data?.schoolYearId === schoolYearId;
const text = (value) => typeof value === "string" ? value.trim() : "";
const time = (value) => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : "";
const teacherName = (data) => [text(data?.firstName), text(data?.lastName)].filter(Boolean).join(" ") || text(data?.fullName);
const normalized = (value) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");
function className(data) {
  const name = text(data?.name), option = text(data?.option), subclass = text(data?.subClassLabel);
  if (!name) return "";
  const base = option ? name.replace(/\s+Humanit[ée]s?$/i, "").trim() || name : name;
  return [base, option && !normalized(base).includes(normalized(option)) ? option : "", subclass && !normalized(name).endsWith(normalized(subclass)) ? subclass : ""].filter(Boolean).join(" ");
}

async function officialReference(db, collection, id, schoolId, schoolYearId) {
  if (!identifier(id)) return undefined;
  const snapshot = await db.collection(collection).doc(id).get();
  return snapshot.exists && scoped(snapshot.data(), schoolId, schoolYearId) ? snapshot.data() : undefined;
}

export async function readPublishedTimetable({ db, caller, schoolYearId }) {
  if (!READER_ROLES.has(caller?.role) || !identifier(caller?.schoolId) || !identifier(caller?.uid)) fail(403, "permission-denied", "Consultation de l’horaire non autorisée.");
  if (!identifier(schoolYearId)) fail(400, "invalid-argument", "Année scolaire invalide.");
  const schoolId = caller.schoolId;
  const [userSnapshot, yearSnapshot] = await Promise.all([
    db.collection("users").doc(caller.uid).get(),
    db.collection("schoolYears").doc(schoolYearId).get(),
  ]);
  const profile = userSnapshot.data();
  if (!userSnapshot.exists || profile?.role !== caller.role || profile?.schoolId !== schoolId || profile?.status === "inactive" || profile?.active === false || profile?.archivedAt) fail(403, "permission-denied", "Compte hors périmètre ou inactif.");
  if (!yearSnapshot.exists || yearSnapshot.data()?.schoolId !== schoolId) fail(403, "permission-denied", "Année scolaire hors établissement.");

  let teacherId;
  if (caller.role === "teacher") {
    const teachers = await db.collection("teachers").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).where("userId", "==", caller.uid).limit(2).get();
    const teacher = teachers.docs[0]?.data();
    if (teachers.docs.length !== 1 || !scoped(teacher, schoolId, schoolYearId) || teacher.userId !== caller.uid || teacher.status === "inactive") fail(403, "permission-denied", "Profil pédagogique indisponible.");
    teacherId = teachers.docs[0].id;
  }

  const published = await db.collection("timetables").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).where("status", "==", "PUBLISHED").where("activePublished", "==", true).limit(2).get();
  if (!published.docs.length) return null;
  if (published.docs.length !== 1) fail(409, "failed-precondition", "Plusieurs horaires publiés actifs existent.");
  const timetable = published.docs[0];
  if (!scoped(timetable.data(), schoolId, schoolYearId) || timetable.data()?.status !== "PUBLISHED" || timetable.data()?.activePublished !== true) fail(409, "failed-precondition", "Horaire publié incohérent.");
  const entriesSnapshot = await db.collection("timetableEntries").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).where("scheduleId", "==", timetable.id).limit(1001).get();
  if (entriesSnapshot.docs.length > 1000) fail(409, "failed-precondition", "Horaire trop volumineux pour la consultation.");
  const entries = entriesSnapshot.docs.map((snapshot) => snapshot.data()).filter((entry) => entry?.active !== false && (!teacherId || entry.teacherId === teacherId));
  if (entries.some((entry) => !scoped(entry, schoolId, schoolYearId) || entry.scheduleId !== timetable.id)) fail(409, "failed-precondition", "Entrée d’horaire hors périmètre.");

  const references = new Map();
  const reference = (collection, id) => {
    const key = `${collection}:${id}`;
    if (!references.has(key)) references.set(key, officialReference(db, collection, id, schoolId, schoolYearId));
    return references.get(key);
  };
  let operationalClasses;
  const operationalLabels = async (entry, schoolClass) => {
    if (schoolClass?.active === false) return "";
    if (schoolClass?.subClassLabel || schoolClass?.option || schoolClass?.classOptionKey) return className(schoolClass);
    if (!Array.isArray(entry.targetOptionIds) || !entry.targetOptionIds.length) return className(schoolClass);
    operationalClasses ??= db.collection("classes").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).get();
    const scopedClasses = (await operationalClasses).docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));
    const labels = entry.targetOptionIds.map((id) => {
      const optionClass = scopedClasses.find((item) => item.id === id || item.classOptionKey === id);
      return optionClass && scoped(optionClass, schoolId, schoolYearId) && optionClass.active !== false ? className(optionClass) : "";
    });
    return labels.every(Boolean) ? [...new Set(labels)].join(" + ") : "";
  };
  const resolvedTeacherName = async (teacher) => {
    if (!teacher) return "";
    if (identifier(teacher.userId)) {
      const linkedUser = await db.collection("users").doc(teacher.userId).get();
      const user = linkedUser.data();
      if (linkedUser.exists && user?.schoolId === schoolId && user?.role === "teacher" && text(user.name)) return text(user.name);
    }
    return teacherName(teacher);
  };
  const rows = await Promise.all(entries.map(async (entry) => {
    const [period, schoolClass, subject, assignment] = await Promise.all([
      reference("schedulePeriods", entry.periodId), reference("classes", entry.classId),
      reference("subjects", entry.subjectId), reference("pedagogicalAssignments", entry.assignmentId),
    ]);
    const teacher = await reference("teachers", entry.teacherId || assignment?.teacherId);
    const startTime = time(period?.startTime);
    const endTime = time(period?.endTime);
    const periodText = text(period?.label);
    const displayTeacherName = await resolvedTeacherName(teacher);
    const displayClassName = await operationalLabels(entry, schoolClass);
    return {
      dayOfWeek: DAY_ORDER.has(entry.dayOfWeek) ? entry.dayOfWeek : "unknown",
      periodLabel: periodText ? [periodText, startTime && endTime ? `${startTime}–${endTime}` : ""].filter(Boolean).join(" · ") : "Période indisponible",
      startTime: startTime || null,
      classLabel: displayClassName || "Classe opérationnelle indisponible",
      subjectLabel: text(subject?.name) || "Matière indisponible",
      teacherDisplayName: displayTeacherName || (teacher ? "Nom enseignant non renseigné" : "Enseignant indisponible"),
    };
  }));
  rows.sort((a, b) => (DAY_ORDER.get(a.dayOfWeek) ?? 99) - (DAY_ORDER.get(b.dayOfWeek) ?? 99)
    || (a.startTime || "99:99").localeCompare(b.startTime || "99:99")
    || a.classLabel.localeCompare(b.classLabel, "fr")
    || a.subjectLabel.localeCompare(b.subjectLabel, "fr")
    || a.teacherDisplayName.localeCompare(b.teacherDisplayName, "fr"));
  return { version: timetable.data().version, rows };
}
