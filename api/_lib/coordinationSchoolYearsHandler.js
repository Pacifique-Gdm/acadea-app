import { initAdmin } from "./firebaseAdmin.js";
import { API_RATE_LIMITS, enforceApiRateLimit, sendRateLimitError } from "./rateLimit.js";
import { chunks, coordinationHttpError, requireActiveCoordinationActor, resolveCoordinationSchoolScope } from "./coordination.js";
import { createHash } from "node:crypto";
import { schoolYearOpeningDecision } from "./schoolYearOpening.js";

// Regroupement lot 2 (limite de 12 fonctions Vercel) : ancien fichier api/manage-coordination-school-years.js.
// L’adresse /api/manage-coordination-school-years est gardée : vercel.json la redirige vers
// /api/manage-coordination?route=coordination-school-years, qui appelle ce code sans rien changer aux réponses.
export const COORDINATION_SCHOOL_YEARS_ROUTE = "coordination-school-years";

const CONFIRMATIONS = { close: "CLOTURER LES ANNEES SCOLAIRES", reactivate: "REACTIVER LES ANNEES SCOLAIRES" };

function sendJson(res, status, body) { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); }
function text(value, max = 160) { return String(value ?? "").trim().slice(0, max); }
function parseJsonBody(raw) { try { const parsed = JSON.parse(raw || "{}"); if (parsed && typeof parsed === "object") return parsed; } catch { /* réponse uniforme ci-dessous */ } throw coordinationHttpError(400, "invalid-argument", "Corps JSON invalide."); }
async function readBody(req) { if (req.body === null) throw coordinationHttpError(400, "invalid-argument", "Corps JSON invalide."); if (req.body && typeof req.body === "object") return req.body; if (typeof req.body === "string") return parseJsonBody(req.body); const parts = []; for await (const part of req) parts.push(part); return parseJsonBody(Buffer.concat(parts).toString("utf8")); }

async function loadScope(db, caller, transaction) {
  const read = (target) => transaction ? transaction.get(target) : target.get();
  const relations = transaction ? await read(db.collection("coordinationSchools").where("coordinationId", "==", caller.coordinationId)) : null;
  const schoolIds = relations
    ? [...new Set(relations.docs.filter((item) => item.data().active === true).map((item) => item.data().schoolId))]
    : await resolveCoordinationSchoolScope(db, caller);
  if (schoolIds.length > 200) throw coordinationHttpError(409, "scope-too-large", "Le périmètre dépasse la limite d’une opération atomique (200 écoles). Aucune année n’a été modifiée.");
  const schoolSnapshots = schoolIds.length ? await (transaction ?? db).getAll(...schoolIds.map((id) => db.doc(`schools/${id}`))) : [];
  const schools = schoolSnapshots.filter((item) => item.exists).map((item) => ({ ...item.data(), id: item.id }));
  if (transaction && (schools.length !== schoolIds.length || schools.some((school) => school.activeCoordinationId !== caller.coordinationId || school.status !== "active"))) {
    throw coordinationHttpError(409, "invalid-school-scope", "Le rattachement ou l’état d’une école a changé. Aucune année n’a été modifiée.");
  }
  const activeYears = [];
  for (const batch of chunks(schoolIds, 30)) {
    const snapshot = await read(db.collection("schoolYears").where("schoolId", "in", batch));
    snapshot.docs.filter((item) => item.data().status === "active").forEach((item) => activeYears.push({ ...item.data(), id: item.id }));
  }
  return { schoolIds, schools, activeYears };
}

function scopeRows(scope) {
  return scope.schools.map((school) => {
    const activeYears = scope.activeYears.filter((year) => year.schoolId === school.id);
    const activeYear = activeYears.find((year) => year.id === school.activeSchoolYearId) ?? activeYears[0] ?? null;
    const readinessError = activeYears.length > 1 ? "Plusieurs années actives" : school.activeSchoolYearId && activeYear?.id !== school.activeSchoolYearId ? "Année active incohérente" : !school.activeSchoolYearId && activeYear ? "Référence d’année absente sur l’école" : null;
    return { schoolId: school.id, schoolName: school.name, activeYear, readinessError };
  });
}

async function mutateYears(db, caller, input, action) {
  if (!/^[a-zA-Z0-9-]{8,100}$/.test(input.requestId ?? "")) throw coordinationHttpError(400, "invalid-request-id", "Identifiant de requête requis.");
  const requestHash = createHash("sha256").update(JSON.stringify([action, input.name ?? null, input.startsAt ?? null, input.endsAt ?? null, input.operationId ?? null])).digest("hex");
  const auditRef = db.doc(`auditLogs/coordination-year-${caller.coordinationId}-${input.requestId}`);
  const coordinationRef = db.doc(`coordinations/${caller.coordinationId}`);
  return db.runTransaction(async (transaction) => {
    // Read authority, scope, state and conflicts in the same transaction as every write.
    const [coordinationSnapshot, profileSnapshot, auditSnapshot] = await transaction.getAll(coordinationRef, db.doc(`users/${caller.uid}`), auditRef);
    const coordination = coordinationSnapshot.data(); const profile = profileSnapshot.data();
    if (coordination?.status !== "active" || profile?.role !== "coordination_admin" || profile.coordinationId !== caller.coordinationId || profile.active === false || profile.status === "inactive") throw coordinationHttpError(403, "not-authorized", "Profil Coordination inactif ou invalide.");
    if (auditSnapshot.exists) {
      const previous = auditSnapshot.data();
      if (previous.actorId !== caller.uid || previous.metadata?.requestHash !== requestHash) throw coordinationHttpError(409, "request-conflict", "Cette requête a déjà été utilisée pour une autre opération.");
      return { results: previous.metadata.results, alreadyApplied: true };
    }
    const scope = await loadScope(db, caller, transaction);
    const rows = scopeRows(scope);
    if (!rows.length) throw coordinationHttpError(409, "no-active-schools", "Aucune école activement rattachée.");
    const invalid = rows.find((row) => row.readinessError);
    if (invalid) throw coordinationHttpError(409, "inconsistent-school-year", `${invalid.schoolName} : ${invalid.readinessError}. Aucune année n’a été modifiée.`);
    const now = new Date().toISOString();
    const previous = coordination.yearGovernance;
    let governance = previous;
    let results;
    let newYear;
    if (action === "close") {
      if (previous?.status === "closed") throw coordinationHttpError(409, "already-closed", "Les années scolaires ont déjà été clôturées. Actualisez leur état.");
      const years = rows.filter((row) => row.activeYear).map((row) => ({ schoolId: row.schoolId, schoolYearId: row.activeYear.id }));
      if (!years.length) throw coordinationHttpError(409, "no-active-years", "Aucune année active à clôturer.");
      governance = { operationId: input.requestId, status: "closed", years, closedAt: now, closedBy: caller.uid };
      results = years.map((year) => ({ ...year, status: "closed" }));
    } else if (action === "reactivate") {
      if (!previous || previous.status !== "closed" || previous.operationId !== input.operationId || !Array.isArray(previous.years) || !previous.years.length) throw coordinationHttpError(409, "closure-conflict", "Cette clôture n’est plus réactivable. Vérifiez les années actives et actualisez l’état.");
      if (previous.years.some((year) => !scope.schoolIds.includes(year.schoolId))) throw coordinationHttpError(409, "scope-changed", "Une école de la clôture n’appartient plus au périmètre. Aucune réactivation effectuée.");
      const snapshots = await transaction.getAll(...previous.years.map((year) => db.doc(`schoolYears/${year.schoolYearId}`)));
      for (const [index, snapshot] of snapshots.entries()) {
        const member = previous.years[index]; const row = rows.find((item) => item.schoolId === member.schoolId);
        if (row.activeYear) throw coordinationHttpError(409, "active-year-conflict", `${row.schoolName} possède déjà une année active. Aucune réactivation effectuée.`);
        if (!snapshot.exists || snapshot.data().schoolId !== member.schoolId || snapshot.data().status !== "archived") throw coordinationHttpError(409, "closed-year-conflict", "Une année de la clôture a changé. Aucune réactivation effectuée.");
      }
      governance = { ...previous, status: "reactivated", reactivatedAt: now, reactivatedBy: caller.uid };
      results = previous.years.map((year) => ({ ...year, status: "reactivated" }));
    } else {
      // Lot 15 : seulement le nom ; dates calculées ; refus d'une année en avance, passée ou déjà existante (heure de Kinshasa).
      const requested = text(input.name, 40);
      if (rows.some((row) => row.activeYear)) throw coordinationHttpError(409, "active-year-conflict", "Clôturez les années actives avant d’ouvrir la nouvelle année. Aucune année n’a été créée.");
      const existing = await Promise.all(rows.map((row) => transaction.get(db.collection("schoolYears").where("schoolId", "==", row.schoolId))));
      const decision = schoolYearOpeningDecision(requested, { now: new Date(now) });
      if (!decision.ok) throw coordinationHttpError(409, decision.code, `${decision.message} Aucune année n’a été créée.`);
      for (const [index, row] of rows.entries()) {
        const check = schoolYearOpeningDecision(requested, { now: new Date(now), existingNames: existing[index].docs.map((item) => item.data().name) });
        if (!check.ok) throw coordinationHttpError(409, check.code, `${row.schoolName} : ${check.message} Aucune année n’a été créée.`);
      }
      const { name, startsAt, endsAt } = decision;
      // Identifiant différent si l'ancien existe déjà (par exemple une année mal nommée autrefois).
      const suffix = createHash("sha256").update(String(input.requestId ?? now)).digest("hex").slice(0, 6);
      results = rows.map((row, index) => {
        const ids = new Set(existing[index].docs.map((item) => item.id));
        const base = `${row.schoolId}__${name}`;
        return { schoolId: row.schoolId, schoolYearId: ids.has(base) ? `${base}__${suffix}` : base, status: "opened" };
      });
      const candidates = await transaction.getAll(...results.map((item) => db.doc(`schoolYears/${item.schoolYearId}`)));
      if (candidates.some((snapshot) => snapshot.exists)) throw coordinationHttpError(409, "year-already-exists", "Cette année existe déjà dans une école. Aucune année n’a été créée.");
      newYear = { name, startsAt, endsAt, status: "active", createdAt: now, createdBy: caller.uid };
      if (previous?.status === "closed") governance = { ...previous, status: "superseded", supersededAt: now, supersededBy: caller.uid };
    }
    let storageGrantRevocations = [];
    if (action === "close") {
      const closedPrefixes = results.map((item) => `${item.schoolId}/${item.schoolYearId}/`);
      const teacherUsers = await transaction.get(db.collection("users").where("role", "==", "teacher"));
      storageGrantRevocations = teacherUsers.docs.flatMap((snapshot) => {
        const current = snapshot.data().storageAssignmentKeys;
        if (current === undefined) return [];
        if (!Array.isArray(current) || current.some((key) => typeof key !== "string")) throw coordinationHttpError(409, "invalid-storage-grants", "Droits Storage Enseignant incohérents. Aucune année n'a été clôturée.");
        const next = current.filter((key) => !closedPrefixes.some((prefix) => key.startsWith(prefix)));
        return next.length === current.length ? [] : [{ ref: snapshot.ref, keys: next }];
      });
      if (storageGrantRevocations.length + results.length * 2 + 2 > 500) throw coordinationHttpError(409, "too-many-storage-grants", "Trop de droits Storage à révoquer atomiquement. Aucune année n'a été clôturée.");
    }
    for (const item of storageGrantRevocations) transaction.update(item.ref, { storageAssignmentKeys: item.keys });
    for (const result of results) {
      const yearRef = db.doc(`schoolYears/${result.schoolYearId}`);
      if (newYear) {
        const sourceSchool = scope.schools.find((school) => school.id === result.schoolId);
        transaction.create(yearRef, { ...newYear, id: result.schoolYearId, schoolId: result.schoolId, currency: sourceSchool?.currency === "CDF" ? "CDF" : "USD" });
      }
      else transaction.update(yearRef, { status: action === "close" ? "archived" : "active" });
      transaction.update(db.doc(`schools/${result.schoolId}`), { activeSchoolYearId: action === "close" ? "" : result.schoolYearId, updatedAt: now });
    }
    transaction.update(coordinationRef, { ...(governance ? { yearGovernance: governance } : {}), ...(newYear ? { referenceSchoolYear: newYear.name } : {}), updatedAt: now, updatedBy: caller.uid });
    transaction.create(auditRef, { id: auditRef.id, eventType: `coordination.school-year.${action === "close" ? "closed" : action === "reactivate" ? "reactivated" : "opened"}`, coordinationId: caller.coordinationId, actorId: caller.uid, actorRole: caller.role, actorName: caller.profile.name ?? "Coordinateur", action: action === "close" ? "Clôture multi-écoles" : action === "reactivate" ? "Réactivation multi-écoles" : "Ouverture multi-écoles", source: "server", createdAt: now, metadata: { requestHash, closureOperationId: governance?.operationId ?? null, affectedSchools: results.length, results } });
    return { results, governance: governance ?? null };
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "method-not-allowed", message: "Méthode non autorisée." });
  try {
    const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : "";
    if (!token) throw coordinationHttpError(401, "not-authenticated", "Authentification requise.");
    const { auth, db } = initAdmin(); const caller = await requireActiveCoordinationActor(auth, db, token); const input = await readBody(req); const action = text(input.action);
    await enforceApiRateLimit({ db, actorId: caller.uid, schoolId: caller.coordinationId, action: `coordination.school-year.${action}`, ...API_RATE_LIMITS.SCHOOL_ADMIN });
    if (action === "status") {
      const rows = scopeRows(await loadScope(db, caller));
      const configuredReferenceYear = text(caller.coordination.referenceSchoolYear);
      const governance = caller.coordination.yearGovernance ?? null;
      return sendJson(res, 200, { rows, governance: caller.role === "coordination_admin" ? governance : null, referenceYear: configuredReferenceYear || rows.find((row) => row.activeYear?.name)?.activeYear.name || null });
    }
    if (caller.role !== "coordination_admin") throw coordinationHttpError(403, "not-authorized", "La gouvernance annuelle reste réservée au Coordinateur principal.");
    if (!["close", "reactivate", "open"].includes(action)) throw coordinationHttpError(400, "invalid-action", "Action invalide.");
    if ((CONFIRMATIONS[action] && input.confirmation !== CONFIRMATIONS[action]) || (action === "open" && input.confirmed !== true)) throw coordinationHttpError(400, "confirmation-required", "Confirmation exacte requise.");
    return sendJson(res, 200, await mutateYears(db, caller, input, action));
  } catch (error) {
    if (sendRateLimitError(res, error)) return;
    if (error?.statusCode === 400 && !error?.code) return sendJson(res, 400, { error: "invalid-argument", message: "Corps JSON invalide." });
    const status = Number(error?.statusCode) || 500;
    return sendJson(res, status, { error: status >= 500 ? "server-error" : error.code, message: status >= 500 ? "Gouvernance des années impossible." : error.message });
  }
}
