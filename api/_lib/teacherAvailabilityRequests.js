const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export class AvailabilityRequestApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const fail = (status, code, message) => { throw new AvailabilityRequestApiError(status, code, message); };
const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;
const activeUser = (value) => value && value.status !== "inactive" && value.active !== false;
const availabilityNotification = ({ id, schoolId, schoolYearId, recipientUserId, title, body, createdAt }) => ({
  id, schoolId, schoolYearId, recipientUserId, type: "availability", title, body, createdAt, read: false,
});

export async function createAvailabilityRequest({ db, caller, request }) {
  if (caller.role !== "teacher" || !caller.schoolId || caller.schoolId !== request.schoolId) fail(403, "permission-denied", "Seul un enseignant de l’établissement peut envoyer une demande.");
  if (!request.id || !request.teacherId || request.userId !== caller.uid || request.createdBy !== caller.uid) fail(400, "invalid-argument", "Demande d’indisponibilité invalide.");
  if (request.status !== "PENDING" || !request.createdAt) fail(400, "invalid-argument", "Statut de demande invalide.");
  if (request.requestType === "FULL_DAY" && ("startTime" in request || "endTime" in request)) fail(400, "invalid-argument", "Plage horaire inattendue.");
  if (request.requestType === "TIME_RANGE" && (!request.startTime || !request.endTime)) fail(400, "invalid-argument", "Plage horaire incomplète.");
  if (!["FULL_DAY", "TIME_RANGE"].includes(request.requestType)) fail(400, "invalid-argument", "Type d’indisponibilité invalide.");
  const today = new Date().toISOString().slice(0, 10);
  const validation = /^\d{4}-\d{2}-\d{2}$/.test(request.requestedDate || "") && request.requestedDate >= today && request.reason?.trim() && request.reason.trim().length <= 1000 ? "" : "La date et le motif sont invalides.";
  if (validation) fail(400, "invalid-argument", validation);
  if (request.requestType === "TIME_RANGE" && request.startTime >= request.endTime) fail(400, "invalid-argument", "L’heure de fin doit être postérieure à l’heure de début.");
  const requestRef = db.collection("teacherAvailabilityRequests").doc(request.id);
  return db.runTransaction(async transaction => {
    const [existing, yearSnapshot, teacherSnapshot, userSnapshot, directorsSnapshot] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(db.collection("schoolYears").doc(request.schoolYearId)),
      transaction.get(db.collection("teachers").doc(request.teacherId)),
      transaction.get(db.collection("users").doc(caller.uid)),
      transaction.get(db.collection("users").where("schoolId", "==", caller.schoolId).where("role", "==", "study_director")),
    ]);
    if (existing.exists) fail(409, "already-exists", "Une demande identique existe déjà.");
    const year = yearSnapshot.data(); const teacher = teacherSnapshot.data(); const user = userSnapshot.data();
    if (!yearSnapshot.exists || year?.schoolId !== caller.schoolId || year?.status !== "active" || year.id !== request.schoolYearId) fail(403, "permission-denied", "Année scolaire invalide.");
    if (!teacherSnapshot.exists || teacher?.schoolId !== caller.schoolId || teacher?.schoolYearId !== request.schoolYearId || teacher?.userId !== caller.uid || teacher?.status === "inactive") fail(403, "permission-denied", "Profil Enseignant invalide.");
    if (!userSnapshot.exists || !activeUser(user) || user?.schoolId !== caller.schoolId || user?.role !== "teacher") fail(403, "permission-denied", "Compte Enseignant inactif ou incohérent.");
    transaction.create(requestRef, request);
    const directors = (directorsSnapshot.docs ?? []).filter(item => {
      const director = item.data();
      return activeUser(director) && director.schoolId === caller.schoolId && (!director.activeSchoolYearId || director.activeSchoolYearId === request.schoolYearId) && (!director.schoolYearId || director.schoolYearId === request.schoolYearId);
    });
    for (const directorSnapshot of directors) {
      const notificationId = `availability_request_${request.id}_${directorSnapshot.id}`;
      transaction.set(db.collection("notifications").doc(notificationId), availabilityNotification({
        id: notificationId, schoolId: caller.schoolId, schoolYearId: request.schoolYearId, recipientUserId: directorSnapshot.id,
        title: "Nouvelle demande d’indisponibilité", body: `${user.name || "Un enseignant"} a envoyé une demande pour le ${request.requestedDate}.`, createdAt: request.createdAt,
      }));
    }
    return request;
  });
}

export async function reviewAvailabilityRequest({ db, caller, requestId, action, reviewComment = "" }) {
  if (caller.role !== "study_director" || !caller.schoolId) fail(403, "permission-denied", "Seule la Direction des études peut traiter cette demande.");
  if (!requestId || !["APPROVE", "REJECT"].includes(action)) fail(400, "invalid-argument", "Action de décision invalide.");
  if (action === "REJECT" && !reviewComment.trim()) fail(400, "invalid-argument", "Le motif du rejet est obligatoire.");
  const requestRef = db.collection("teacherAvailabilityRequests").doc(requestId);
  return db.runTransaction(async transaction => {
    const requestSnapshot = await transaction.get(requestRef);
    if (!requestSnapshot.exists) fail(404, "not-found", "Demande introuvable.");
    const request = requestSnapshot.data();
    if (request.schoolId !== caller.schoolId) fail(403, "permission-denied", "Demande hors établissement.");
    if (request.status !== "PENDING") fail(409, "failed-precondition", "Cette demande a déjà été traitée.");
    const [yearSnapshot, teacherSnapshot, userSnapshot, directorSnapshot] = await Promise.all([
      transaction.get(db.collection("schoolYears").doc(request.schoolYearId)),
      transaction.get(db.collection("teachers").doc(request.teacherId)),
      transaction.get(db.collection("users").doc(request.userId)),
      transaction.get(db.collection("users").doc(caller.uid)),
    ]);
    const year = yearSnapshot.data(); const teacher = teacherSnapshot.data(); const teacherUser = userSnapshot.data(); const director = directorSnapshot.data();
    if (!directorSnapshot.exists || director?.role !== "study_director" || director?.schoolId !== caller.schoolId || director?.status === "inactive" || director?.active === false) fail(403, "permission-denied", "Compte Direction des études inactif ou incohérent.");
    if (!yearSnapshot.exists || year?.schoolId !== caller.schoolId || year?.status !== "active") fail(403, "permission-denied", "Année scolaire inactive ou hors établissement.");
    if (!teacherSnapshot.exists || teacher?.schoolId !== caller.schoolId || teacher?.schoolYearId !== request.schoolYearId || teacher?.userId !== request.userId) fail(409, "failed-precondition", "Profil Enseignant incohérent.");
    if (!userSnapshot.exists || teacherUser?.schoolId !== caller.schoolId || teacherUser?.role !== "teacher" || teacherUser?.status === "inactive" || teacherUser?.active === false || teacher?.status === "inactive") fail(409, "failed-precondition", "Un enseignant archivé ne peut recevoir une nouvelle disponibilité.");
    const now = new Date().toISOString();
    const nextStatus = action === "REJECT" ? "REJECTED" : "APPROVED";
    const nextComment = action === "REJECT" ? reviewComment.trim() : undefined;
    if (action === "REJECT") {
      transaction.update(requestRef, { status: nextStatus, reviewedAt: now, reviewedBy: caller.uid, reviewComment: nextComment });
      const notificationId = `availability_review_${requestId}_${request.userId}_${nextStatus}`;
      transaction.set(db.collection("notifications").doc(notificationId), availabilityNotification({ id: notificationId, schoolId: caller.schoolId, schoolYearId: request.schoolYearId, recipientUserId: request.userId, title: "Demande d’indisponibilité rejetée", body: nextComment ? `Motif : ${nextComment}` : "Votre demande d’indisponibilité a été rejetée.", createdAt: now }));
      return { ...request, status: nextStatus, reviewedAt: now, reviewedBy: caller.uid, reviewComment: nextComment };
    }
    const dayOfWeek = DAYS[new Date(`${request.requestedDate}T12:00:00Z`).getUTCDay()];
    if (dayOfWeek === "sunday") fail(400, "invalid-argument", "Le dimanche ne fait pas partie des jours pédagogiques configurables.");
    const availabilityQuery = db.collection("teacherAvailabilities").where("schoolId", "==", request.schoolId).where("schoolYearId", "==", request.schoolYearId).where("teacherId", "==", request.teacherId).where("dayOfWeek", "==", dayOfWeek).where("active", "==", true);
    const availabilitySnapshot = await transaction.get(availabilityQuery);
    const active = availabilitySnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    const fullDay = request.requestType === "FULL_DAY";
    const satisfied = active.find(item => item.status === "rest" || (item.status === "unavailable" && (!item.startTime || fullDay || (item.startTime <= request.startTime && item.endTime >= request.endTime))));
    if (!satisfied && !fullDay && active.some(item => item.startTime && overlaps(item.startTime, item.endTime, request.startTime, request.endTime))) fail(409, "failed-precondition", "La plage demandée entre en conflit avec une disponibilité officielle existante.");
    const availabilityId = satisfied?.id ?? `${request.schoolId}__${request.schoolYearId}__${request.teacherId}__request__${requestId}`;
    if (!satisfied) transaction.set(db.collection("teacherAvailabilities").doc(availabilityId), { id: availabilityId, schoolId: request.schoolId, schoolYearId: request.schoolYearId, teacherId: request.teacherId, dayOfWeek, status: "unavailable", ...(fullDay ? {} : { startTime: request.startTime, endTime: request.endTime }), active: true, sourceRequestId: requestId, createdBy: caller.uid, createdAt: now, updatedAt: now });
    const decisionComment = satisfied ? (reviewComment.trim() || "Contrainte déjà existante.") : reviewComment.trim();
    transaction.update(requestRef, { status: nextStatus, reviewedAt: now, reviewedBy: caller.uid, reviewComment: decisionComment, appliedAvailabilityIds: [availabilityId] });
    const notificationId = `availability_review_${requestId}_${request.userId}_${nextStatus}`;
    transaction.set(db.collection("notifications").doc(notificationId), availabilityNotification({ id: notificationId, schoolId: caller.schoolId, schoolYearId: request.schoolYearId, recipientUserId: request.userId, title: "Demande d’indisponibilité approuvée", body: decisionComment ? `Réponse : ${decisionComment}` : "Votre demande d’indisponibilité a été approuvée.", createdAt: now }));
    return { ...request, status: "APPROVED", reviewedAt: now, reviewedBy: caller.uid, reviewComment: decisionComment, appliedAvailabilityIds: [availabilityId] };
  });
}
