import { createHash } from "node:crypto";
import { FeeAllocationError, UNALLOCATED_RUBRIC_ID, assertFeeAllocationMovement, validateFeeAllocationRubrics } from "./feeAllocationMath.js";
import { feeAllocationConfigId } from "./feeAllocationPhase1.js";
import { toMoneyMinor } from "./money.js";

const hash = (parts) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const fail = (message) => { throw new FeeAllocationError(409, "allocation-reconciliation-required", message); };
const safe = (n) => Number.isSafeInteger(n) && n >= 0;
const identifier = (s) => typeof s === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(s);
const sameShares = (a, b) => Array.isArray(b) && a.length === b.length
  && new Set(b.map(s => s.rubricId)).size === b.length
  && a.every(s => b.some(t => t.rubricId === s.rubricId && t.amountMinor === s.amountMinor));
const noop = () => {};

/** This is NOT a feature flag. No hosted project can execute phase 3 yet. */
export function isFeeAllocationReceiptSandbox(db, env = process.env) {
  return db.projectId === "demo-acadea" && env.ACADEA_E2E_LOCAL_EMULATORS === "YES"
    && env.VITE_FIREBASE_PROJECT_ID === "demo-acadea" && env.FIRESTORE_EMULATOR_HOST === "127.0.0.1:8080"
    && env.FIREBASE_AUTH_EMULATOR_HOST === "127.0.0.1:9099" && !env.VERCEL
    && !env.GOOGLE_APPLICATION_CREDENTIALS && !env.FIREBASE_SERVICE_ACCOUNT_JSON;
}

export const feeAllocationAnchorId = (p) => hash([p.schoolId, p.schoolYearId, p.studentId, p.feeTypeId, p.currency]);
export const feeAllocationStateId = (school, year, currency) => hash([school, year, currency]);
export const feeAllocationBalanceId = (school, year, currency, rubric) => hash([school, year, currency, rubric]);

/** Monotone highest-averages apportionment, using exact BigInt comparisons.
 * Start at lower quotas, then assign at most k-1 units by w/(allocated+1).
 * Unlike largest remainders on successive partial receipts, this cannot take
 * a cent away from a rubric when the cumulative amount increases (Alabama
 * paradox). At the complete tariff, every fixed/percentage share is exact.
 */
export function allocateFeeReceiptCumulative(shares, totalMinor) {
  if (!Array.isArray(shares) || shares.length < 1 || shares.length > 41 || !safe(totalMinor)
    || shares.some(s => !s || !safe(s.amountMinor)) || new Set(shares.map(s => s.rubricId)).size !== shares.length) fail("Poids de répartition invalides.");
  assertFeeAllocationMovement({ sourceType: "payment", sourceId: "validation", sourceRevision: "1", amountMinor: 0,
    lines: shares.map(s => ({ rubricId: s.rubricId, amountMinor: 0 })) });
  const denominator = shares.reduce((n, s) => n + BigInt(s.amountMinor), 0n);
  if (denominator <= 0n || denominator > BigInt(Number.MAX_SAFE_INTEGER) || BigInt(totalMinor) > denominator) fail("Cumul hors tarif ancré.");
  const rows = [...shares].sort((a, b) => a.rubricId < b.rubricId ? -1 : 1).map(s => ({ ...s, allocated: Number(BigInt(totalMinor) * BigInt(s.amountMinor) / denominator) }));
  let left = totalMinor - rows.reduce((n, s) => n + s.allocated, 0);
  while (left-- > 0) {
    let best = rows[0];
    for (const row of rows) if (BigInt(row.amountMinor) * BigInt(best.allocated + 1) > BigInt(best.amountMinor) * BigInt(row.allocated + 1)) best = row;
    best.allocated++;
  }
  return rows.map(s => ({ rubricId: s.rubricId, amountMinor: s.allocated }));
}

const sourceDigest = (p) => hash([p.id, p.schoolId, p.schoolYearId, p.collectionSchoolYearId ?? p.schoolYearId,
  p.studentId, p.feeTypeId, p.currency, p.amount, p.createdAt, p.updatedAt, p.supportDecisionId ?? null]);

function assertBinding(value, p) {
  if (!value || value.schoolId !== p.schoolId || value.originSchoolYearId !== p.schoolYearId
    || value.studentId !== p.studentId || value.feeTypeId !== p.feeTypeId || value.currency !== p.currency) fail("Ancre de répartition hors périmètre.");
}

/** Read/validate only, then return a write-only closure. The existing financial
 * transaction calls that closure after its cash checks, never after commit.
 * No endpoint accepts an allocation, version, amount or activation from clients.
 */
export async function prepareFeeAllocationReceipt({ db, transaction, caller, payment, previous = null, requestId, now }) {
  if (!isFeeAllocationReceiptSandbox(db)) return noop;
  const source = payment ?? previous;
  if (!source || !["USD", "CDF"].includes(source.currency)
    || ![source.id, source.schoolId, source.schoolYearId, source.studentId, source.feeTypeId, requestId].every(identifier)
    || source.schoolId !== caller.schoolId || !["cashier", "school_admin", "admin"].includes(caller.role)) fail("Source financière invalide.");
  const collectionYear = source.collectionSchoolYearId ?? source.schoolYearId;
  const [schoolSnap, stateSnap] = await Promise.all([
    transaction.get(db.doc(`schools/${source.schoolId}`)),
    transaction.get(db.doc(`feeAllocationStates/${feeAllocationStateId(source.schoolId, collectionYear, source.currency)}`)),
  ]);
  const school = schoolSnap.data(), state = stateSnap.data();
  if (!state?.phase3FixtureId) return noop;
  if (!school?.fixtureId || !/^e2e-(recipe|offline)-/.test(school.fixtureId) || state.phase3FixtureId !== school.fixtureId
    || state.status !== "EN_PREPARATION" || state.schoolId !== source.schoolId || state.schoolYearId !== collectionYear
    || state.currency !== source.currency || !Number.isFinite(Date.parse(state.cutoffAt)) || state.cutoffAt > now) fail("Environnement de recette financière non isolé.");
  const [profileSnap, studentSnap, feeSnap, yearSnap] = await Promise.all([
    transaction.get(db.doc(`users/${caller.uid}`)), transaction.get(db.doc(`students/${source.studentId}`)),
    transaction.get(db.doc(`feeTypes/${source.feeTypeId}`)), transaction.get(db.doc(`schoolYears/${source.schoolYearId}`)),
  ]);
  const profile = profileSnap.data(), fee = feeSnap.data(), student = studentSnap.data(), year = yearSnap.data();
  if (!profile || profile.active === false || profile.status === "inactive" || profile.schoolId !== caller.schoolId
    || (profile.role === "admin" ? "school_admin" : profile.role) !== (caller.role === "admin" ? "school_admin" : caller.role)
    || school.status !== "active" || !student || student.schoolId !== source.schoolId || student.schoolYearId !== source.schoolYearId
    || !fee || fee.schoolId !== source.schoolId || fee.schoolYearId !== source.schoolYearId || !year || year.schoolId !== source.schoolId
    || (year.currency ?? school.currency) !== source.currency) fail("Références de recette non autorisées.");
  if (!Number.isFinite(Date.parse(source.createdAt))) fail("Date de l'encaissement non vérifiée.");
  if (previous && payment && ["id", "schoolId", "schoolYearId", "collectionSchoolYearId", "studentId", "feeTypeId", "currency", "createdAt", "supportDecisionId"].some(k => payment[k] !== previous[k])) fail("Réaffectation de référence interdite ; rapprochement nécessaire.");
  const anchorId = feeAllocationAnchorId(source);
  const anchorRef = db.doc(`feeAllocationAnchors/${anchorId}`);
  const totalRef = db.doc(`feeAllocationRequests/obligation_${anchorId}`);
  const sourceRef = db.doc(`feeAllocationRequests/payment_${hash([source.schoolId, source.id])}`);
  const movementId = `receipt_${hash([source.schoolId, source.id, requestId])}`;
  const movementRef = db.doc(`feeAllocationMovements/${movementId}`);
  const [anchorSnap, totalSnap, sourceSnap, movementSnap] = await Promise.all([
    transaction.get(anchorRef), transaction.get(totalRef), transaction.get(sourceRef), transaction.get(movementRef),
  ]);
  if (movementSnap.exists) fail("Mouvement déjà présent sans reçu financier cohérent.");
  const priorSource = sourceSnap.data();
  if (previous && !priorSource) {
    if (previous.createdAt < state.cutoffAt) return noop; // pre-cutoff cash is NEVER reallocated retroactively
    fail("Encaissement sans trace de ventilation : rapprochement nécessaire.");
  }
  if (source.provenance !== "financial-api" || !source.clientRequestIdHash) fail("Seul un encaissement confirmé par le serveur peut être réparti.");
  if (!previous && priorSource) fail("Paiement déjà réparti.");
  if (previous && (priorSource.sourceDigest !== sourceDigest(previous) || priorSource.anchorId !== anchorId
    || priorSource.schoolId !== source.schoolId || priorSource.amountMinor !== toMoneyMinor(previous.amount))) fail("Révision financière incohérente.");
  if (!previous && source.createdAt < state.cutoffAt) fail("Encaissement antérieur à la coupure.");
  let anchor = anchorSnap.data();
  if (!anchor) {
    if (totalSnap.exists || priorSource) fail("Ancre financière manquante.");
    let versionId = null;
    // A legacy debt without an original anchor MUST NOT inherit today's config.
    if (source.schoolYearId === collectionYear) {
      const config = (await transaction.get(db.doc(`feeAllocationConfigs/${feeAllocationConfigId(source.schoolId, source.schoolYearId, source.feeTypeId)}`))).data();
      if (config && (config.schoolId !== source.schoolId || config.schoolYearId !== source.schoolYearId || config.feeTypeId !== source.feeTypeId)) fail("Configuration étrangère.");
      versionId = config?.currentVersionId ?? null;
    }
    anchor = { id: anchorId, schoolId: source.schoolId, originSchoolYearId: source.schoolYearId, studentId: source.studentId,
      feeTypeId: source.feeTypeId, currency: source.currency, configVersionId: versionId, feeAmountMinor: toMoneyMinor(fee.amount),
      className: fee.className ?? null, classOptionKey: fee.classOptionKey ?? null, anchoredAt: now };
  }
  assertBinding(anchor, source);
  let shares = [{ rubricId: UNALLOCATED_RUBRIC_ID, amountMinor: anchor.feeAmountMinor }];
  let versionDigest = null;
  if (anchor.configVersionId) {
    if (!identifier(anchor.configVersionId)) fail("Version historique invalide.");
    const version = (await transaction.get(db.doc(`feeAllocationVersions/${anchor.configVersionId}`))).data();
    if (!version || version.id !== anchor.configVersionId || version.schoolId !== source.schoolId || version.schoolYearId !== source.schoolYearId
      || version.feeTypeId !== source.feeTypeId || version.currency !== source.currency || version.feeAmountMinor !== anchor.feeAmountMinor
      || version.className !== anchor.className || (version.classOptionKey ?? null) !== (anchor.classOptionKey ?? null)
      || !["published", "superseded", "disabled"].includes(version.status) || !version.effectiveFrom || version.effectiveFrom > anchor.anchoredAt) fail("Version historique non vérifiée.");
    const validated = validateFeeAllocationRubrics(version.rubrics, version.feeAmountMinor);
    shares = validated.shares;
    if (!sameShares(shares, version.shares)) fail("Poids historiques altérés.");
    versionDigest = hash([version.id, version.feeAmountMinor, validated.rubrics, shares, version.effectiveFrom]);
  }
  const total = totalSnap.data();
  if (total && (total.anchorId !== anchorId || total.schoolId !== source.schoolId || total.versionDigest !== versionDigest || !safe(total.amountMinor))) fail("Cumul historique incohérent.");
  const oldMinor = previous ? toMoneyMinor(previous.amount) : 0;
  const newMinor = payment ? toMoneyMinor(payment.amount) : 0;
  const delta = newMinor - oldMinor;
  const before = total?.amountMinor ?? 0, after = before + delta;
  if (!safe(after)) fail("Correction supérieure aux encaissements répartis.");
  const priorLines = allocateFeeReceiptCumulative(shares, before), nextLines = allocateFeeReceiptCumulative(shares, after);
  const lines = nextLines.map((s, i) => ({ rubricId: s.rubricId, amountMinor: s.amountMinor - priorLines[i].amountMinor }));
  const balanceRows = await Promise.all(lines.map(async line => {
    const ref = db.doc(`feeAllocationBalances/${feeAllocationBalanceId(source.schoolId, collectionYear, source.currency, line.rubricId)}`);
    const snapshot = await transaction.get(ref), balance = snapshot.data();
    if (balance && (balance.schoolId !== source.schoolId || balance.collectionSchoolYearId !== collectionYear || balance.currency !== source.currency
      || balance.rubricId !== line.rubricId || !safe(balance.receivedMinor) || !safe(balance.spentMinor) || !safe(balance.reservedMinor))) fail("Solde d'affectation incohérent.");
    const receivedMinor = (balance?.receivedMinor ?? 0) + line.amountMinor;
    if (!safe(receivedMinor) || receivedMinor < (balance?.spentMinor ?? 0) + (balance?.reservedMinor ?? 0)) fail("Correction incompatible avec des fonds déjà imputés ou réservés.");
    return { ref, value: { schoolId: source.schoolId, collectionSchoolYearId: collectionYear, currency: source.currency, rubricId: line.rubricId,
      receivedMinor, spentMinor: balance?.spentMinor ?? 0, reservedMinor: balance?.reservedMinor ?? 0, operational: false, updatedAt: now } };
  }));
  const movement = assertFeeAllocationMovement({ id: movementId, schoolId: source.schoolId, originSchoolYearId: source.schoolYearId,
    collectionSchoolYearId: collectionYear, currency: source.currency, sourceType: "payment", sourceId: source.id, sourceRevision: requestId,
    configVersionId: anchor.configVersionId, anchorId, feeTypeId: source.feeTypeId, studentId: source.studentId,
    className: anchor.className ?? null, classOptionKey: anchor.classOptionKey ?? null, amountMinor: delta, lines, postedAt: now,
    collectedAt: source.createdAt, paidAt: source.paidAt, actorId: caller.uid, type: previous ? payment ? "correction" : "reversal" : "receipt",
    reversesMovementId: priorSource?.lastMovementId ?? null, supportDecisionId: source.supportDecisionId ?? null,
    sourceSnapshot: { ...source }, testOnly: true });
  return () => {
    if (!anchorSnap.exists) transaction.create(anchorRef, anchor);
    transaction.create(movementRef, movement);
    transaction.set(totalRef, { schoolId: source.schoolId, anchorId, versionDigest, amountMinor: after, updatedAt: now });
    transaction.set(sourceRef, { schoolId: source.schoolId, anchorId, sourceId: source.id, sourceDigest: payment ? sourceDigest(payment) : null,
      amountMinor: newMinor, lastMovementId: movementId, deleted: !payment, updatedAt: now });
    balanceRows.forEach(row => transaction.set(row.ref, row.value));
  };
}
