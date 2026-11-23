import { createHash } from "node:crypto";
import { FeeAllocationError, UNALLOCATED_RUBRIC_ID, allocateFeeReceiptCumulative, arrearsRubricKey, assertFeeAllocationMovement, socialCaseShares, socialSegmentLines, validateFeeAllocationRubrics } from "./feeAllocationMath.js";
import { feeAllocationConfigId } from "./feeAllocationPhase1.js";
import { toMoneyMinor } from "./money.js";
import { allocationSupportedProject, readOperationalAllocation } from "./feeAllocationRuntime.js";
import { supportBalance } from "./socialSupportMath.js";
import { assertSocialVersionBinding } from "./feeAllocationSocialPart.js";
import { prepareSetupPaymentTracking } from "./feeAllocationSetupPayments.js";

const hash = (parts) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const fail = (message) => { throw new FeeAllocationError(409, "allocation-reconciliation-required", message); };
const safe = (n) => Number.isSafeInteger(n) && n >= 0;
const identifier = (s) => typeof s === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(s);
const sameShares = (a, b) => Array.isArray(b) && b.every(s => s && typeof s === "object") && a.length === b.length
  && new Set(b.map(s => s.rubricId)).size === b.length
  && a.every(s => b.some(t => t.rubricId === s.rubricId && t.amountMinor === s.amountMinor));
const noop = () => {};
/** Empreinte d'un cas social d'abord réparti selon la partie 1 : une ancienne version du serveur refuse ce cumul. */
const fromPartOneDigest = (versionDigest, netMinor) => hash([versionDigest, "social-from-part-one", netMinor]);

/** Legacy emulator fixture boundary, not a hosted activation feature flag. */
export function isFeeAllocationReceiptSandbox(db, env = process.env) {
  return db.projectId === "demo-acadea" && env.ACADEA_E2E_LOCAL_EMULATORS === "YES"
    && env.VITE_FIREBASE_PROJECT_ID === "demo-acadea" && env.FIRESTORE_EMULATOR_HOST === "127.0.0.1:8080"
    && env.FIREBASE_AUTH_EMULATOR_HOST === "127.0.0.1:9099" && !env.VERCEL
    && !env.GOOGLE_APPLICATION_CREDENTIALS && !env.FIREBASE_SERVICE_ACCOUNT_JSON;
}

export const feeAllocationAnchorId = (p) => hash([p.schoolId, p.schoolYearId, p.studentId, p.feeTypeId, p.currency]);
export const feeAllocationStateId = (school, year, currency) => hash([school, year, currency]);
export const feeAllocationBalanceId = (school, year, currency, rubric) => hash([school, year, currency, rubric]);

// Lot 27c-4 : le calcul est dans feeAllocationMath.js (partagé avec l'aperçu de l'écran).
export { allocateFeeReceiptCumulative } from "./feeAllocationMath.js";

/** Lot 27a-bis : exportés pour la reprise automatique « à partir de ce qui est enregistré ». */
export const feeAllocationPaymentRequestId = (schoolId, paymentId) => `payment_${hash([schoolId, paymentId])}`;
export const sourceDigest = (p) => hash([p.id, p.schoolId, p.schoolYearId, p.collectionSchoolYearId ?? p.schoolYearId,
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
  if (!isFeeAllocationReceiptSandbox(db) && !allocationSupportedProject(db)) return noop;
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
  const operational = ["ACTIVE", "PAUSED"].includes(state?.status) ? await readOperationalAllocation({ db, transaction,
    schoolId: source.schoolId, schoolYearId: collectionYear, currency: source.currency, now }) : null;
  // Lot 27a : la pause n'existe plus ; un ancien état « PAUSED » est traité comme actif.
  if (!operational && !state?.phase3FixtureId) {
    // Lot « 3 étapes », point 5 : un nouvel encaissement pendant la mise en route est gardé « à répartir à l'activation ».
    if (!payment || previous || state?.status !== "EN_PREPARATION") return noop;
    const pendingRef = db.doc(`feeAllocationPending/payment_${hash([source.schoolId, source.id]).slice(0, 40)}`);
    return (await prepareSetupPaymentTracking({ db, transaction, state, source, now, pendingRef })) ?? noop;
  }
  if (!operational && (!isFeeAllocationReceiptSandbox(db) || !school?.fixtureId || !/^e2e-(recipe|offline)-/.test(school.fixtureId) || state.phase3FixtureId !== school.fixtureId
    || state.status !== "EN_PREPARATION" || state.schoolId !== source.schoolId || state.schoolYearId !== collectionYear
    || state.currency !== source.currency || !Number.isFinite(Date.parse(state.cutoffAt)) || state.cutoffAt > now)) fail("Environnement de recette financière non isolé.");
  if (operational && !previous && source.offlineProposal === true && (!source.proposedAt || !Number.isFinite(Date.parse(source.proposedAt))
    || Date.parse(source.proposedAt) < Date.parse(state.cutoffAt) || Date.parse(source.proposedAt) > Date.parse(now))) fail("Proposition antérieure à la coupure ou sans date prouvée : rapprochez-la sans la supprimer.");
  const [profileSnap, studentSnap, feeSnap, yearSnap] = await Promise.all([
    transaction.get(db.doc(`users/${caller.uid}`)), transaction.get(db.doc(`students/${source.studentId}`)),
    transaction.get(db.doc(`feeTypes/${source.feeTypeId}`)), transaction.get(db.doc(`schoolYears/${source.schoolYearId}`)),
  ]);
  const profile = profileSnap.data(), fee = feeSnap.data(), student = studentSnap.data(), year = yearSnap.data();
  // Lot 27c-1 : tableau 2 si l'élève a une réduction ou une prise en charge sur ce frais (année d'origine de la dette).
  const socialCaseNow = Object.values(student?.financialSupport ?? {}).some((decision) => decision?.schoolYearId === source.schoolYearId
    && (decision.lines?.[source.feeTypeId]?.reductionMinor ?? 0) > 0);
  if (!profile || profile.active === false || profile.status === "inactive" || profile.schoolId !== caller.schoolId
    || (profile.role === "admin" ? "school_admin" : profile.role) !== (caller.role === "admin" ? "school_admin" : caller.role)
    || school.status !== "active" || !student || student.schoolId !== source.schoolId || student.schoolYearId !== source.schoolYearId
    || !fee || fee.schoolId !== source.schoolId || fee.schoolYearId !== source.schoolYearId || !year || year.schoolId !== source.schoolId
    || (year.currency ?? school.currency) !== source.currency) fail("Références de recette non autorisées.");
  if (!Number.isFinite(Date.parse(source.createdAt))) fail("Date de l'encaissement non vérifiée.");
  if (previous && payment && ["id", "schoolId", "schoolYearId", "collectionSchoolYearId", "studentId", "feeTypeId", "currency", "createdAt", "supportDecisionId"].some(k => payment[k] !== previous[k])) fail("Réaffectation de référence interdite ; rapprochement nécessaire.");
  const sourceRef = db.doc(`feeAllocationRequests/payment_${hash([source.schoolId, source.id])}`);
  const sourceSnap = await transaction.get(sourceRef);
  const priorSource = sourceSnap.data();
  let currentVersion = null;
  if (!previous && operational && source.schoolYearId === collectionYear) {
    const config = (await transaction.get(db.doc(`feeAllocationConfigs/${feeAllocationConfigId(source.schoolId, collectionYear, source.feeTypeId)}`))).data();
    if (config && (config.schoolId !== source.schoolId || config.schoolYearId !== collectionYear || config.feeTypeId !== source.feeTypeId)) fail("Configuration étrangère.");
    if (config?.currentVersionId) currentVersion = (await transaction.get(db.doc(`feeAllocationVersions/${config.currentVersionId}`))).data();
  }
  const extension = currentVersion?.publicationMode === "new-fee-after-activation";
  // New receipts after explicit publication get their own versioned cumulative
  // anchor. Previously confirmed receipts keep their initial (even unallocated)
  // anchor for corrections and idempotent replay.
  const anchorId = previous && priorSource ? priorSource.anchorId : extension
    ? hash([feeAllocationAnchorId(source), currentVersion.id]) : feeAllocationAnchorId(source);
  if (!identifier(anchorId)) fail("Ancre financière invalide.");
  const anchorRef = db.doc(`feeAllocationAnchors/${anchorId}`);
  const totalRef = db.doc(`feeAllocationRequests/obligation_${anchorId}`);
  const movementId = `receipt_${hash([source.schoolId, source.id, requestId])}`;
  const movementRef = db.doc(`feeAllocationMovements/${movementId}`);
  const [anchorSnap, totalSnap, movementSnap] = await Promise.all([
    transaction.get(anchorRef), transaction.get(totalRef), transaction.get(movementRef),
  ]);
  if (movementSnap.exists) fail("Mouvement déjà présent sans reçu financier cohérent.");
  if (previous && !priorSource) {
    if (!operational && previous.createdAt < state.cutoffAt) return noop; // active openings cannot silently be invalidated
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
    let versionId = null, socialPart = null;
    // A legacy debt without an original anchor MUST NOT inherit today's config.
    if (source.schoolYearId === collectionYear) {
      const config = (await transaction.get(db.doc(`feeAllocationConfigs/${feeAllocationConfigId(source.schoolId, source.schoolYearId, source.feeTypeId)}`))).data();
      if (config && (config.schoolId !== source.schoolId || config.schoolYearId !== source.schoolYearId || config.feeTypeId !== source.feeTypeId)) fail("Configuration étrangère.");
      versionId = config?.currentVersionId ?? null;
      // Lot 27c-4 : premier paiement réparti d'un cas social après publication d'une partie 2 :
      // l'ancre garde cette partie 2 et le net dû (tarif moins la réduction), pour toujours.
      if (versionId && socialCaseNow && config?.socialVersionId) {
        const social = (await transaction.get(db.doc(`feeAllocationSocialVersions/${config.socialVersionId}`))).data();
        if (social?.status === "published" && social.partOneVersionId === versionId && Date.parse(social.effectiveFrom) <= Date.parse(source.createdAt)) {
          assertSocialVersionBinding(social, { schoolId: source.schoolId, schoolYearId: source.schoolYearId, feeTypeId: source.feeTypeId,
            currency: source.currency, partOneVersionId: versionId, feeAmountMinor: toMoneyMinor(fee.amount) });
          socialPart = { socialVersionId: social.id, socialCurrentVersionId: social.id, socialNetMinor: toMoneyMinor(supportBalance(student, { ...fee, id: source.feeTypeId }).net) };
        }
      }
    }
    anchor = { id: anchorId, schoolId: source.schoolId, originSchoolYearId: source.schoolYearId, studentId: source.studentId,
      feeTypeId: source.feeTypeId, currency: source.currency, configVersionId: versionId, feeAmountMinor: toMoneyMinor(fee.amount),
      className: fee.className ?? null, classOptionKey: fee.classOptionKey ?? null, anchoredAt: now, ...(socialPart ?? {}) };
  }
  assertBinding(anchor, source);
  let shares = [{ rubricId: UNALLOCATED_RUBRIC_ID, amountMinor: anchor.feeAmountMinor }];
  let versionDigest = null, socialSegments = null, socialBaseDigest = null, partOneRubrics = null;
  const segmentsDigest = (stored, segments) => stored.length
    ? hash([socialBaseDigest, "segments", stored.map(item => [item.socialVersionId, item.fromMinor, item.at]), segments.map(segment => segment.shares)]) : socialBaseDigest;
  if (anchor.configVersionId) {
    if (!identifier(anchor.configVersionId)) fail("Version historique invalide.");
    const version = (await transaction.get(db.doc(`feeAllocationVersions/${anchor.configVersionId}`))).data();
    if (!version || version.id !== anchor.configVersionId || version.schoolId !== source.schoolId || version.schoolYearId !== source.schoolYearId
      || version.feeTypeId !== source.feeTypeId || version.currency !== source.currency || version.feeAmountMinor !== anchor.feeAmountMinor
      || version.className !== anchor.className || (version.classOptionKey ?? null) !== (anchor.classOptionKey ?? null)
      || !["published", "superseded", "disabled"].includes(version.status) || !version.effectiveFrom || version.effectiveFrom > anchor.anchoredAt) fail("Version historique non vérifiée.");
    if (!anchorSnap.exists) {
      const runBinding = operational?.receiptVersionsRunId ? (await transaction.get(db.doc(`feeAllocationReconciliationRuns/${operational.receiptVersionsRunId}/versions/${source.feeTypeId}`))).data() : null;
      const approvedBinding = runBinding && runBinding.runId === operational.receiptVersionsRunId && runBinding.schoolId === source.schoolId
        && runBinding.schoolYearId === collectionYear && runBinding.currency === source.currency
        && runBinding.feeTypeId === source.feeTypeId && runBinding.versionId === version.id;
      const approvedAtOpening = operational && source.schoolYearId === collectionYear
        && (approvedBinding || operational.approvedReceiptVersions.some(v => v.feeTypeId === source.feeTypeId && v.versionId === version.id))
        && Date.parse(version.effectiveFrom) <= Date.parse(operational.cutoffAt)
        && Date.parse(source.createdAt) >= Date.parse(operational.cutoffAt);
      const approvedNewFee = operational && version.publicationMode === "new-fee-after-activation"
        && version.openingId === operational.openingId && version.status === "published"
        && source.schoolYearId === collectionYear && version.publishedBy
        && Date.parse(version.effectiveFrom) >= Date.parse(operational.cutoffAt)
        && Date.parse(source.createdAt) >= Date.parse(version.effectiveFrom);
      if (approvedAtOpening || approvedNewFee) {
        // Explicit administrative approval applies only to money subsequently
        // collected in this year. Historical receipts stay solely in the opening;
        // no earlier debt/receipt is rewritten and no previous-year config guessed.
        anchor.approvalOpeningId = operational.openingId;
        anchor.allocationBasis = approvedNewFee ? "explicit-new-fee-publication" : "approved-post-cutoff-receipts";
      } else {
        // Without an approved opening binding, a current pointer is safe only
        // for a proven new obligation. Never guess an old obligation's version.
        const dates = [student.createdAt, fee.createdAt];
        if (dates.some(d => typeof d !== "string" || !Number.isFinite(Date.parse(d))) || version.status !== "published") fail("Origine de l'obligation à rapprocher avant affectation.");
        const obligationAt = dates.reduce((a, b) => Date.parse(a) > Date.parse(b) ? a : b);
        if (Date.parse(version.effectiveFrom) > Date.parse(obligationAt) || Date.parse(obligationAt) > Date.parse(source.createdAt)) fail("La version courante est postérieure à l'obligation.");
        anchor.obligationAt = obligationAt;
      }
    }
    const validated = validateFeeAllocationRubrics(version.rubrics, version.feeAmountMinor);
    shares = validated.shares;
    if (!sameShares(shares, version.shares)) fail("Poids historiques altérés.");
    versionDigest = hash([version.id, version.feeAmountMinor, validated.rubrics, shares, version.effectiveFrom]);
    partOneRubrics = validated.rubrics;
    const readSegments = async (stored) => {
      if (!Array.isArray(stored) || stored.length > 20) fail("Changements de partie 2 invalides.");
      const result = [];
      for (const item of stored) {
        if (!item || !identifier(item.socialVersionId) || !safe(item.fromMinor) || !Number.isFinite(Date.parse(item.at))) fail("Changement de partie 2 invalide.");
        const next = assertSocialVersionBinding((await transaction.get(db.doc(`feeAllocationSocialVersions/${item.socialVersionId}`))).data(),
          { schoolId: source.schoolId, schoolYearId: source.schoolYearId, feeTypeId: source.feeTypeId, currency: source.currency,
            partOneVersionId: version.id, feeAmountMinor: anchor.feeAmountMinor });
        if (next.id !== item.socialVersionId || Date.parse(next.effectiveFrom) > Date.parse(item.at)) fail("Changement de partie 2 non vérifié.");
        result.push({ shares: socialCaseShares(validated.rubrics, next.rubrics, anchor.feeAmountMinor, anchor.socialNetMinor), fromMinor: item.fromMinor });
      }
      return result;
    };
    if (anchor.socialVersionId === undefined && anchor.socialFromPartOne === true) {
      // Correction 27c-4 : cas social d'abord réparti selon la partie 1, puis passé à la partie 2 pour ses paiements suivants.
      if (!safe(anchor.socialNetMinor) || anchor.socialNetMinor > anchor.feeAmountMinor) fail("Partie 2 de l'ancre invalide.");
      const stored = anchor.socialSegments ?? [];
      if (!Array.isArray(stored) || !stored.length) fail("Changements de partie 2 invalides.");
      socialBaseDigest = fromPartOneDigest(versionDigest, anchor.socialNetMinor);
      socialSegments = [{ shares, fromMinor: 0 }, ...await readSegments(stored)];
      versionDigest = segmentsDigest(stored, socialSegments);
    } else if (anchor.socialVersionId !== undefined) {
      if (!identifier(anchor.socialVersionId) || !safe(anchor.socialNetMinor) || anchor.socialNetMinor > anchor.feeAmountMinor) fail("Partie 2 de l'ancre invalide.");
      const social = assertSocialVersionBinding((await transaction.get(db.doc(`feeAllocationSocialVersions/${anchor.socialVersionId}`))).data(),
        { schoolId: source.schoolId, schoolYearId: source.schoolYearId, feeTypeId: source.feeTypeId, currency: source.currency,
          partOneVersionId: version.id, feeAmountMinor: anchor.feeAmountMinor });
      if (social.id !== anchor.socialVersionId || Date.parse(social.effectiveFrom) > Date.parse(anchor.anchoredAt)) fail("Partie 2 de l'ancre non vérifiée.");
      const socialShares = socialCaseShares(validated.rubrics, social.rubrics, anchor.feeAmountMinor, anchor.socialNetMinor);
      // L'empreinte change : une ancienne version du serveur refuserait ce cumul au lieu de le partager autrement.
      socialBaseDigest = hash([versionDigest, "social", social.id, anchor.socialNetMinor, socialShares]);
      // Correction 27c-4 : nouvelles parties 2 publiées depuis, chacune à partir du cumul payé à ce moment-là.
      const stored = anchor.socialSegments ?? [];
      socialSegments = [{ shares: socialShares, fromMinor: 0 }, ...await readSegments(stored)];
      versionDigest = segmentsDigest(stored, socialSegments);
    }
  } else if (anchor.socialVersionId !== undefined) fail("Partie 2 sans version de partie 1.");
  // Lot 27c-3a : un arriéré (dette d'une année passée) va dans les lignes « … (arriéré AAAA-AAAA) », jamais dans les
  // rubriques ni dans le « Non affecté » de l'année d'encaissement. Les parts restent celles de l'année d'origine.
  const arrears = source.schoolYearId !== collectionYear;
  const arrearsNames = new Map();
  if (arrears) {
    const originNames = anchor.configVersionId ? new Map(((await transaction.get(db.doc(`feeAllocationVersions/${anchor.configVersionId}`))).data()?.rubrics ?? []).map(r => [r.id, r.name])) : new Map();
    const rename = share => ({ ...share, rubricId: arrearsRubricKey(source.schoolYearId, share.rubricId) });
    if (socialSegments) socialSegments = socialSegments.map(segment => ({ ...segment, shares: segment.shares.map(rename) }));
    shares = shares.map(share => {
      const key = arrearsRubricKey(source.schoolYearId, share.rubricId);
      arrearsNames.set(key, { originSchoolYearId: source.schoolYearId, originYearName: String(year.name ?? source.schoolYearId), rubricId: share.rubricId,
        rubricName: share.rubricId === UNALLOCATED_RUBRIC_ID ? "Non affecté" : String(originNames.get(share.rubricId) ?? "Rubrique") });
      return { ...share, rubricId: key };
    });
  }
  const total = totalSnap.data();
  if (total && (total.anchorId !== anchorId || total.schoolId !== source.schoolId || total.versionDigest !== versionDigest || !safe(total.amountMinor))) fail("Cumul historique incohérent.");
  const oldMinor = previous ? toMoneyMinor(previous.amount) : 0;
  const newMinor = payment ? toMoneyMinor(payment.amount) : 0;
  const delta = newMinor - oldMinor;
  const before = total?.amountMinor ?? 0, after = before + delta;
  if (!safe(after)) fail("Correction supérieure aux encaissements répartis.");
  // Correction 27c-4 : un nouveau paiement d'un cas social déjà rattaché à une partie 2, alors qu'une NOUVELLE partie 2
  // a été publiée depuis : la suite de son net suit la nouvelle. Les mouvements déjà écrits ne changent pas.
  let rebase = null, nextDigest = versionDigest;
  if (socialSegments && payment && !previous && anchorSnap.exists && !arrears && before < anchor.socialNetMinor) {
    const current = (await transaction.get(db.doc(`feeAllocationConfigs/${feeAllocationConfigId(source.schoolId, collectionYear, source.feeTypeId)}`))).data();
    const stored = anchor.socialSegments ?? [];
    const last = stored.at(-1)?.socialVersionId ?? anchor.socialVersionId;
    if (current?.socialVersionId && current.socialVersionId !== last && current.schoolId === source.schoolId && current.feeTypeId === source.feeTypeId) {
      const next = (await transaction.get(db.doc(`feeAllocationSocialVersions/${current.socialVersionId}`))).data();
      if (next?.status === "published" && next.partOneVersionId === anchor.configVersionId && Date.parse(next.effectiveFrom) <= Date.parse(source.createdAt)) {
        assertSocialVersionBinding(next, { schoolId: source.schoolId, schoolYearId: source.schoolYearId, feeTypeId: source.feeTypeId, currency: source.currency,
          partOneVersionId: anchor.configVersionId, feeAmountMinor: anchor.feeAmountMinor });
        const all = [...stored, { socialVersionId: next.id, fromMinor: before, at: source.createdAt }];
        socialSegments = [...socialSegments, { shares: socialCaseShares(partOneRubrics, next.rubrics, anchor.feeAmountMinor, anchor.socialNetMinor), fromMinor: before }];
        nextDigest = segmentsDigest(all, socialSegments);
        rebase = { socialSegments: all, socialCurrentVersionId: next.id };
      }
    }
  } else if (!socialSegments && anchor.configVersionId && anchor.socialVersionId === undefined && socialCaseNow && payment && !previous
    && anchorSnap.exists && !arrears && source.schoolYearId === collectionYear) {
    // Correction 27c-4 : cas social déjà réparti selon la partie 1, partie 2 publiée depuis. Ses paiements SUIVANTS
    // suivent la partie 2 pour le reste de son net ; les mouvements déjà écrits ne changent jamais.
    const current = (await transaction.get(db.doc(`feeAllocationConfigs/${feeAllocationConfigId(source.schoolId, collectionYear, source.feeTypeId)}`))).data();
    if (current?.socialVersionId && current.schoolId === source.schoolId && current.feeTypeId === source.feeTypeId && current.currentVersionId === anchor.configVersionId) {
      const next = (await transaction.get(db.doc(`feeAllocationSocialVersions/${current.socialVersionId}`))).data();
      const netMinor = toMoneyMinor(supportBalance(student, { ...fee, id: source.feeTypeId }).net);
      if (next?.status === "published" && next.partOneVersionId === anchor.configVersionId && Date.parse(next.effectiveFrom) <= Date.parse(source.createdAt)
        && safe(netMinor) && netMinor <= anchor.feeAmountMinor && before < netMinor) {
        assertSocialVersionBinding(next, { schoolId: source.schoolId, schoolYearId: source.schoolYearId, feeTypeId: source.feeTypeId, currency: source.currency,
          partOneVersionId: anchor.configVersionId, feeAmountMinor: anchor.feeAmountMinor });
        const all = [{ socialVersionId: next.id, fromMinor: before, at: source.createdAt }];
        socialSegments = [{ shares, fromMinor: 0 }, { shares: socialCaseShares(partOneRubrics, next.rubrics, anchor.feeAmountMinor, netMinor), fromMinor: before }];
        socialBaseDigest = fromPartOneDigest(versionDigest, netMinor);
        nextDigest = segmentsDigest(all, socialSegments);
        anchor = { ...anchor, socialNetMinor: netMinor };
        rebase = { socialFromPartOne: true, socialNetMinor: netMinor, socialSegments: all, socialCurrentVersionId: next.id };
      }
    }
  }
  const linesAt = (total) => socialSegments ? socialSegmentLines(shares, socialSegments, anchor.socialNetMinor, total) : allocateFeeReceiptCumulative(shares, total);
  const priorLines = linesAt(before), nextLines = linesAt(after);
  const lines = nextLines.map((s, i) => ({ rubricId: s.rubricId, amountMinor: s.amountMinor - priorLines[i].amountMinor }));
  const balanceRows = await Promise.all(lines.map(async line => {
    const ref = db.doc(`feeAllocationBalances/${feeAllocationBalanceId(source.schoolId, collectionYear, source.currency, line.rubricId)}`);
    const snapshot = await transaction.get(ref), balance = snapshot.data();
    if (balance && (balance.schoolId !== source.schoolId || balance.collectionSchoolYearId !== collectionYear || balance.currency !== source.currency
      || balance.rubricId !== line.rubricId || !safe(balance.receivedMinor) || !safe(balance.spentMinor) || !safe(balance.reservedMinor))) fail("Solde d'affectation incohérent.");
    const receivedMinor = (balance?.receivedMinor ?? 0) + line.amountMinor;
    const openingMinor = balance?.openingMinor ?? 0;
    // Lot « 3 étapes » : un « Non affecté » de départ négatif (dépenses > encaissements, manque en caisse) se comble
    // par les encaissements suivants ; seule une baisse (correction) est refusée si elle passe sous les fonds déjà imputés.
    if (!safe(openingMinor) || !safe(receivedMinor) || !safe(openingMinor + receivedMinor)
      || line.amountMinor < 0 && openingMinor + receivedMinor < (balance?.spentMinor ?? 0) + (balance?.reservedMinor ?? 0)) fail("Correction incompatible avec des fonds déjà imputés ou réservés.");
    return { ref, value: { schoolId: source.schoolId, collectionSchoolYearId: collectionYear, currency: source.currency, rubricId: line.rubricId,
      ...(arrearsNames.has(line.rubricId) ? { arrearsOf: arrearsNames.get(line.rubricId) } : {}),
      receivedMinor, openingMinor, spentMinor: balance?.spentMinor ?? 0, reservedMinor: balance?.reservedMinor ?? 0, operational: !!operational,
      ...(operational ? { availableMinor: openingMinor + receivedMinor - (balance?.spentMinor ?? 0) - (balance?.reservedMinor ?? 0) } : {}), updatedAt: now } };
  }));
  const movement = assertFeeAllocationMovement({ id: movementId, schoolId: source.schoolId, originSchoolYearId: source.schoolYearId,
    collectionSchoolYearId: collectionYear, currency: source.currency, sourceType: "payment", sourceId: source.id, sourceRevision: requestId,
    configVersionId: anchor.configVersionId, anchorId, feeTypeId: source.feeTypeId, studentId: source.studentId,
    className: anchor.className ?? null, classOptionKey: anchor.classOptionKey ?? null, amountMinor: delta, lines, postedAt: now,
    collectedAt: source.createdAt, paidAt: source.paidAt, actorId: caller.uid, type: previous ? payment ? "correction" : "reversal" : "receipt",
    reversesMovementId: priorSource?.lastMovementId ?? null, supportDecisionId: source.supportDecisionId ?? null,
    // Une correction ou une suppression reste dans le tableau de l'encaissement d'origine.
    socialCase: typeof priorSource?.socialCase === "boolean" ? priorSource.socialCase : socialCaseNow,
    sourceSnapshot: { ...source }, testOnly: operational ? operational.testOnly : true });
  return () => {
    if (!anchorSnap.exists) transaction.create(anchorRef, anchor);
    if (rebase) transaction.update(anchorRef, rebase);
    // Correction du prévu : un cas social qui commence (ou change de partie 2) modifie son prévu ; le prévu gardé est recalculé.
    if (socialCaseNow && (!anchorSnap.exists || rebase) && source.schoolYearId === collectionYear) {
      transaction.set(db.doc(`feeAllocationForecastSignals/${hash([source.schoolId, collectionYear])}`),
        { schoolId: source.schoolId, schoolYearId: collectionYear, revision: `social-${movementId}`, changedAt: now });
    }
    transaction.create(movementRef, movement);
    transaction.set(totalRef, { schoolId: source.schoolId, anchorId, versionDigest: nextDigest, amountMinor: after, updatedAt: now });
    transaction.set(sourceRef, { schoolId: source.schoolId, anchorId, sourceId: source.id, sourceDigest: payment ? sourceDigest(payment) : null,
      amountMinor: newMinor, lastMovementId: movementId, deleted: !payment, updatedAt: now,
      socialCase: typeof priorSource?.socialCase === "boolean" ? priorSource.socialCase : socialCaseNow });
    balanceRows.forEach(row => transaction.set(row.ref, row.value));
  };
}
