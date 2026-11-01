import { requireActiveSectionAdministratorActor } from "./sectionAdministrators.js";

const kinds = new Set(["students", "classes", "feeTypes"]);
const validId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,180}$/.test(value);
const validCursor = (value) => typeof value === "string" && /^[A-Za-z0-9_:-]{1,500}$/.test(value);
const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode, code: statusCode === 403 ? "permission-denied" : "invalid-argument" }); };

const pick = (data, fields, id) => Object.fromEntries([["id", id], ...fields.filter((key) => data[key] !== undefined).map((key) => [key, data[key]])]);
export async function loadSectionSchoolBootstrap({ db, caller, body }) {
  if (!body || Object.keys(body).some((key) => key !== "action")) fail(400, "Requête initiale invalide.");
  return db.runTransaction(async (transaction) => {
    const scope = await requireActiveSectionAdministratorActor(db, caller, transaction);
    const profile = await transaction.get(db.doc(`users/${caller.uid}`));
    const school = await transaction.get(db.doc(`schools/${scope.schoolId}`));
    if (!school.exists || school.data()?.status !== "active") fail(403, "Établissement indisponible.");
    const years = await transaction.get(db.collection("schoolYears").where("schoolId", "==", scope.schoolId));
    if (years.docs.some((year) => year.data()?.schoolId !== scope.schoolId)) fail(403, "Année hors périmètre.");
    return {
      users: [pick(profile.data(), ["name", "email", "role", "schoolId", "sectionIds", "status", "active"], caller.uid)],
      schools: [pick(school.data(), ["name", "motto", "address", "phone", "email", "currency", "logoUrl", "acronym", "timeZone", "educationLevels", "schoolOptions", "schoolOptionDisplayNames", "schoolType", "activeSchoolYearId", "status", "subscriptionPlan", "subscriptionStatus", "subscriptionAmount"], scope.schoolId)],
      schoolYears: years.docs.map((year) => pick(year.data(), ["schoolId", "name", "startsAt", "endsAt", "status", "currency", "customFeeKindChoices"], year.id)),
    };
  });
}

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
    const sectionBound = body.kind !== "feeTypes";
    const authorized = (record) => record?.schoolId === scope.schoolId
      && record.schoolYearId === body.schoolYearId && (!sectionBound || scope.sectionIds.includes(record.section));
    let query = db.collection(body.kind).where("schoolId", "==", scope.schoolId)
      .where("schoolYearId", "==", body.schoolYearId);
    if (sectionBound) query = query.where("section", "in", scope.sectionIds);
    query = query.orderBy("__name__");
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
