// Lot 27c-3b — prévu des lignes d'arriérés : ce que les élèves ACTIFS devaient encore au début de l'année
// active, pour chaque année passée, partagé selon la répartition de l'année d'origine (sinon tout en
// « Non affecté (arriéré AAAA-AAAA) »). Seuls des totaux sortent du serveur, jamais une identité d'élève.
import { supportBalance } from "./socialSupportMath.js";
import { feeAppliesToHistoricalStudent } from "./financialTransactions.js";
import { allocateFeeReceiptCumulative } from "./feeAllocationReceipts.js";
import { UNALLOCATED_RUBRIC_ID, arrearsRubricKey, validateFeeAllocationRubrics } from "./feeAllocationMath.js";
import { readAllocationPages } from "./feeAllocationPagination.js";
import { allocationHash } from "./feeAllocationRuntime.js";
import { toMoneyMinor } from "./money.js";

export const ARREARS_FORECAST_SCHEMA = 1;
const text = (value) => typeof value === "string" ? value.trim().toLocaleLowerCase("fr") : "";
const identityFields = ["nom", "postnom", "prenom", "birthDate"];

/** Fiches des années passées rattachées à un élève actif : filiation (importedFromStudentId), puis même
 * matricule avec une identité compatible — exactement les règles des arriérés de la caisse. */
export function linkHistoricalRecords(activeStudents, historicalStudents) {
  const byId = new Map(historicalStudents.map((s) => [s.id, s]));
  const byMatricule = new Map();
  for (const s of historicalStudents) if (text(s.matricule)) byMatricule.set(text(s.matricule), [...(byMatricule.get(text(s.matricule)) ?? []), s]);
  const linked = new Map();
  for (const current of activeStudents) {
    const records = new Map();
    let ancestor = current.importedFromStudentId;
    for (let depth = 0; ancestor && depth < 30 && !records.has(ancestor); depth++) {
      const record = byId.get(ancestor);
      if (!record) break;
      records.set(record.id, record);
      ancestor = record.importedFromStudentId;
    }
    for (const candidate of byMatricule.get(text(current.matricule)) ?? []) {
      const compatible = identityFields.every((f) => !text(current[f]) || !text(candidate[f]) || text(current[f]) === text(candidate[f]));
      const shared = identityFields.some((f) => text(current[f]) && text(current[f]) === text(candidate[f]));
      if (candidate.id !== current.id && compatible && shared) records.set(candidate.id, candidate);
    }
    // Une seule fiche par année : en cas de doute (deux fiches la même année), aucune n'est comptée.
    const perYear = new Map();
    for (const record of records.values()) perYear.set(record.schoolYearId, perYear.has(record.schoolYearId) ? null : record);
    for (const record of perYear.values()) if (record && !linked.has(record.id)) linked.set(record.id, record);
  }
  return [...linked.values()];
}

/** years : [{ year, fees, payments, configs, versions }] — années archivées antérieures à l'année active, même devise. */
export function calculateArrearsForecast({ activeYearId, linkedRecords, years }) {
  const rows = new Map();
  for (const { year, fees, payments, configs, versions } of years) {
    const records = linkedRecords.filter((s) => s.schoolYearId === year.id);
    if (!records.length) continue;
    for (const fee of fees) {
      const tariff = toMoneyMinor(fee.amount);
      if (!(tariff > 0)) continue;
      const config = configs.find((c) => c.feeTypeId === fee.id);
      const version = config?.currentVersionId ? versions.find((v) => v.id === config.currentVersionId) : null;
      const usable = version && version.feeAmountMinor === tariff && ["published", "superseded", "disabled"].includes(version.status);
      const checked = usable ? validateFeeAllocationRubrics(version.rubrics, tariff) : null;
      const shares = checked ? checked.shares : [{ rubricId: UNALLOCATED_RUBRIC_ID, amountMinor: tariff }];
      const names = new Map((checked?.rubrics ?? []).map((r) => [r.id, r.name]));
      for (const student of records) {
        if (!feeAppliesToHistoricalStudent(fee, student)) continue;
        const balance = supportBalance(student, fee);
        const net = toMoneyMinor(balance.net);
        // Payé avant l'année active : tout sauf les arriérés encaissés pendant l'année active.
        const paid = payments.filter((p) => p.studentId === student.id && p.feeTypeId === fee.id && p.collectionSchoolYearId !== activeYearId)
          .reduce((n, p) => n + toMoneyMinor(p.amount), 0);
        const remaining = Math.max(net - paid, 0);
        if (!remaining) continue;
        const table = balance.reduction > 0 ? 2 : 1;
        for (const share of allocateFeeReceiptCumulative(shares, remaining)) {
          const rubricId = arrearsRubricKey(year.id, share.rubricId), key = `${table}|${rubricId}`;
          const row = rows.get(key) ?? { feeTypeId: fee.id, className: "", classOptionKey: null, table, rubricId, arrearsYearName: String(year.name ?? year.id),
            rubricName: `${share.rubricId === UNALLOCATED_RUBRIC_ID ? "Non affecté" : names.get(share.rubricId) ?? "Rubrique"} (arriéré ${year.name ?? year.id})`,
            amountMinor: 0, studentsCount: 0, rubricShare: 0, tariffMinor: 0, rubricMode: null, basisPoints: null };
          row.amountMinor += share.amountMinor;
          if (!Number.isSafeInteger(row.amountMinor)) throw new Error("Prévu des arriérés hors limites.");
          rows.set(key, row);
        }
      }
    }
  }
  return [...rows.values()];
}

/** Lecture des années passées, gardée côté serveur : les années archivées ne changent plus ; seule la liste
 * des élèves actifs (identité et filiation) décide d'un nouveau calcul. Garde-fou : un jour au plus. */
export async function readArrearsForecast({ db, schoolId, yearId, currency, activeYear, activeStudents, now = Date.now() }) {
  const yearsSnapshot = await db.collection("schoolYears").where("schoolId", "==", schoolId).get();
  const archived = yearsSnapshot.docs.map((d) => ({ ...d.data(), id: d.id }))
    .filter((y) => y.id !== yearId && y.status === "archived" && (y.currency ?? currency) === currency
      && (!activeYear?.startsAt || !y.startsAt || y.startsAt < activeYear.startsAt));
  if (!archived.length || !activeStudents.length) return [];
  const identity = activeStudents.map((s) => [s.id, s.importedFromStudentId ?? null, s.matricule ?? null, ...identityFields.map((f) => s[f] ?? null)]).sort((a, b) => a[0].localeCompare(b[0]));
  const key = allocationHash([ARREARS_FORECAST_SCHEMA, yearId, currency, archived.map((y) => [y.id, y.status, y.name ?? null]).sort(), identity]);
  const cacheRef = db.doc(`feeAllocationArrearsCaches/${allocationHash(["arrears-cache", schoolId, yearId, currency])}`);
  const kept = (await cacheRef.get()).data();
  if (kept?.key === key && Number.isFinite(Date.parse(kept.savedAt)) && now - Date.parse(kept.savedAt) < 24 * 60 * 60 * 1000 && Array.isArray(kept.rows)) return kept.rows;
  const annual = (collection, archivedYearId) => db.collection(collection).where("schoolId", "==", schoolId).where("schoolYearId", "==", archivedYearId);
  // Lecture cohérente (une seule photographie) des années passées, sans aucune écriture.
  const years = await db.runTransaction((tx) => Promise.all(archived.map(async (year) => {
    const [students, fees, payments, configs] = await Promise.all([
      readAllocationPages(annual("students", year.id).select("schoolId", "schoolYearId", "className", "option", "matricule", "importedFromStudentId", "financialSupport", ...identityFields), tx),
      readAllocationPages(annual("feeTypes", year.id), tx), readAllocationPages(annual("payments", year.id).select("studentId", "feeTypeId", "amount", "collectionSchoolYearId"), tx),
      readAllocationPages(annual("feeAllocationConfigs", year.id), tx),
    ]);
    const data = (result) => result.docs.map((d) => ({ ...d.data(), id: d.id }));
    const configRows = data(configs);
    const versions = await Promise.all(configRows.filter((c) => c.currentVersionId).map(async (c) => ({ ...(await tx.get(db.doc(`feeAllocationVersions/${c.currentVersionId}`))).data(), id: c.currentVersionId })));
    return { year, students: data(students), fees: data(fees), payments: data(payments), configs: configRows, versions };
  })), { readOnly: true });
  const linkedRecords = linkHistoricalRecords(activeStudents, years.flatMap((y) => y.students));
  const rows = calculateArrearsForecast({ activeYearId: yearId, linkedRecords, years });
  if (Buffer.byteLength(JSON.stringify(rows), "utf8") < 800_000) {
    await db.runTransaction(async (tx) => { tx.set(cacheRef, { schoolId, schoolYearId: yearId, currency, key, rows, savedAt: new Date(now).toISOString() }); }).catch(() => undefined);
  }
  return rows;
}
