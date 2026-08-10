const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export class AvailabilityRequestApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const fail = (status, code, message) => { throw new AvailabilityRequestApiError(status, code, message); };
const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

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
    if (action === "REJECT") { transaction.update(requestRef, { status: "REJECTED", reviewedAt: now, reviewedBy: caller.uid, reviewComment: reviewComment.trim() }); return { ...request, status: "REJECTED", reviewedAt: now, reviewedBy: caller.uid, reviewComment: reviewComment.trim() }; }
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
    transaction.update(requestRef, { status: "APPROVED", reviewedAt: now, reviewedBy: caller.uid, reviewComment: decisionComment, appliedAvailabilityIds: [availabilityId] });
    return { ...request, status: "APPROVED", reviewedAt: now, reviewedBy: caller.uid, reviewComment: decisionComment, appliedAvailabilityIds: [availabilityId] };
  });
}
