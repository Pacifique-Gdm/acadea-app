import { requireActiveSectionAdministratorActor } from "./sectionAdministrators.js";
const deny = () => { throw Object.assign(new Error("Notification hors périmètre."), { statusCode: 403, code: "permission-denied" }); };
const valid = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,180}$/.test(value);
export async function markSectionNotificationsRead(db, caller, body) {
  if (!valid(body?.schoolYearId) || body.notificationId !== undefined && !valid(body.notificationId)
    || Object.keys(body).some((key) => !["action", "schoolYearId", "notificationId"].includes(key))) deny();
  return db.runTransaction(async (tx) => {
    const scope = await requireActiveSectionAdministratorActor(db, caller, tx);
    const school = await tx.get(db.doc(`schools/${scope.schoolId}`));
    const year = await tx.get(db.doc(`schoolYears/${body.schoolYearId}`));
    if (!school.exists || school.data()?.status !== "active" || !year.exists || year.data()?.schoolId !== scope.schoolId) deny();
    const records = body.notificationId ? [await tx.get(db.doc(`notifications/${body.notificationId}`))]
      : (await tx.get(db.collection("notifications").where("schoolId", "==", scope.schoolId)
        .where("schoolYearId", "==", body.schoolYearId).where("recipientUserId", "==", caller.uid)
        .where("section", "in", scope.sectionIds).where("read", "==", false).limit(200))).docs;
    const eligible = [];
    for (const snapshot of records) {
      const notification = snapshot.exists ? snapshot.data() : null;
      if (!notification || notification.schoolId !== scope.schoolId || notification.schoolYearId !== body.schoolYearId || notification.recipientUserId !== caller.uid
        || !scope.sectionIds.includes(notification.section)) deny();
      // A read flag acknowledges only this account's notification, never another
      // participant's state or a legacy school-wide conversation counter.
      eligible.push(snapshot.ref ?? db.doc(`notifications/${snapshot.id}`));
    }
    eligible.forEach((ref) => tx.update(ref, { read: true }));
    return { count: eligible.length, hasMore: !body.notificationId && records.length === 200 };
  });
}
