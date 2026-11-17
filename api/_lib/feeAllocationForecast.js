import { supportBalance } from './socialSupportMath.js';
import { feeAppliesToHistoricalStudent } from './financialTransactions.js';
import { allocateFeeReceiptCumulative } from './feeAllocationReceipts.js';
import { validateFeeAllocationRubrics } from './feeAllocationMath.js';
import { readAllocationPages } from './feeAllocationPagination.js';
import { allocationHash, allocationStateId, allocationFail as fail } from './feeAllocationRuntime.js';
import { toMoneyMinor } from './money.js';

export const forecastSignalId = (schoolId, yearId) => allocationHash([schoolId, yearId]);
export function calculateAllocationForecast({ students, fees, configs, versions, schoolId, yearId, currency, operational }) {
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
      for (const share of allocateFeeReceiptCumulative(checked.shares, net)) {
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
        ...(model ? { rubricShare: checked.shares.find(s => s.rubricId === rubricId)?.amountMinor ?? 0, tariffMinor: tariff,
          rubricMode: checked.rubrics.find(r => r.id === rubricId)?.mode ?? null, basisPoints: checked.rubrics.find(r => r.id === rubricId)?.basisPoints ?? null } : { rubricShare: tariff, tariffMinor: tariff, rubricMode: null, basisPoints: null }) });
    }
  }
  return { status: 'complete', rows, studentCount: activeStudents.length };
}

/** Only aggregates leave the API. Every page belongs to the same Firestore
 * snapshot; no partial school total, student identity or social reason leaks. */
export async function readAllocationForecast({ db, schoolId, yearId, currency }) {
  return db.runTransaction(async tx => {
    const annual = collection => db.collection(collection).where('schoolId', '==', schoolId).where('schoolYearId', '==', yearId);
    const [fees, configs, students, state, signal, school, year] = await Promise.all([
      readAllocationPages(annual('feeTypes'), tx), readAllocationPages(annual('feeAllocationConfigs'), tx),
      readAllocationPages(annual('students').select('schoolId', 'schoolYearId', 'className', 'option', 'status', 'deletedAt', 'financialSupport'), tx),
      tx.get(db.doc(`feeAllocationStates/${allocationStateId(schoolId, yearId, currency)}`)),
      tx.get(db.doc(`feeAllocationForecastSignals/${forecastSignalId(schoolId, yearId)}`)),
      tx.get(db.doc(`schools/${schoolId}`)), tx.get(db.doc(`schoolYears/${yearId}`)),
    ]);
    if (school.data()?.activeSchoolYearId !== yearId || year.data()?.schoolId !== schoolId
      || (year.data()?.currency ?? school.data()?.currency) !== currency) fail('Année ou devise modifiée pendant la consultation. Actualisez le prévu.');
    const data = result => result.docs.map(d => ({ ...d.data(), id: d.id }));
    const configRows = data(configs), feeRows = data(fees), versions = [];
    for (const config of configRows) if (config.currentVersionId) versions.push({ ...(await tx.get(db.doc(`feeAllocationVersions/${config.currentVersionId}`))).data(), id: config.currentVersionId });
    return { fees, configs, forecast: { ...calculateAllocationForecast({ students: data(students), fees: feeRows, configs: configRows, versions,
      schoolId, yearId, currency, operational: ['ACTIVE', 'PAUSED'].includes(state.data()?.status) }), revision: signal.data()?.revision ?? null, calculatedAt: new Date().toISOString() } };
  }, { readOnly: true });
}
