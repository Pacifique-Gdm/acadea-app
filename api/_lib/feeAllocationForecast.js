import { supportBalance } from './socialSupportMath.js';
import { feeAppliesToHistoricalStudent } from './financialTransactions.js';
import { allocateFeeReceiptCumulative } from './feeAllocationReceipts.js';
import { socialCaseShares, socialSegmentLines, validateFeeAllocationRubrics } from './feeAllocationMath.js';
import { readAllocationPages } from './feeAllocationPagination.js';
import { allocationHash, allocationStateId, allocationFail as fail } from './feeAllocationRuntime.js';
import { toMoneyMinor } from './money.js';
import { readArrearsForecast } from './feeAllocationArrearsForecast.js';

export const forecastSignalId = (schoolId, yearId) => allocationHash([schoolId, yearId]);
export function calculateAllocationForecast({ students, fees, configs, versions, socialVersions = [], anchors = [], schoolId, yearId, currency, operational }) {
  const rows = [], seen = new Set();
  const activeStudents = students.filter(s => s.schoolId === schoolId && s.schoolYearId === yearId && s.status === 'ACTIVE' && !s.deletedAt);
  for (const fee of fees) {
    if (fee.schoolId !== schoolId || fee.schoolYearId !== yearId || seen.has(fee.id)) fail('Frais hors périmètre ou dupliqué dans le prévu.');
    seen.add(fee.id);
    const tariff = toMoneyMinor(fee.amount);
    if (tariff <= 0 || fee.currency && fee.currency !== currency) fail('Tarif ou devise à vérifier avant de calculer le prévu.');
    const config = configs.find(c => c.feeTypeId === fee.id);
    if (config && (config.schoolId !== schoolId || config.schoolYearId !== yearId || config.currency !== currency)) fail('Configuration hors périmètre.');
    const version = config?.currentVersionId ? versions.find(v => v.id === config.currentVersionId) : null;
    const model = operational ? version : config?.draft ? { ...config, ...config.draft } : version;
    if (config?.currentVersionId && !version) fail('Version publiée manquante : prévu indisponible.');
    if (model && (model.feeAmountMinor !== tariff || (model.className ?? config.className) !== fee.className
      || ((model.classOptionKey ?? config.classOptionKey) ?? null) !== (fee.classOptionKey ?? null)
      || version === model && (version.status !== 'published' || version.feeTypeId !== fee.id || version.schoolId !== schoolId || version.schoolYearId !== yearId || version.currency !== currency))) fail('Tarif, classe ou version modifié : prévu à revérifier.');
    const checked = model ? validateFeeAllocationRubrics(model.rubrics, tariff) : { rubrics: [], shares: [{ rubricId: 'UNALLOCATED', amountMinor: tariff }] };
    // Lot 27c-4 : partie 2 publiée (cas sociaux) — tableau 2 selon ses propres règles, sur le net de chaque élève.
    const social = model && version === model && config?.socialVersionId ? socialVersions.find(v => v.id === config.socialVersionId && v.partOneVersionId === version.id && v.status === 'published') ?? null : null;
    const socialRubrics = social ? validateFeeAllocationRubrics(social.rubrics, tariff, { allowZero: true }).rubrics : null;
    // Lot 27c-1 : prévu séparé — tableau 1 (élèves normaux) et tableau 2 (réduction ou prise en charge sur ce frais).
    const totals = new Map([1, 2].flatMap(table => checked.shares.map(s => [`${table}|${s.rubricId}`, 0])));
    const counts = { 1: 0, 2: 0 };
    let studentsCount = 0;
    for (const student of activeStudents) {
      if (!feeAppliesToHistoricalStudent(fee, student)) continue;
      studentsCount++;
      // Exact same net obligation and cumulative apportionment as receipts,
      // including fixed shares scaled down when the student's net is smaller.
      const balance = supportBalance(student, fee);
      const net = toMoneyMinor(balance.net), table = balance.reduction > 0 ? 2 : 1;
      counts[table]++;
      const lines = table === 2 && model ? socialForecastLines({ student, fee, net, tariff, checked, version, social, anchors, socialVersions })
        : net > 0 ? allocateFeeReceiptCumulative(checked.shares, net) : [];
      for (const share of lines) {
        const total = totals.get(`${table}|${share.rubricId}`) + share.amountMinor;
        if (!Number.isSafeInteger(total)) fail('Prévu annuel hors limites.');
        totals.set(`${table}|${share.rubricId}`, total);
      }
    }
    for (const [key, amountMinor] of totals) {
      const [table, rubricId] = [Number(key.split('|')[0]), key.split('|')[1]];
      // Le tableau 2 n'a une ligne que s'il a des élèves pour ce frais.
      if (table === 2 && !counts[2]) continue;
      rows.push({ feeTypeId: fee.id, className: fee.className ?? '', classOptionKey: fee.classOptionKey ?? null, table,
        rubricId, rubricName: checked.rubrics.find(r => r.id === rubricId)?.name ?? 'Non affecté', amountMinor, studentsCount: counts[table],
        ...(model ? (() => { const rubrics = table === 2 && socialRubrics ? socialRubrics : checked.rubrics, rubric = rubrics.find(r => r.id === rubricId);
          return { rubricShare: rubric?.mode === 'fixed' ? rubric.fixedMinor : checked.shares.find(s => s.rubricId === rubricId)?.amountMinor ?? 0, tariffMinor: tariff,
            rubricMode: rubric?.mode ?? null, basisPoints: rubric?.basisPoints ?? null, ...(table === 2 && social ? { socialVersionId: social.id } : {}) }; })()
          : { rubricShare: tariff, tariffMinor: tariff, rubricMode: null, basisPoints: null }) });
    }
  }
  return { status: 'complete', rows, studentCount: activeStudents.length };
}

/** Correction du prévu (après 27c-4) : le prévu d'un cas social suit la partie qu'il utilise VRAIMENT.
 * - Déjà réparti selon la partie 1 (ancre sans partie 2) : partie 1.
 * - Déjà réparti selon une partie 2 : cette partie 2, puis les suivantes à partir du cumul où elles ont pris le relais.
 * - Pas encore de paiement réparti : la partie 2 publiée, sinon la partie 1.
 * Si une donnée manque, on revient à la règle « pas encore de paiement » (jamais d'erreur d'affichage). */
export function socialForecastLines({ student, fee, net, tariff, checked, version, social, anchors, socialVersions }) {
  if (!(net > 0)) return [];
  const anchor = version ? anchors.find((a) => a.studentId === student.id && a.feeTypeId === fee.id && a.configVersionId === version.id) : null;
  // Correction 27c-4 : un cas social d'abord réparti selon la partie 1 passe à la partie 2 pour ses paiements suivants.
  const fromPartOne = anchor?.socialFromPartOne === true;
  if (anchor && anchor.socialVersionId === undefined && !fromPartOne) return allocateFeeReceiptCumulative(checked.shares, net);
  if (anchor) {
    const ids = [...(fromPartOne ? [] : [anchor.socialVersionId]), ...(anchor.socialSegments ?? []).map((item) => item.socialVersionId)];
    const found = ids.map((id) => socialVersions.find((v) => v.id === id && v.partOneVersionId === version.id));
    if (ids.length && found.every(Boolean) && Number.isSafeInteger(anchor.socialNetMinor)) {
      try {
        const segments = [...(fromPartOne ? [{ shares: checked.shares, fromMinor: 0 }] : []),
          ...found.map((v, index) => ({ shares: socialCaseShares(checked.rubrics, v.rubrics, tariff, anchor.socialNetMinor),
            fromMinor: fromPartOne ? anchor.socialSegments[index].fromMinor : index === 0 ? 0 : anchor.socialSegments[index - 1].fromMinor }))];
        return socialSegmentLines(checked.shares, segments, anchor.socialNetMinor, net);
      } catch { /* même règle qu'un élève sans paiement réparti */ }
    }
  }
  return allocateFeeReceiptCumulative(social ? socialCaseShares(checked.rubrics, social.rubrics, tariff, net) : checked.shares, net);
}

/** Lot « répartition rapide » : le prévu calculé est gardé côté serveur (agrégats seulement,
 * jamais d'identité d'élève). Il n'est recalculé — lecture de tous les élèves — que si sa clé change :
 * signal des élèves et des frais (fonctions), frais, configurations, statut de la répartition,
 * version du calcul. Garde-fou : une heure au plus, même sans signal. */
// 2 : lot 27c-3b, le prévu gardé contient aussi les lignes d'arriérés.
// 3 : lot 27c-4, le tableau 2 suit la partie 2 publiée (cas sociaux).
// 4 : correction du prévu, chaque cas social suit la partie qu'il utilise vraiment.
export const FORECAST_CACHE_SCHEMA = 4;
export const FORECAST_CACHE_MAX_AGE_MS = 60 * 60 * 1000;
export const forecastCacheId = (schoolId, yearId, currency) => allocationHash(['forecast-cache', schoolId, yearId, currency]);
const forecastCacheKey = ({ signal, fees, configs, state }) => allocationHash([FORECAST_CACHE_SCHEMA, signal,
  fees.map(f => [f.id, f.schoolId, f.schoolYearId, f.className ?? null, f.classOptionKey ?? null, f.amount ?? null, f.currency ?? null, f.name ?? null]).sort((a, b) => a[0].localeCompare(b[0])),
  configs.map(c => [c.id, c.currentVersionId ?? null, c.socialVersionId ?? null, c.draftRevision ?? null, c.currency ?? null, c.draft?.updatedAt ?? null]).sort((a, b) => a[0].localeCompare(b[0])),
  state ?? null]);

/** Only aggregates leave the API. Every page belongs to the same Firestore
 * snapshot; no partial school total, student identity or social reason leaks. */
export async function readAllocationForecast({ db, schoolId, yearId, currency, fresh = false, now = Date.now() }) {
  const cacheRef = db.doc(`feeAllocationForecastCaches/${forecastCacheId(schoolId, yearId, currency)}`);
  const result = await db.runTransaction(async tx => {
    const annual = collection => db.collection(collection).where('schoolId', '==', schoolId).where('schoolYearId', '==', yearId);
    const [fees, configs, state, signal, school, year, cache] = await Promise.all([
      readAllocationPages(annual('feeTypes'), tx), readAllocationPages(annual('feeAllocationConfigs'), tx),
      tx.get(db.doc(`feeAllocationStates/${allocationStateId(schoolId, yearId, currency)}`)),
      tx.get(db.doc(`feeAllocationForecastSignals/${forecastSignalId(schoolId, yearId)}`)),
      tx.get(db.doc(`schools/${schoolId}`)), tx.get(db.doc(`schoolYears/${yearId}`)), tx.get(cacheRef),
    ]);
    if (school.data()?.activeSchoolYearId !== yearId || year.data()?.schoolId !== schoolId
      || (year.data()?.currency ?? school.data()?.currency) !== currency) fail('Année ou devise modifiée pendant la consultation. Actualisez le prévu.');
    const data = result => result.docs.map(d => ({ ...d.data(), id: d.id }));
    const configRows = data(configs), feeRows = data(fees), revision = signal.data()?.revision ?? null;
    const status = state.data()?.status ?? null;
    const kept = cache.data();
    if (!fresh && revision && kept?.key === forecastCacheKey({ signal: revision, fees: feeRows, configs: configRows, state: status }) && kept.schoolId === schoolId && kept.schoolYearId === yearId && kept.currency === currency
      && Number.isFinite(Date.parse(kept.savedAt)) && now - Date.parse(kept.savedAt) < FORECAST_CACHE_MAX_AGE_MS
      && kept.forecast?.status === 'complete' && Array.isArray(kept.forecast.rows)) {
      return { fees, configs, forecast: { ...kept.forecast, revision, calculatedAt: kept.savedAt, cached: true } };
    }
    const students = await readAllocationPages(annual('students').select('schoolId', 'schoolYearId', 'className', 'option', 'status', 'deletedAt', 'financialSupport',
      'matricule', 'importedFromStudentId', 'nom', 'postnom', 'prenom', 'birthDate'), tx);
    const versions = [];
    for (const config of configRows) if (config.currentVersionId) versions.push({ ...(await tx.get(db.doc(`feeAllocationVersions/${config.currentVersionId}`))).data(), id: config.currentVersionId });
    const socialVersions = [];
    for (const config of configRows) if (config.socialVersionId) socialVersions.push({ ...(await tx.get(db.doc(`feeAllocationSocialVersions/${config.socialVersionId}`))).data(), id: config.socialVersionId });
    // Correction du prévu : ancres des cas sociaux de l'année (quelques élèves), et toutes les parties 2 qu'elles citent.
    const anchors = [];
    if (configRows.some((c) => c.currentVersionId)) {
      const socialIds = data(students).filter((st) => Object.values(st.financialSupport ?? {}).some((d) => d?.schoolYearId === yearId
        && Object.values(d.lines ?? {}).some((l) => (l?.reductionMinor ?? 0) > 0))).map((st) => st.id);
      for (let i = 0; i < socialIds.length; i += 30) {
        const page = await tx.get(db.collection('feeAllocationAnchors').where('schoolId', '==', schoolId).where('studentId', 'in', socialIds.slice(i, i + 30)));
        anchors.push(...page.docs.map((d) => d.data()).filter((a) => a.originSchoolYearId === yearId));
      }
      const missing = [...new Set(anchors.flatMap((a) => [a.socialVersionId, ...(a.socialSegments ?? []).map((x) => x.socialVersionId)]).filter((id) => id && !socialVersions.some((v) => v.id === id)))];
      for (const id of missing) socialVersions.push({ ...(await tx.get(db.doc(`feeAllocationSocialVersions/${id}`))).data(), id });
    }
    const calculatedAt = new Date(now).toISOString();
    const forecast = calculateAllocationForecast({ students: data(students), fees: feeRows, configs: configRows, versions, socialVersions, anchors,
      schoolId, yearId, currency, operational: ['ACTIVE', 'PAUSED'].includes(status) });
    const activeStudents = data(students).filter(st => st.schoolId === schoolId && st.schoolYearId === yearId && st.status === 'ACTIVE' && !st.deletedAt);
    return { fees, configs, forecast: { ...forecast, revision, calculatedAt }, activeStudents, activeYear: year.data(),
      save: { revision, parts: { fees: feeRows, configs: configRows, state: status }, forecast, savedAt: calculatedAt } };
  }, { readOnly: true });
  const { save, activeStudents, activeYear, ...response } = result;
  // Lot 27c-3b : prévu des lignes d'arriérés (années passées), ajouté au prévu gardé.
  if (save) {
    const arrearsRows = await readArrearsForecast({ db, schoolId, yearId, currency, activeYear, activeStudents, now });
    if (arrearsRows.length) {
      save.forecast = { ...save.forecast, rows: [...save.forecast.rows, ...arrearsRows] };
      response.forecast = { ...response.forecast, rows: save.forecast.rows };
    }
  }
  // Enregistrement hors de la lecture : un échec ne bloque jamais l'affichage (le prochain appel recalcule).
  // Il n'a lieu que si le signal n'a pas bougé depuis le calcul ; sans signal, un premier signal est créé
  // (jamais écrasé : si une fonction l'a écrit entre-temps, rien n'est gardé).
  if (save && Buffer.byteLength(JSON.stringify(save.forecast), 'utf8') < 800_000) {
    const signalRef = db.doc(`feeAllocationForecastSignals/${forecastSignalId(schoolId, yearId)}`);
    await db.runTransaction(async tx => {
      const current = await tx.get(signalRef);
      let revision = save.revision;
      if (revision === null) {
        if (current.exists) return;
        revision = `initial-${allocationHash([schoolId, yearId, save.savedAt, Math.random()])}`;
        tx.create(signalRef, { schoolId, schoolYearId: yearId, revision, changedAt: save.savedAt });
      } else if (current.data()?.revision !== revision) return;
      tx.set(cacheRef, { schoolId, schoolYearId: yearId, currency, key: forecastCacheKey({ signal: revision, ...save.parts }), forecast: save.forecast, savedAt: save.savedAt });
    }).catch(() => undefined);
  }
  return response;
}
