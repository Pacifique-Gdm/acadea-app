import type { AllocationWorkspace } from "../services/feeAllocation";
import type { FeeAllocationConfig, FeeAllocationRubric } from "../types/feeAllocation";

export type AllocationFilter = { kind: "fee" | "class" | "period"; value: string; from: string; to: string };
/** Lot 27c-1 : 1 = élèves normalement inscrits, 2 = cas sociaux et prises en charge, 3 = ensemble (somme). */
export type AllocationTable = 1 | 2 | 3;
export type AllocationRow = { key: string; schoolId: string; schoolName: string; yearName: string; feeName: string;
  table?: AllocationTable; rubricId?: string; percentLabel?: string; percentDetail?: string;
  /** Lot 27c-3a : ligne d'arriéré, regroupée sous « Arriérés AAAA-AAAA ». */
  arrearsYearName?: string;
  classLabel: string; currency: "USD" | "CDF"; rubricName: string; rubric?: FeeAllocationRubric;
  amountMinor: number; percent: number; config: FeeAllocationConfig; stale: boolean;
  financial?: { receivedMinor: number; spentMinor: number; availableMinor: number; openingMinor: number; arrearsMinor: number;
    cumulativeReceivedMinor: number; cumulativeSpentMinor: number;
    /** Lot 27c-2 : paiements d'anciens élèves, inclus à la fois dans le prévu et dans l'encaissé. */
    formerMinor: number } };
export type AllocationFinancialField = keyof NonNullable<AllocationRow["financial"]>;
export const unavailableAllocation = "Indisponible — répartition en préparation";
/** Lot du 21/11 : sans répartition configurée (école et année actives), ni tableaux ni « Non affecté », à l'écran comme dans le PDF. */
export const noAllocationConfigured = "Aucune répartition n'est encore configurée. Cliquez sur « + Ajouter » pour commencer.";
export const allocationConfigured = (workspaces: Pick<AllocationWorkspace, "configs">[]) => workspaces.some((w) => w.configs.length > 0);
export const allocationFeeKey = (schoolId: string, feeId: string) => JSON.stringify([schoolId, feeId]);
export const allocationClassKey = (schoolId: string, classKey: string) => JSON.stringify([schoolId, classKey]);
export const allocationClassLabel = (value: string) => value.replace("::option::", " — ");
export function allocationFilterChoices(workspaces: AllocationWorkspace[], kind: AllocationFilter['kind']) {
  const multiple = workspaces.length > 1;
  const pairs = workspaces.flatMap(w => w.fees.map(f => [
    kind === 'class' ? allocationClassKey(w.school.id, f.classOptionKey || f.className) : allocationFeeKey(w.school.id, f.id),
    `${multiple ? w.school.name + ' · ' : ''}${kind === 'class' ? '' : f.name + ' — '}${allocationClassLabel(f.classOptionKey || f.className)}`,
  ] as const));
  return [...new Map(pairs)];
}
const date = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
export function allocationPeriod(value: string, from: string, to: string, now = new Date()): { from: string; to: string } {
  const today = date(now);
  if (value === "today") return { from: today, to: today };
  if (value === "week") { const start = new Date(now); start.setDate(start.getDate() - (start.getDay() + 6) % 7); return { from: date(start), to: today }; }
  if (value === "month") return { from: `${today.slice(0, 7)}-01`, to: today };
  if (value === "custom") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to
      || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))
      || new Date(from).toISOString().slice(0, 10) !== from || new Date(to).toISOString().slice(0, 10) !== to) throw new Error("Choisissez des dates valides et ordonnées.");
    return { from, to };
  }
  return { from: "", to: "" };
}
export function projectAllocations(workspaces: AllocationWorkspace[], filter: AllocationFilter, now = new Date()): AllocationRow[] {
  const period = filter.kind === "period" ? allocationPeriod(filter.value, filter.from, filter.to, now) : null;
  return workspaces.flatMap((workspace) => {
    if (workspace.ledger) return projectOperational(workspace, filter, period);
    return projectAnnual(workspace, filter);
  });
}

type ForecastRow = NonNullable<AllocationWorkspace["forecast"]>["rows"][number];
const tableOf = (row: { table?: 1 | 2 }) => (row.table === 2 ? 2 : 1) as 1 | 2;
const percentText = (value: number) => `${value.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;

/** « Salaires (60 %) » ; pourcentages différents : « Salaires (40 % et 60 %) » + « Minerval 60 % · Transport 40 % ». */
function percentLabels(workspace: AllocationWorkspace, rows: ForecastRow[], rubricId: string) {
  const parts = new Map<string, string>();
  for (const row of rows.filter((item) => item.rubricId === rubricId)) {
    const fee = workspace.fees.find((item) => item.id === row.feeTypeId)?.name ?? "Frais";
    const tariff = row.tariffMinor ?? 0, share = row.rubricShare ?? 0;
    const text = row.rubricMode === "percent" && row.basisPoints ? percentText(row.basisPoints / 100)
      : row.rubricMode === "fixed" ? `${(share / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${workspace.currency} fixe`
      : tariff > 0 ? percentText(Math.round((share / tariff) * 10000) / 100) : "";
    if (text && !parts.has(fee)) parts.set(fee, text);
  }
  const values = [...new Set(parts.values())];
  if (!values.length) return { percentLabel: undefined, percentDetail: undefined };
  return { percentLabel: values.length === 1 ? values[0] : `${values.slice(0, -1).join(", ")} et ${values.at(-1)}`,
    percentDetail: values.length > 1 ? [...parts].map(([fee, text]) => `${fee} ${text}`).join(" · ") : undefined };
}

function filteredForecast(workspace: AllocationWorkspace, filter: AllocationFilter) {
  if (workspace.forecast?.status !== 'complete') throw new Error('Prévu annuel non confirmé : aucun total partiel ne peut être affiché.');
  return workspace.forecast.rows.filter((item) => !(filter.kind === 'fee' && filter.value && filter.value !== allocationFeeKey(workspace.school.id, item.feeTypeId))
    && !(filter.kind === 'class' && filter.value && filter.value !== allocationClassKey(workspace.school.id, item.classOptionKey || item.className)));
}

function projectAnnual(workspace: AllocationWorkspace, filter: AllocationFilter): AllocationRow[] {
  const forecast = filteredForecast(workspace, filter);
  const rows = new Map<string, AllocationRow>();
  for (const item of forecast) {
    // A period constrains receipts, never the annual net obligation.
    const table = tableOf(item), key = `${table}|${item.rubricId}`;
    const existing = rows.get(key);
    if (existing) { existing.amountMinor += item.amountMinor; existing.feeName = 'Frais du périmètre'; existing.classLabel = 'Classes du périmètre'; }
    else {
      const config = workspace.configs.find(c => c.feeTypeId === item.feeTypeId) ?? { id: '', schoolId: workspace.school.id, schoolYearId: workspace.year.id,
        feeTypeId: item.feeTypeId, className: item.className, currency: workspace.currency, draftRevision: 0 };
      rows.set(key, { key: `${workspace.school.id}/${workspace.year.id}/${table}/${item.rubricId}`, schoolId: workspace.school.id, schoolName: workspace.school.name,
        yearName: workspace.year.name, feeName: workspace.fees.find(f => f.id === item.feeTypeId)?.name ?? 'Libellé du frais indisponible',
        classLabel: allocationClassLabel(item.classOptionKey || item.className), currency: workspace.currency, rubricName: item.rubricName,
        rubric: config.draft?.rubrics.find(r => r.id === item.rubricId), amountMinor: item.amountMinor, percent: 0, config, stale: false,
        table, rubricId: item.rubricId, ...percentLabels(workspace, forecast.filter((other) => tableOf(other) === table), item.rubricId), ...(item.arrearsYearName ? { arrearsYearName: item.arrearsYearName } : {}) });
    }
    if (!Number.isSafeInteger(rows.get(key)!.amountMinor)) throw new Error('Prévu annuel hors limites.');
  }
  return [...rows.values()];
}

/** Partage d'un montant commun à la rubrique (ouverture, dépenses) entre les tableaux 1 et 2, à proportion
 * de leurs encaissements cumulés ; le tableau 2 est arrondi au centime inférieur, le tableau 1 reçoit le reste :
 * la somme des deux est toujours exactement le total réel (tableau 3). */
export function prorataShares(total: number, weight1: number, weight2: number) {
  if (total === 0 || weight2 <= 0) return [total, 0] as const;
  if (weight1 <= 0) return [0, total] as const;
  const second = total >= 0 ? Math.floor((total * weight2) / (weight1 + weight2)) : -Math.floor((-total * weight2) / (weight1 + weight2));
  return [total - second, second] as const;
}

function projectOperational(workspace: AllocationWorkspace, filter: AllocationFilter, period: { from: string; to: string } | null): AllocationRow[] {
  const ledger = workspace.ledger!;
  if (!workspace.configs.length) throw new Error("Configuration active manquante.");
  const forecast = filteredForecast(workspace, filter);
  const base = projectAnnual(workspace, filter);
  const expected = new Map(base.map(row => [`${row.table}|${row.rubricId}`, row.amountMinor]));
  const rubrics = new Map(ledger.rubrics.map(r => [r.id, r]));
  base.forEach(r => { if (!rubrics.has(r.rubricId!)) rubrics.set(r.rubricId!, { id: r.rubricId!, name: r.rubricName, ...(r.arrearsYearName ? { arrearsYearName: r.arrearsYearName } : {}) }); });
  return [...rubrics.values()].flatMap(rubric => {
    // Totaux communs à la rubrique (comme avant), puis encaissements séparés par tableau.
    let spentMinor = 0, availableMinor = 0, openingMinor = 0, cumulativeSpentMinor = 0;
    const received = { 1: 0, 2: 0 }, cumulative = { 1: 0, 2: 0 }, arrears = { 1: 0, 2: 0 }, former = { 1: 0, 2: 0 };
    for (const m of ledger.movements) {
      const day = m.postedAt.slice(0, 10), amount = m.lines.find(l => l.rubricId === rubric.id)?.amountMinor ?? 0;
      if (period?.to && day > period.to) continue;
      // End-of-period availability is cumulative, not the period's cash variation.
      availableMinor += amount;
      if (m.sourceType === "opening") { openingMinor += amount; continue; }
      const table = m.socialCase ? 2 : 1;
      if (m.sourceType === "expense") cumulativeSpentMinor -= amount;
      else cumulative[table] += amount;
      // Lot 27c-2 : un paiement d'ancien élève augmente le prévu annuel du même montant (jamais réduit par une période).
      if (m.sourceType === "payment" && m.formerStudent
        && !(filter.kind === "fee" && filter.value && filter.value !== allocationFeeKey(workspace.school.id, m.feeTypeId ?? ""))
        && !(filter.kind === "class" && filter.value && filter.value !== allocationClassKey(workspace.school.id, m.classOptionKey || m.className || ""))) former[table] += amount;
      if (period?.from && day < period.from) continue;
      if (m.sourceType === "expense") { spentMinor -= amount; continue; }
      if (filter.kind === "fee" && filter.value && filter.value !== allocationFeeKey(workspace.school.id, m.feeTypeId ?? "")) continue;
      if (filter.kind === "class" && filter.value && filter.value !== allocationClassKey(workspace.school.id, m.classOptionKey || m.className || "")) continue;
      received[table] += amount;
      if (m.originSchoolYearId !== workspace.year.id) arrears[table] += amount;
    }
    const reserved = ledger.balances.find(b => b.rubricId === rubric.id)?.reservedMinor ?? 0;
    // This candidate does not create reservations. Fail explicitly rather than
    // display a balance that the three displayed components cannot explain.
    if (reserved) throw new Error("Réservations à rapprocher : le solde disponible ne peut pas être justifié par cette vue.");
    if (![spentMinor, availableMinor, openingMinor, cumulativeSpentMinor, received[1], received[2], cumulative[1], cumulative[2], former[1], former[2]].every(Number.isSafeInteger)) throw new Error("Totaux financiers hors limites.");
    if (openingMinor + cumulative[1] + cumulative[2] - cumulativeSpentMinor !== availableMinor) throw new Error("Écart dans le rapprochement de la rubrique.");
    const opening = prorataShares(openingMinor, cumulative[1], cumulative[2]);
    const spent = prorataShares(spentMinor, cumulative[1], cumulative[2]);
    const cumSpent = prorataShares(cumulativeSpentMinor, cumulative[1], cumulative[2]);
    const labels = percentLabels(workspace, forecast, rubric.id);
    return ([1, 2] as const).map((table, index): AllocationRow => ({ key: `${workspace.school.id}/${workspace.year.id}/${table}/${rubric.id}`, schoolId: workspace.school.id, schoolName: workspace.school.name,
      yearName: workspace.year.name, feeName: "Rubrique commune · disponible global", classLabel: "Toutes les classes", currency: workspace.currency,
      rubricName: rubric.name, amountMinor: (expected.get(`${table}|${rubric.id}`) ?? 0) + former[table], percent: 0, config: workspace.configs[0], stale: false,
      table, rubricId: rubric.id, ...labels, ...("arrearsYearName" in rubric && rubric.arrearsYearName ? { arrearsYearName: rubric.arrearsYearName } : {}),
      financial: { receivedMinor: received[table], spentMinor: spent[index], openingMinor: opening[index],
        cumulativeReceivedMinor: cumulative[table], cumulativeSpentMinor: cumSpent[index], arrearsMinor: arrears[table], formerMinor: former[table],
        availableMinor: opening[index] + cumulative[table] - cumSpent[index] } }));
  });
}

// Règle du propriétaire : une rubrique est cachée quand son PRÉVU vaut 0. Sécurité : jamais si elle a un encaissé,
// une dépense ou un disponible différent de 0 (l'argent n'échappe jamais aux tableaux). En préparation (aucun
// registre), une rubrique configurée reste visible même à 0 pour que l'Administrateur ouvre son détail.
const isEmptyRow = (row: AllocationRow) => {
  if (row.amountMinor !== 0) return false;
  if (row.financial) {
    const f = row.financial;
    return [f.receivedMinor, f.cumulativeReceivedMinor, f.spentMinor, f.cumulativeSpentMinor, f.availableMinor].every((value) => value === 0);
  }
  return row.table === 2 || !row.percentLabel;
};

/** Trois tableaux sur le même modèle : 1, 2 et 3 = somme rubrique par rubrique et colonne par colonne.
 * Une rubrique sans aucun montant n'apparaît pas dans le tableau concerné. */
export function buildAllocationTables(rows: AllocationRow[]) {
  const one = rows.filter((row) => (row.table ?? 1) === 1), two = rows.filter((row) => row.table === 2);
  const sum = new Map<string, AllocationRow>();
  for (const row of rows) {
    const key = `${row.schoolId}/${row.currency}/${row.rubricId ?? row.key}`;
    const current = sum.get(key);
    if (!current) { sum.set(key, { ...row, table: 3, key: `${row.key}/total`, financial: row.financial ? { ...row.financial } : undefined }); continue; }
    current.amountMinor += row.amountMinor;
    if (current.financial && row.financial) for (const field of Object.keys(current.financial) as AllocationFinancialField[]) current.financial[field] += row.financial[field];
    else current.financial = undefined;
  }
  // Rubriques de l'année d'abord, puis une partie par année d'origine des arriérés (« Non affecté » en dernier).
  const order = (list: AllocationRow[]) => list.filter((row) => !isEmptyRow(row)).map((row, index) => ({ row, index }))
    .sort((a, b) => (a.row.arrearsYearName ? 1 : 0) - (b.row.arrearsYearName ? 1 : 0)
      || (a.row.arrearsYearName ?? "").localeCompare(b.row.arrearsYearName ?? "", "fr")
      || (a.row.arrearsYearName ? Number(a.row.rubricName.startsWith("Non affecté")) - Number(b.row.rubricName.startsWith("Non affecté")) : 0)
      || a.index - b.index).map(({ row }) => row);
  return { one: order(one), two: order(two), three: order([...sum.values()]) };
}

export function allocationFinancialTotals(rows: AllocationRow[], field: AllocationFinancialField) {
  return [...new Set(rows.map(r => r.currency))].map(currency => {
    const selected = rows.filter(r => r.currency === currency);
    if (selected.some(r => !r.financial)) return { currency, value: null };
    const value = selected.reduce((n, r) => n + r.financial![field], 0);
    if (!Number.isSafeInteger(value)) throw new Error("Total financier hors limites.");
    return { currency, value };
  });
}
export function allocationTotals(rows: AllocationRow[]) {
  const totals = new Map<"USD" | "CDF", number>();
  for (const row of rows) { const total = (totals.get(row.currency) ?? 0) + row.amountMinor;
    if (!Number.isSafeInteger(total)) throw new Error("Total trop élevé pour une synthèse exacte."); totals.set(row.currency, total); }
  return [...totals].map(([currency, amountMinor]) => ({ currency, amountMinor }));
}
