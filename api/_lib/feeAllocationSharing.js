/** Lot « Deux onglets et partage des rubriques » (décision du propriétaire, 17/11, maquette validée le 19/11).
 *
 * - L'Administrateur partage une rubrique de l'année (« Afficher ») avec tout le personnel ou des personnes choisies,
 *   parmi les Directeurs de discipline et des études, Secrétaires et Enseignants qui ont un espace Acadéa.
 * - « Tout le personnel » vaut aussi pour le personnel ajouté plus tard (rôle et espace Acadéa).
 * - Retrait : à une personne ou à tout le personnel, pour tout le drawer ou des rubriques au choix.
 * - Le personnel ne reçoit QUE les rubriques partagées avec lui : lignes du registre réduites à ces rubriques,
 *   sans élève, sans cas social, sans autre rubrique, sans configuration. Lecture seule.
 * Un seul document par école et par année : `feeAllocationShares/{école__année}` (fermé aux applications). */
import { createHash } from "node:crypto";
import { FeeAllocationError } from "./feeAllocationMath.js";
import { readFeeAllocationScope, readFeeAllocationYear } from "./feeAllocationPhase1.js";
import { buildAllocationWorkspace, readAllocationToken } from "./feeAllocationPhase2.js";
import { readRubricCatalog } from "./feeAllocationRubrics.js";

export const sharingActions = new Set(["get-shares", "set-rubric-share", "revoke-share", "get-my-shares", "get-shared-workspace", "get-shared-revision"]);
export const SHARE_ROLES = ["discipline_director", "study_director", "secretary", "teacher"];
const fail = (status, code, message) => { throw new FeeAllocationError(status, code, message); };
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const id = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const active = (p) => p && p.active !== false && !["inactive", "disabled", "suspended", "deleted", "deleting"].includes(p.status);
const isAdmin = (role) => role === "school_admin" || role === "admin";
export const sharesId = (schoolId, yearId) => `${schoolId}__${yearId}`;
const allowed = (body, keys) => { if (Object.keys(body).some((k) => !keys.includes(k))) fail(400, "invalid-argument", "Champs de partage non autorisés."); };

/** Rubriques partagées avec une personne donnée (identifiant et rôle déjà vérifiés). */
export function sharedRubricIds(shares, uid) {
  return Object.entries(shares?.rubrics ?? {}).filter(([, rule]) => rule && (rule.all === true
    ? !(rule.exceptUserIds ?? []).includes(uid) : (rule.userIds ?? []).includes(uid))).map(([rubricId]) => rubricId).sort();
}

/** Garde seulement ce que la personne a le droit de voir : rubriques partagées, sans élève ni cas social. */
export function filterWorkspaceForStaff(workspace, rubricIds) {
  const keep = new Set(rubricIds);
  const ledger = workspace.ledger ? {
    ...workspace.ledger,
    rubrics: workspace.ledger.rubrics.filter((r) => keep.has(r.id)),
    balances: workspace.ledger.balances.filter((b) => keep.has(b.rubricId)),
    movements: workspace.ledger.movements.map((m) => {
      const lines = m.lines.filter((l) => keep.has(l.rubricId));
      return { id: m.id, sourceType: m.sourceType, type: m.type, amountMinor: lines.reduce((n, l) => n + l.amountMinor, 0), lines,
        feeTypeId: m.feeTypeId ?? null, className: m.className ?? null, classOptionKey: m.classOptionKey ?? null,
        originSchoolYearId: m.originSchoolYearId, postedAt: m.postedAt };
    }).filter((m) => m.lines.length > 0),
  } : workspace.ledger;
  return {
    school: workspace.school, year: workspace.year, currency: workspace.currency, canConfigure: false, operational: false, pendingAllocations: 0,
    fees: workspace.fees,
    // Aucune configuration (rubriques, pourcentages, versions) : seulement ce qu'il faut pour filtrer par frais et classe.
    configs: workspace.configs.map((c) => ({ id: c.id, schoolId: c.schoolId, schoolYearId: c.schoolYearId, feeTypeId: c.feeTypeId,
      className: c.className, ...(c.classOptionKey ? { classOptionKey: c.classOptionKey } : {}), currency: c.currency, draftRevision: c.draftRevision ?? 0 })),
    // Le personnel ne voit jamais le nombre de cas sociaux.
    ...(workspace.forecast ? { forecast: { ...workspace.forecast, socialStudentCount: undefined, rows: workspace.forecast.rows.filter((r) => keep.has(r.rubricId))
      .map(({ socialVersionId: _s, ...row }) => ({ ...row, table: 1 })) } } : {}),
    ...(workspace.rubricCatalog ? { rubricCatalog: workspace.rubricCatalog.filter((r) => keep.has(r.id)) } : {}),
    ledger,
    sharedRubricIds: [...keep],
  };
}

async function readStaffProfile(db, caller) {
  if (!caller?.uid || !SHARE_ROLES.includes(caller.role) || !id(caller.schoolId)) fail(403, "permission-denied", "Répartition non partagée avec ce compte.");
  const [profileSnap, schoolSnap] = await Promise.all([db.doc(`users/${caller.uid}`).get(), db.doc(`schools/${caller.schoolId}`).get()]);
  const profile = profileSnap.data(), school = schoolSnap.data();
  if (!active(profile) || profile.role !== caller.role || profile.schoolId !== caller.schoolId || !active(school) || school.status === "suspended") fail(403, "permission-denied", "Compte non autorisé.");
  return { school, schoolId: caller.schoolId };
}

async function eligibleStaff(db, schoolId) {
  const snap = await db.collection("users").where("schoolId", "==", schoolId).where("role", "in", SHARE_ROLES).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter(active)
    .map((u) => ({ id: u.id, name: String(u.name ?? [u.prenom, u.nom].filter(Boolean).join(" ") ?? "").slice(0, 120) || "Personnel", role: u.role }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

export async function manageFeeAllocationSharing({ db, caller, body, now = new Date().toISOString() }) {
  if (!sharingActions.has(body.action)) fail(400, "invalid-argument", "Action de partage inconnue.");
  // ----- Personnel : ses propres rubriques, en lecture seule.
  if (["get-my-shares", "get-shared-workspace", "get-shared-revision"].includes(body.action)) {
    allowed(body, ["action", "schoolId", "ledgerPage", "ledgerFingerprint", "ledgerCursor", "fresh"]);
    const { school, schoolId } = await readStaffProfile(db, caller);
    if (body.schoolId !== undefined && body.schoolId !== schoolId) fail(403, "permission-denied", "École hors périmètre.");
    const { yearId } = await readFeeAllocationYear(db, schoolId, school, undefined, false);
    const sharesSnap = await db.doc(`feeAllocationShares/${sharesId(schoolId, yearId)}`).get();
    const rubricIds = sharedRubricIds(sharesSnap.data(), caller.uid);
    if (body.action === "get-my-shares") return { operational: false, schoolId, rubricIds };
    if (!rubricIds.length) fail(403, "permission-denied", "Aucune rubrique n'est partagée avec ce compte.");
    if (body.action === "get-shared-revision") return readAllocationToken({ db, school, schoolId, extra: ["partage", rubricIds, sharesSnap.data()?.revision ?? null] });
    if (body.fresh !== undefined && body.fresh !== true) fail(400, "invalid-argument", "Option de relecture invalide.");
    const workspace = await buildAllocationWorkspace({ db, caller, school, schoolId, body, retryPending: false });
    return filterWorkspaceForStaff(workspace, rubricIds);
  }
  // ----- Administrateur : liste, partage et retrait.
  const { school, schoolId } = await readFeeAllocationScope(db, caller, body.schoolId ?? caller.schoolId);
  if (!isAdmin(caller.role) || caller.schoolId !== schoolId) fail(403, "permission-denied", "Seul l'Administrateur partage la répartition.");
  const { yearId } = await readFeeAllocationYear(db, schoolId, school, undefined, false);
  const ref = db.doc(`feeAllocationShares/${sharesId(schoolId, yearId)}`);
  if (body.action === "get-shares") {
    allowed(body, ["action", "schoolId"]);
    const [snap, staff] = await Promise.all([ref.get(), eligibleStaff(db, schoolId)]);
    return { operational: false, schoolId, schoolYearId: yearId, revision: snap.data()?.revision ?? null, rubrics: snap.data()?.rubrics ?? {}, staff };
  }
  allowed(body, ["action", "schoolId", "requestId", "expectedRevision", "rubricId", "rubricIds", "all", "userIds", "target"]);
  if (!id(body.requestId) || body.requestId.length < 12 || !(body.expectedRevision === null || typeof body.expectedRevision === "string")) fail(400, "invalid-argument", "Demande de partage invalide.");
  const fingerprint = hash(body);
  const receiptRef = db.doc(`feeAllocationRequests/share_${hash([caller.uid, schoolId, body.requestId])}`);
  return db.runTransaction(async (tx) => {
    const [receipt, snap, profile] = await Promise.all([tx.get(receiptRef), tx.get(ref), tx.get(db.doc(`users/${caller.uid}`))]);
    if (!active(profile.data()) || !isAdmin(profile.data()?.role) || profile.data()?.schoolId !== schoolId) fail(403, "permission-denied", "Compte non autorisé.");
    if (receipt.exists) {
      if (receipt.data().fingerprint !== fingerprint) fail(409, "conflict", "Cette demande a déjà un autre contenu.");
      return { ...receipt.data().result, idempotent: true };
    }
    const current = snap.data() ?? { schoolId, schoolYearId: yearId, rubrics: {} };
    if ((current.revision ?? null) !== body.expectedRevision) fail(409, "conflict", "Le partage a changé. Actualisez avant de recommencer.");
    const staffSnap = await tx.get(db.collection("users").where("schoolId", "==", schoolId).where("role", "in", SHARE_ROLES));
    const staffIds = new Set(staffSnap.docs.filter((d) => active(d.data())).map((d) => d.id));
    const catalog = await readRubricCatalog(db, schoolId, yearId, tx);
    const rubricExists = (rid) => catalog.rubrics.some((r) => r.id === rid);
    const rubrics = structuredClone(current.rubrics ?? {});
    if (body.action === "set-rubric-share") {
      if (!id(body.rubricId) || !rubricExists(body.rubricId) || typeof body.all !== "boolean") fail(400, "invalid-argument", "Rubrique ou choix invalide.");
      const userIds = [...new Set(Array.isArray(body.userIds) ? body.userIds : [])];
      if (userIds.length > 500 || userIds.some((u) => !id(u) || !staffIds.has(u))) fail(400, "invalid-argument", "Choisissez seulement du personnel qui a un espace Acadéa.");
      if (body.all) rubrics[body.rubricId] = { all: true, userIds: [], exceptUserIds: [] };
      else if (userIds.length) rubrics[body.rubricId] = { all: false, userIds: userIds.sort(), exceptUserIds: [] };
      else delete rubrics[body.rubricId];
    } else {
      // Retrait : `target` = "all" (tout le personnel) ou un identifiant ; `rubricIds` = null pour tout le drawer.
      const target = body.target;
      if (!(target === "all" || (id(target) && staffIds.has(target)))) fail(400, "invalid-argument", "Personne invalide.");
      const list = body.rubricIds === null ? Object.keys(rubrics) : Array.isArray(body.rubricIds) ? body.rubricIds : fail(400, "invalid-argument", "Rubriques invalides.");
      for (const rid of list) {
        const rule = rubrics[rid];
        if (!rule) continue;
        if (target === "all") { delete rubrics[rid]; continue; }
        if (rule.all) rule.exceptUserIds = [...new Set([...(rule.exceptUserIds ?? []), target])].sort();
        else { rule.userIds = (rule.userIds ?? []).filter((u) => u !== target); if (!rule.userIds.length) delete rubrics[rid]; }
      }
    }
    const revision = hash([fingerprint, now]);
    const next = { schoolId, schoolYearId: yearId, rubrics, revision, updatedAt: now, updatedBy: caller.uid };
    tx.set(ref, next);
    const result = { operational: false, schoolId, schoolYearId: yearId, revision, rubrics };
    tx.create(receiptRef, { schoolId, schoolYearId: yearId, userId: caller.uid, fingerprint, result, createdAt: now });
    return { ...result, idempotent: false };
  });
}
