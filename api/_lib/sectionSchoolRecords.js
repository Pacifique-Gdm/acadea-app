import { requireActiveSectionAdministratorActor } from "./sectionAdministrators.js";

const kinds = new Set(["students", "classes"]);
const validId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,180}$/.test(value);
const validCursor = (value) => typeof value === "string" && /^[A-Za-z0-9_:-]{1,500}$/.test(value);
const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode, code: statusCode === 403 ? "permission-denied" : "invalid-argument" }); };

/** Cursor, profile and page share a transaction. No global query or parent directory.
 * The HTTP release gate remains enforced by the provisioning endpoint. */
export async function listSectionSchoolRecords({ db, caller, body }) {
  if (!body || Object.keys(body).some((key) => !["action", "kind", "schoolYearId", "cursorId"].includes(key))
      || !kinds.has(body.kind) || !validId(body.schoolYearId)
      || body.cursorId !== undefined && !validCursor(body.cursorId)) fail(400, "Filtres scolaires invalides.");
  return db.runTransaction(async (transaction) => {
    const scope = await requireActiveSectionAdministratorActor(db, caller, transaction);
    const school = await transaction.get(db.doc(`schools/${scope.schoolId}`));
    const year = await transaction.get(db.doc(`schoolYears/${body.schoolYearId}`));
    if (!school.exists || ["inactive", "suspended", "deleting"].includes(school.data()?.status)
        || !year.exists || year.data()?.schoolId !== scope.schoolId) fail(403, "Établissement ou année indisponible.");
    const authorized = (record) => record?.schoolId === scope.schoolId
      && record.schoolYearId === body.schoolYearId && scope.sectionIds.includes(record.section);
    let query = db.collection(body.kind).where("schoolId", "==", scope.schoolId)
      .where("schoolYearId", "==", body.schoolYearId).where("section", "in", scope.sectionIds)
      .orderBy("__name__");
    if (body.cursorId) {
      const cursor = await transaction.get(db.doc(`${body.kind}/${body.cursorId}`));
      if (!cursor.exists || !authorized(cursor.data())) fail(403, "Curseur hors périmètre.");
      query = query.startAfter(cursor);
    }
    const page = await transaction.get(query.limit(101));
    if (page.docs.some((record) => !authorized(record.data()))) fail(403, "Donnée hors périmètre.");
    const visible = page.docs.slice(0, 100);
    return {
      schoolId: scope.schoolId, schoolYearId: body.schoolYearId,
      items: visible.map((record) => ({ ...record.data(), id: record.id })),
      nextCursorId: page.docs.length > 100 ? visible.at(-1).id : null,
    };
  });
}
