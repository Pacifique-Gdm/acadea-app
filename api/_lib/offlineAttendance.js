import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";

export class OfflineAttendanceError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const version = (snapshot) => snapshot?.exists && snapshot.updateTime
  ? `${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}` : null;
const text = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const operationIdValid = (value) => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const attendanceId = (schoolId, schoolYearId, studentId, date) => `attendance__${[schoolId, schoolYearId, studentId, date]
  .map((part) => part.replace(/[^a-zA-Z0-9_-]/g, "_")).join("__")}`;
const validDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export async function syncOfflineAttendance({ db, caller, body }) {
  const { operationId, schoolId, schoolYearId, studentId, attendanceDate, status, manualReason, expectedAttendanceVersion } = body;
  if (!operationIdValid(operationId) || ![schoolId, schoolYearId, studentId].every(text)
    || !validDate(attendanceDate)
    || !["present", "absent", "late"].includes(status)
    || typeof manualReason !== "string" || !manualReason.trim() || manualReason.length > 500
    || (expectedAttendanceVersion !== null && (typeof expectedAttendanceVersion !== "string"
      || !/^\d{1,12}:\d{1,9}$/.test(expectedAttendanceVersion)))) {
    throw new OfflineAttendanceError(400, "invalid-argument", "Présence locale invalide.");
  }
  if (caller.role !== "discipline_director" || caller.schoolId !== schoolId) {
    throw new OfflineAttendanceError(403, "permission-denied", "Présence hors du périmètre autorisé.");
  }
  const id = attendanceId(schoolId, schoolYearId, studentId, attendanceDate);
  const receiptId = createHash("sha256").update(`${caller.uid}\0${schoolId}\0${operationId}`).digest("hex");
  const fingerprint = createHash("sha256").update(JSON.stringify({ schoolId, schoolYearId, studentId,
    attendanceDate, status, manualReason: manualReason.trim(), expectedAttendanceVersion })).digest("hex");
  const ref = db.doc(`attendance/${id}`);
  const receiptRef = db.doc(`offlineOperationReceipts/${receiptId}`);
  return db.runTransaction(async (transaction) => {
    const [receipt, user, school, year, student, prior] = await Promise.all([
      transaction.get(receiptRef), transaction.get(db.doc(`users/${caller.uid}`)),
      transaction.get(db.doc(`schools/${schoolId}`)), transaction.get(db.doc(`schoolYears/${schoolYearId}`)),
      transaction.get(db.doc(`students/${studentId}`)), transaction.get(ref),
    ]);
    if (receipt.exists) {
      if (receipt.data()?.actorId !== caller.uid || receipt.data()?.fingerprint !== fingerprint) {
        throw new OfflineAttendanceError(409, "offline-conflict", "Identifiant local déjà utilisé avec une autre présence.");
      }
      return { ok: true, idempotent: true, attendanceId: receipt.data().attendanceId };
    }
    if (user.data()?.role !== "discipline_director" || user.data()?.schoolId !== schoolId
      || user.data()?.status === "inactive" || user.data()?.active === false
      || school.data()?.status !== "active" || school.data()?.activeSchoolYearId !== schoolYearId
      || year.data()?.schoolId !== schoolId || year.data()?.status !== "active") {
      throw new OfflineAttendanceError(403, "permission-denied", "Droits ou année scolaire modifiés depuis la saisie locale.");
    }
    if (!student.exists || student.data()?.schoolId !== schoolId || student.data()?.schoolYearId !== schoolYearId
      || student.data()?.status !== "ACTIVE" || student.data()?.deletedAt) {
      throw new OfflineAttendanceError(409, "offline-conflict", "Élève absent ou transféré depuis la saisie locale.");
    }
    const assignedSections = Array.isArray(user.data()?.sectionIds) && user.data().sectionIds.length
      ? user.data().sectionIds : user.data()?.section ? [user.data().section] : [];
    if (!assignedSections.length || !assignedSections.includes(student.data()?.section)) {
      throw new OfflineAttendanceError(403, "permission-denied", "Section de l'élève hors du périmètre du Directeur de Discipline.");
    }
    if (version(prior) !== expectedAttendanceVersion) {
      throw new OfflineAttendanceError(409, "offline-conflict", "La présence a changé. Vérifiez la version serveur avant de résoudre ce conflit.");
    }
    const parentId = student.data()?.parentId;
    const parent = text(parentId) ? await transaction.get(db.doc(`parents/${parentId}`)) : null;
    const linkedParent = parent?.exists && parent.data()?.schoolId === schoolId
      && Array.isArray(parent.data()?.studentIds) && parent.data().studentIds.includes(studentId) ? parent : null;
    const now = new Date().toISOString();
    transaction.set(ref, { id, schoolId, schoolYearId, studentId, attendanceDate, status,
      recordedAt: now, recordedBy: caller.uid, source: "manual", manualReason: manualReason.trim(),
      updatedAt: FieldValue.serverTimestamp() });
    transaction.create(receiptRef, { actorId: caller.uid, schoolId, schoolYearId, operationId,
      fingerprint, attendanceId: id, createdAt: FieldValue.serverTimestamp() });
    transaction.create(db.doc(`auditLogs/offline-attendance-${operationId}`), { id: `offline-attendance-${operationId}`,
      schoolId, schoolYearId, actorId: caller.uid, actorRole: caller.role, source: "server",
      action: "Présence locale synchronisée", resourceType: "attendance", resourceId: id, createdAt: now });
    if (linkedParent) {
      const notificationId = `notif-${id}`;
      const studentName = [student.data()?.nom, student.data()?.postnom, student.data()?.prenom].filter(Boolean).join(" ");
      transaction.set(db.doc(`notifications/${notificationId}`), { id: notificationId, schoolId, schoolYearId,
        recipientRole: "parent", parentId, studentId, studentName, type: "attendance",
        ...(status === "absent" || status === "late" ? { module: "attendance",
          event: status === "absent" ? "student_absent" : "student_late", attendanceId: id } : {}),
        title: "Présence enregistrée", body: `Votre enfant ${studentName} a été enregistré ${status} le ${attendanceDate}.`,
        createdAt: now, read: false });
    }
    return { ok: true, idempotent: false, attendanceId: id };
  });
}
