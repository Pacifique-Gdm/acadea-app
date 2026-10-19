import { GradingApiError } from "./teacherGrading.js";

const roles = new Set(["study_director", "cashier", "parent", "discipline_director", "secretary", "teacher"]);
const docs = (snapshot) => snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
const required = (value) => typeof value === "string" && value.trim() ? value.trim() : "";
const scope = (db, collection, schoolId, schoolYearId) => db.collection(collection).where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).get().then(docs);
const sectionsFor = (user) => Array.isArray(user.sectionIds) && user.sectionIds.length ? user.sectionIds : user.section ? [user.section] : [];

export async function executeSchoolYearArchive({ db, caller, body }) {
  const schoolId = required(body.schoolId);
  if (!schoolId || !roles.has(caller.role) || caller.schoolId !== schoolId) throw new GradingApiError(403, "permission-denied", "Archives non autorisées.");
  const userSnapshot = await db.doc(`users/${caller.uid}`).get();
  const user = userSnapshot.data();
  if (!userSnapshot.exists || user?.schoolId !== schoolId || user?.role !== caller.role || user?.active === false || user?.status === "inactive") {
    throw new GradingApiError(403, "permission-denied", "Compte non autorisé.");
  }
  if (body.action === "archive-years") {
    const years = docs(await db.collection("schoolYears").where("schoolId", "==", schoolId).get())
      .filter((year) => year.status === "archived")
      .map((year) => ({ id: year.id, name: year.name, startsAt: year.startsAt, endsAt: year.endsAt }))
      .sort((left, right) => right.name.localeCompare(left.name, "fr"));
    return { years };
  }
  if (body.action !== "archive-summary") throw new GradingApiError(400, "invalid-argument", "Action inconnue.");
  const schoolYearId = required(body.schoolYearId);
  if (!schoolYearId) throw new GradingApiError(400, "invalid-argument", "Année scolaire invalide.");
  const yearSnapshot = await db.doc(`schoolYears/${schoolYearId}`).get();
  const year = yearSnapshot.data();
  if (!yearSnapshot.exists || year?.schoolId !== schoolId || year?.status !== "archived") throw new GradingApiError(403, "permission-denied", "Année archivée non autorisée.");
  const sections = sectionsFor(user);
  if (caller.role === "study_director") {
    const classes = (await scope(db, "classes", schoolId, schoolYearId))
      .filter((item) => !sections.length || sections.includes(item.section))
      .map((item) => ({ label: item.name, detail: item.option ? `Option : ${item.option}` : "Classe" }));
    return { year: { id: schoolYearId, name: year.name }, title: "Archives pédagogiques", items: classes };
  }
  if (caller.role === "cashier") {
    const [originPayments, collectedPayments, expenses] = await Promise.all([
      scope(db, "payments", schoolId, schoolYearId),
      db.collection("payments").where("schoolId", "==", schoolId).where("collectionSchoolYearId", "==", schoolYearId).get().then(docs),
      scope(db, "expenses", schoolId, schoolYearId),
    ]);
    const payments = [...new Map([...originPayments, ...collectedPayments].map((item) => [item.id, item])).values()];
    return { year: { id: schoolYearId, name: year.name }, title: "Archives financières", items: [
      { label: "Paiements", detail: `${payments.length} opération(s) enregistrée(s)` },
      { label: "Dépenses", detail: `${expenses.length} opération(s) enregistrée(s)` },
      ...payments.slice(0, 100).map((item) => ({ label: `Paiement · ${String(item.paidAt ?? "Date non renseignée").slice(0, 10)}`,
        detail: `${item.amount} ${item.currency === "USD" || item.currency === "CDF" ? item.currency : "devise non renseignée"} · ${item.feeName ?? "Frais"}` })),
      ...expenses.slice(0, 100).map((item) => ({ label: `Dépense · ${String(item.spentAt ?? "Date non renseignée").slice(0, 10)}`,
        detail: `${item.amount} ${item.currency === "USD" || item.currency === "CDF" ? item.currency : "devise non renseignée"} · ${item.category ?? "Catégorie"}` })),
    ], truncated: payments.length > 100 || expenses.length > 100 };
  }
  if (caller.role === "parent") {
    const parentId = required(user.parentId);
    if (!parentId) throw new GradingApiError(403, "permission-denied", "Profil Parent absent.");
    const profileSnapshot = await db.doc(`parents/${parentId}`).get();
    const profile = profileSnapshot.data();
    if (!profileSnapshot.exists || profile?.schoolId !== schoolId || !Array.isArray(profile.studentIds)) throw new GradingApiError(403, "permission-denied", "Profil Parent non autorisé.");
    const students = await Promise.all(profile.studentIds.slice(0, 30).map((studentId) => db.doc(`students/${studentId}`).get()));
    const items = students.filter((student) => student.exists && student.data()?.schoolId === schoolId && student.data()?.schoolYearId === schoolYearId)
      .map((student) => ({ label: [student.data().nom, student.data().postnom, student.data().prenom].filter(Boolean).join(" "), detail: student.data().className ?? "Classe non renseignée" }));
    return { year: { id: schoolYearId, name: year.name }, title: "Archives de mes enfants", items };
  }
  if (caller.role === "teacher") {
    const teachers = (await scope(db, "teachers", schoolId, schoolYearId)).filter((teacher) => teacher.userId === caller.uid);
    if (!teachers.length) return { year: { id: schoolYearId, name: year.name }, title: "Mes affectations archivées", items: [] };
    const teacherIds = new Set(teachers.map((teacher) => teacher.id));
    const [assignments, classes, subjects] = await Promise.all([
      scope(db, "pedagogicalAssignments", schoolId, schoolYearId), scope(db, "classes", schoolId, schoolYearId), scope(db, "subjects", schoolId, schoolYearId),
    ]);
    const classById = new Map(classes.map((item) => [item.id, item.name]));
    const subjectById = new Map(subjects.map((item) => [item.id, item.name]));
    return { year: { id: schoolYearId, name: year.name }, title: "Mes affectations archivées", items: assignments.filter((item) => teacherIds.has(item.teacherId))
      .map((item) => ({ label: subjectById.get(item.subjectId) ?? "Cours", detail: classById.get(item.classId) ?? "Classe" })) };
  }
  if (caller.role === "discipline_director") {
    const students = sections.length ? (await scope(db, "students", schoolId, schoolYearId)).filter((student) => sections.includes(student.section)) : [];
    const studentIds = new Set(students.map((student) => student.id));
    const sanctions = await scope(db, "disciplineSanctions", schoolId, schoolYearId);
    const visibleSanctions = sanctions.filter((item) => studentIds.has(item.studentId));
    return { year: { id: schoolYearId, name: year.name }, title: "Archives disciplinaires", items: [
      { label: "Élèves du périmètre", detail: String(students.length) },
      { label: "Sanctions du périmètre", detail: String(visibleSanctions.length) },
      ...visibleSanctions.slice(0, 100).map((item) => ({ label: `${item.sanctionType ?? "Sanction"} · ${String(item.startDate ?? "").slice(0, 10)}`,
        detail: `${item.studentName ?? "Élève"} · ${item.reason ?? "Motif non renseigné"}` })),
    ], truncated: visibleSanctions.length > 100 };
  }
  const students = await scope(db, "students", schoolId, schoolYearId);
  return { year: { id: schoolYearId, name: year.name }, title: "Archives administratives", items: [
    { label: "Élèves", detail: `${students.length} dossier(s) pour cette année` },
    ...students.slice(0, 100).map((item) => ({ label: [item.nom, item.postnom, item.prenom].filter(Boolean).join(" "), detail: item.className ?? "Classe non renseignée" })),
  ], truncated: students.length > 100 };
}
