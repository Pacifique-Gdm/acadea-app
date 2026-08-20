import { initAdmin } from "./_lib/firebaseAdmin.js";
import { API_RATE_LIMITS, enforceApiRateLimit, sendRateLimitError } from "./_lib/rateLimit.js";
import { activeCoordinationSchoolIds, chunks, coordinationHttpError, requireActiveCoordinator } from "./_lib/coordination.js";

function sendJson(res, status, body) { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); }
function text(value, max = 160) { return String(value ?? "").trim().slice(0, max); }
async function readBody(req) { if (req.body && typeof req.body === "object") return req.body; if (typeof req.body === "string") return JSON.parse(req.body || "{}"); const parts = []; for await (const part of req) parts.push(part); return JSON.parse(Buffer.concat(parts).toString("utf8") || "{}"); }

async function loadScope(db, coordinationId) {
  const schoolIds = await activeCoordinationSchoolIds(db, coordinationId);
  const schools = schoolIds.length ? (await db.getAll(...schoolIds.map((id) => db.doc(`schools/${id}`)))).filter((item) => item.exists).map((item) => ({ id: item.id, ...item.data() })) : [];
  const activeYears = [];
  for (const batch of chunks(schoolIds, 30)) {
    const snapshot = await db.collection("schoolYears").where("schoolId", "in", batch).get();
    snapshot.docs.filter((item) => item.data().status === "active").forEach((item) => activeYears.push({ id: item.id, ...item.data() }));
  }
  return { schoolIds, schools, activeYears };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "method-not-allowed", message: "Méthode non autorisée." });
  try {
    const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : "";
    if (!token) throw coordinationHttpError(401, "not-authenticated", "Authentification requise.");
    const { auth, db } = initAdmin(); const caller = await requireActiveCoordinator(auth, db, token); const input = await readBody(req); const action = text(input.action);
    await enforceApiRateLimit({ db, actorId: caller.uid, schoolId: caller.coordinationId, action: `coordination.school-year.${action}`, ...API_RATE_LIMITS.SCHOOL_ADMIN });
    const scope = await loadScope(db, caller.coordinationId);
    const rows = scope.schools.map((school) => {
      const activeYears = scope.activeYears.filter((year) => year.schoolId === school.id);
      const activeYear = activeYears.find((year) => year.id === school.activeSchoolYearId) ?? activeYears[0] ?? null;
      const readinessError = activeYears.length > 1 ? "Plusieurs années actives" : school.activeSchoolYearId && activeYear?.id !== school.activeSchoolYearId ? "Année active incohérente" : !school.activeSchoolYearId && activeYear ? "Référence d’année absente sur l’école" : null;
      return { schoolId: school.id, schoolName: school.name, activeYear, readinessError };
    });
    if (action === "status") return sendJson(res, 200, { rows, referenceYear: text(caller.coordination.referenceSchoolYear) || null });
    if (!rows.length) throw coordinationHttpError(409, "no-active-schools", "Aucune école activement rattachée.");
    if (input.confirmed !== true) throw coordinationHttpError(400, "confirmation-required", "Confirmation explicite requise.");
    const now = new Date().toISOString(); const batch = db.batch(); const results = [];
    if (action === "close") {
      for (const row of rows) {
        if (row.readinessError || !row.activeYear) { results.push({ schoolId: row.schoolId, status: "blocked", reason: row.readinessError || "Aucune année active" }); continue; }
        batch.update(db.doc(`schoolYears/${row.activeYear.id}`), { status: "archived" });
        batch.update(db.doc(`schools/${row.schoolId}`), { activeSchoolYearId: "", updatedAt: now });
        results.push({ schoolId: row.schoolId, status: "closed", schoolYearId: row.activeYear.id });
      }
    } else if (action === "open") {
      const name = text(input.name, 40); const startsAt = text(input.startsAt, 20); const endsAt = text(input.endsAt, 20);
      if (!/^\d{4}\s*[-–]\s*\d{4}$/.test(name) || !/^\d{4}-\d{2}-\d{2}$/.test(startsAt) || !/^\d{4}-\d{2}-\d{2}$/.test(endsAt) || startsAt >= endsAt) throw coordinationHttpError(400, "invalid-argument", "Année et période scolaire valides requises.");
      const candidateRefs = rows.map((row) => db.doc(`schoolYears/${row.schoolId}__${name.replace(/\s+/g, "").replace("–", "-")}`));
      const candidateSnapshots = candidateRefs.length ? await db.getAll(...candidateRefs) : [];
      const existingYearIds = new Set(candidateSnapshots.filter((item) => item.exists).map((item) => item.id));
      for (const row of rows) {
        if (row.readinessError || row.activeYear) { results.push({ schoolId: row.schoolId, status: "blocked", reason: row.readinessError || `Année active ${row.activeYear.name}` }); continue; }
        const yearId = `${row.schoolId}__${name.replace(/\s+/g, "").replace("–", "-")}`; const yearRef = db.doc(`schoolYears/${yearId}`);
        if (existingYearIds.has(yearId)) { results.push({ schoolId: row.schoolId, status: "blocked", reason: `L’année ${name} existe déjà` }); continue; }
        batch.create(yearRef, { id: yearId, schoolId: row.schoolId, name, startsAt, endsAt, status: "active", createdAt: now, createdBy: caller.uid });
        batch.update(db.doc(`schools/${row.schoolId}`), { activeSchoolYearId: yearId, updatedAt: now });
        results.push({ schoolId: row.schoolId, status: "opened", schoolYearId: yearId });
      }
      if (results.some((item) => item.status === "opened")) batch.update(db.doc(`coordinations/${caller.coordinationId}`), { referenceSchoolYear: name, updatedAt: now, updatedBy: caller.uid });
    } else throw coordinationHttpError(400, "invalid-action", "Action invalide.");
    const auditRef = db.collection("auditLogs").doc();
    batch.set(auditRef, { id: auditRef.id, eventType: action === "close" ? "coordination.school-year.closed" : "coordination.school-year.opened", coordinationId: caller.coordinationId, actorId: caller.uid, actorRole: caller.role, actorName: caller.profile.name ?? "Coordinateur", action: action === "close" ? "Clôture multi-écoles" : "Ouverture multi-écoles", source: "server", createdAt: now, metadata: { affectedSchools: results.filter((item) => item.status !== "blocked").length, blockedSchools: results.filter((item) => item.status === "blocked").length } });
    await batch.commit();
    return sendJson(res, 200, { results });
  } catch (error) {
    if (sendRateLimitError(res, error)) return;
    return sendJson(res, Number(error?.statusCode) || 500, { error: error?.code || "server-error", message: Number(error?.statusCode) >= 500 ? "Gouvernance des années impossible." : error.message });
  }
}
