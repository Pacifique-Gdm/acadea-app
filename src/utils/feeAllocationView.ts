import type { AllocationWorkspace } from "../services/feeAllocation";
import type { FeeAllocationConfig, FeeAllocationRubric } from "../types/feeAllocation";
import { formatCurrencyMoney } from "./currency";

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
    formerMinor: number };
  /** Lignes « ↳ » : solde global de chaque sous-rubrique, puis « Non affecté (rubrique) ». Jamais comptées dans les totaux. */
  subLines?: AllocationSubLine[];
  /** F2 (28/11/2026) : lignes « ↳ » du tableau 3 (tableaux 1 et 2 additionnés), calculées avec la rubrique. */
  subLinesTotal?: AllocationSubLine[] };
/** Une ligne « ↳ » (null = « — », donnée absente). F2 (28/11/2026) : prévu, encaissé selon le filtre et ouverture
 * remplis avec le pourcentage de la sous-rubrique (montant fixe converti en %) ; « Reste » = rubrique moins le reste. */
export type AllocationSubLine = { id: string; name: string; openingMinor: number | null; cumulativeReceivedMinor: number; cumulativeSpentMinor: number; availableMinor: number;
  plannedMinor?: number | null; receivedMinor?: number | null;
  /** Prévu de la sous-rubrique par tableau, frais et classe (calculé par le serveur), avant les filtres de l'écran. */
  plannedDetail?: { table: 1 | 2; feeTypeId: string; classKey: string; amountMinor: number }[] };
/** F2 (décision du 28/11/2026) : nom de la ligne « ↳ » du reste, pour ne pas la confondre avec une rubrique « Non affecté ». */
export const SUB_REST_NAME = "Reste";

/** F2 (28/11/2026) : un montant n'est jamais coupé sur deux lignes, à l'écran comme dans le PDF (espaces insécables). */
export const unbreakableMoney = (minor: number, currency: "USD" | "CDF") => formatCurrencyMoney(minor / 100, currency).replace(/ /g, " ");
/** Montant fixe par élève et par frais payé, libellé court : « $2/élève » (sans « ,00 »), jamais coupé
 * (un « gluon » invisible U+2060 empêche le passage à la ligne après « / »). */
export const perStudentLabel = (minor: number, currency: "USD" | "CDF") => `${unbreakableMoney(minor, currency).replace(/,00(?!\d)/, "")}/⁠élève`;
/** Légende unique des lignes « ↳ », sous un tableau qui en contient. */
export const SUB_LINES_LEGEND = "↳ = détail de la rubrique";

/** Lignes « ↳ » d'une rubrique à partir de son solde (situation globale, commune aux tableaux 1, 2 et 3). */
export function allocationSubLines(balance: { openingMinor: number; subView?: NonNullable<AllocationWorkspace["ledger"]>["balances"][number]["subView"] } | undefined, currency: "USD" | "CDF"): AllocationSubLine[] | undefined {
  if (!balance?.subView?.length) return undefined;
  // F2 : la part de l'ouverture de chaque sous-rubrique est retirée de l'ouverture du reste.
  const restOpening = balance.openingMinor - balance.subView.reduce((n, sub) => n + (sub.id === "UNALLOCATED" ? 0 : sub.openingMinor ?? 0), 0);
  return balance.subView.map((sub) => sub.id === "UNALLOCATED"
    ? { id: sub.id, name: sub.name, openingMinor: restOpening, cumulativeReceivedMinor: sub.receivedMinor - restOpening, cumulativeSpentMinor: sub.spentMinor, availableMinor: sub.availableMinor }
    : { id: sub.id, name: `${sub.name} (${sub.mode === "fixed" ? perStudentLabel(sub.fixedMinor ?? 0, currency) : `${((sub.basisPoints ?? 0) / 100).toLocaleString("fr-FR")} %`})`,
      openingMinor: sub.openingMinor ?? null, cumulativeReceivedMinor: sub.receivedMinor, cumulativeSpentMinor: sub.spentMinor, availableMinor: sub.availableMinor,
      ...(sub.plannedMinor ? { plannedDetail: sub.plannedMinor } : {}) });
}
/** F2 (28/11/2026) : lignes « ↳ » d'UN tableau, tirées des parts des sous-rubriques enregistrées dans les mouvements
 * (encaissé, dépensé), de leur part de l'ouverture et de leur prévu. « Reste » = la rubrique de ce tableau moins ses
 * sous-rubriques, colonne par colonne : la somme des lignes « ↳ » est donc toujours égale à la rubrique, dans chaque tableau. */
export function tableSubLines(global: AllocationSubLine[], rubric: { plannedMinor: number; receivedMinor: number; openingMinor: number; cumulativeReceivedMinor: number; cumulativeSpentMinor: number; availableMinor: number },
  received: Map<string, number>, spent: Map<string, number>, extra: { opening?: Map<string, number>; planned?: Map<string, number>; filtered?: Map<string, number> } = {}): AllocationSubLine[] {
  const own = global.filter((line) => line.id !== "UNALLOCATED").map((line) => {
    const cumulativeReceivedMinor = received.get(line.id) ?? 0, cumulativeSpentMinor = spent.get(line.id) ?? 0;
    const openingMinor = line.openingMinor === null ? null : extra.opening?.get(line.id) ?? 0;
    return { id: line.id, name: line.name, openingMinor, cumulativeReceivedMinor, cumulativeSpentMinor, availableMinor: (openingMinor ?? 0) + cumulativeReceivedMinor - cumulativeSpentMinor,
      plannedMinor: line.plannedDetail && extra.planned ? extra.planned.get(line.id) ?? 0 : null, receivedMinor: extra.filtered ? extra.filtered.get(line.id) ?? 0 : null };
  });
  const sum = (field: "openingMinor" | "plannedMinor" | "receivedMinor" | "cumulativeReceivedMinor" | "cumulativeSpentMinor" | "availableMinor") => own.reduce((n, line) => n + (line[field] ?? 0), 0);
  return [...own, { id: "UNALLOCATED", name: SUB_REST_NAME, openingMinor: rubric.openingMinor - sum("openingMinor"),
    plannedMinor: own.some((line) => line.plannedMinor !== null) ? rubric.plannedMinor - sum("plannedMinor") : null,
    receivedMinor: extra.filtered ? rubric.receivedMinor - sum("receivedMinor") : null,
    cumulativeReceivedMinor: rubric.cumulativeReceivedMinor - sum("cumulativeReceivedMinor"),
    cumulativeSpentMinor: rubric.cumulativeSpentMinor - sum("cumulativeSpentMinor"), availableMinor: rubric.availableMinor - sum("availableMinor") }];
}
export type AllocationFinancialField = keyof NonNullable<AllocationRow["financial"]>;
export const unavailableAllocation = "Indisponible — répartition en préparation";
/** Lot du 21/11 : sans répartition configurée (école et année actives), ni tableaux ni « Non affecté », à l'écran comme dans le PDF. */
export const noAllocationConfiguredShort = "Aucune répartition n'est encore configurée.";
/** La phrase « Cliquez sur « + Ajouter »… » n'est montrée qu'aux comptes qui ont ce bouton. */
export const noAllocationConfigured = (canAdd: boolean) => canAdd ? `${noAllocationConfiguredShort} Cliquez sur « + Ajouter » pour commencer.` : noAllocationConfiguredShort;
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
      : row.rubricMode === "fixed" ? perStudentLabel(share, workspace.currency)
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

/** F2 : part du tableau 2 de chaque montant `parts` (dont la somme est un total de la rubrique), pour que leur somme
 * soit exactement `totalTwo` (la part du tableau 2 de la rubrique) : arrondi vers le bas, puis les centimes restants
 * aux plus grands restes. Une part positive ne dépasse jamais son montant ; un montant négatif suit la règle simple. */
export function splitLikeRubric(parts: number[], totalTwo: number, weight1: number, weight2: number) {
  if (weight2 <= 0) return parts.map(() => 0);
  if (weight1 <= 0) return [...parts];
  if (parts.some((part) => part < 0)) return parts.map((part) => prorataShares(part, weight1, weight2)[1]);
  const raw = parts.map((part) => (part * weight2) / (weight1 + weight2)), shares = raw.map(Math.floor);
  let rest = totalTwo - shares.reduce((n, x) => n + x, 0);
  for (const i of raw.map((x, index) => index).sort((a, b) => (raw[b] - shares[b]) - (raw[a] - shares[a]))) {
    if (rest <= 0) break;
    if (shares[i] < parts[i]) { shares[i] += 1; rest -= 1; }
  }
  return shares;
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
    // F2 : parts des sous-rubriques par tableau (encaissements) et au total (dépenses), comme la rubrique.
    const subReceived = { 1: new Map<string, number>(), 2: new Map<string, number>() }, subSpent = new Map<string, number>();
    // F2 : encaissé des sous-rubriques selon le filtre (mêmes filtres que la rubrique).
    const subFiltered = { 1: new Map<string, number>(), 2: new Map<string, number>() };
    // « Répartir le Reste » : argent passé de « Reste » aux sous-rubriques (total de la rubrique inchangé).
    const subTransfer = new Map<string, number>();
    for (const m of ledger.movements) {
      const day = m.postedAt.slice(0, 10), amount = m.lines.find(l => l.rubricId === rubric.id)?.amountMinor ?? 0;
      if (period?.to && day > period.to) continue;
      // End-of-period availability is cumulative, not the period's cash variation.
      availableMinor += amount;
      if (m.sourceType === "opening") { openingMinor += amount; continue; }
      // Compté dans « Encaissé (cumul) » des sous-rubriques (− pour « Reste »), jamais dans « Encaissé (filtre) ».
      if (m.sourceType === "transfer") { for (const line of m.subLines ?? []) if (line.rubricId === rubric.id) subTransfer.set(line.subRubricId, (subTransfer.get(line.subRubricId) ?? 0) + line.amountMinor); continue; }
      const table = m.socialCase ? 2 : 1;
      for (const line of m.subLines ?? []) if (line.rubricId === rubric.id) {
        if (m.sourceType === "expense") subSpent.set(line.subRubricId, (subSpent.get(line.subRubricId) ?? 0) - line.amountMinor);
        else subReceived[table].set(line.subRubricId, (subReceived[table].get(line.subRubricId) ?? 0) + line.amountMinor);
      }
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
      for (const line of m.subLines ?? []) if (line.rubricId === rubric.id) subFiltered[table].set(line.subRubricId, (subFiltered[table].get(line.subRubricId) ?? 0) + line.amountMinor);
      if (m.originSchoolYearId !== workspace.year.id) arrears[table] += amount;
    }
    const reserved = ledger.balances.find(b => b.rubricId === rubric.id)?.reservedMinor ?? 0;
    const subLines = allocationSubLines(ledger.balances.find(b => b.rubricId === rubric.id), workspace.currency);
    // This candidate does not create reservations. Fail explicitly rather than
    // display a balance that the three displayed components cannot explain.
    if (reserved) throw new Error("Réservations à rapprocher : le solde disponible ne peut pas être justifié par cette vue.");
    if (![spentMinor, availableMinor, openingMinor, cumulativeSpentMinor, received[1], received[2], cumulative[1], cumulative[2], former[1], former[2]].every(Number.isSafeInteger)) throw new Error("Totaux financiers hors limites.");
    if (openingMinor + cumulative[1] + cumulative[2] - cumulativeSpentMinor !== availableMinor) throw new Error("Écart dans le rapprochement de la rubrique.");
    const opening = prorataShares(openingMinor, cumulative[1], cumulative[2]);
    const spent = prorataShares(spentMinor, cumulative[1], cumulative[2]);
    const cumSpent = prorataShares(cumulativeSpentMinor, cumulative[1], cumulative[2]);
    const labels = percentLabels(workspace, forecast, rubric.id);
    // « Répartir le Reste » : partagé entre les tableaux 1 et 2 avec la règle de la rubrique (somme exacte).
    if (subTransfer.size) {
      const ids = [...subTransfer.keys()], parts = ids.map((id) => subTransfer.get(id)!);
      const two = splitLikeRubric(parts, prorataShares(parts.reduce((n, x) => n + x, 0), cumulative[1], cumulative[2])[1], cumulative[1], cumulative[2]);
      ids.forEach((id, i) => { subReceived[2].set(id, (subReceived[2].get(id) ?? 0) + two[i]); subReceived[1].set(id, (subReceived[1].get(id) ?? 0) + parts[i] - two[i]); });
    }
    // F2 : chaque tableau a ses propres lignes « ↳ » ; les dépenses de la rubrique (sous-rubriques et « Non affecté »)
    // sont partagées entre les tableaux 1 et 2 avec la même règle que la rubrique, au centime près : jamais négatives.
    const spentByTable = [new Map<string, number>(), new Map<string, number>()] as const;
    const spentIds = [...subSpent.keys()];
    const spentTwo = splitLikeRubric([...spentIds.map((id) => subSpent.get(id)!), cumulativeSpentMinor - [...subSpent.values()].reduce((n, x) => n + x, 0)], cumSpent[1], cumulative[1], cumulative[2]);
    spentIds.forEach((id, i) => { spentByTable[1].set(id, spentTwo[i]); spentByTable[0].set(id, subSpent.get(id)! - spentTwo[i]); });
    // F2 : part de l'ouverture de chaque sous-rubrique (calculée par le serveur, comme pour le Caissier), partagée entre
    // les tableaux 1 et 2 avec la règle de la rubrique. Une période qui s'arrête avant l'ouverture laisse tout dans « Reste ».
    const subOpening = [new Map<string, number>(), new Map<string, number>()] as const, openingShare = new Map<string, number>();
    const shared = (subLines ?? []).filter((line) => line.id !== "UNALLOCATED" && line.openingMinor !== null && line.openingMinor > 0);
    if (shared.length && openingMinor === (ledger.balances.find(b => b.rubricId === rubric.id)?.openingMinor ?? 0)) {
      const parts = shared.map((line) => line.openingMinor!);
      const two = splitLikeRubric([...parts, openingMinor - parts.reduce((n, x) => n + x, 0)], opening[1], cumulative[1], cumulative[2]);
      shared.forEach((line, i) => { openingShare.set(line.id, parts[i]); subOpening[1].set(line.id, two[i]); subOpening[0].set(line.id, parts[i] - two[i]); });
    }
    // F2 : prévu de chaque sous-rubrique par tableau, avec les filtres de l'écran (frais, classe).
    const subPlanned = [new Map<string, number>(), new Map<string, number>()] as const;
    for (const line of subLines ?? []) for (const part of line.plannedDetail ?? []) {
      if (filter.kind === "fee" && filter.value && filter.value !== allocationFeeKey(workspace.school.id, part.feeTypeId)) continue;
      if (filter.kind === "class" && filter.value && filter.value !== allocationClassKey(workspace.school.id, part.classKey)) continue;
      const map = subPlanned[part.table === 2 ? 1 : 0]; map.set(line.id, (map.get(line.id) ?? 0) + part.amountMinor);
    }
    const planned = { 1: (expected.get(`1|${rubric.id}`) ?? 0) + former[1], 2: (expected.get(`2|${rubric.id}`) ?? 0) + former[2] };
    const perTable = subLines && ([1, 2] as const).map((table, index) => tableSubLines(subLines, { plannedMinor: planned[table], receivedMinor: received[table], openingMinor: opening[index], cumulativeReceivedMinor: cumulative[table],
      cumulativeSpentMinor: cumSpent[index], availableMinor: opening[index] + cumulative[table] - cumSpent[index] }, subReceived[table], spentByTable[index],
      { opening: subOpening[index], planned: subPlanned[index], filtered: subFiltered[table] }));
    const both = (x: Map<string, number>, y: Map<string, number>) => new Map([...new Set([...x.keys(), ...y.keys()])].map((id) => [id, (x.get(id) ?? 0) + (y.get(id) ?? 0)]));
    const subLinesTotal = subLines && tableSubLines(subLines, { plannedMinor: planned[1] + planned[2], receivedMinor: received[1] + received[2], openingMinor, cumulativeReceivedMinor: cumulative[1] + cumulative[2], cumulativeSpentMinor,
      availableMinor: openingMinor + cumulative[1] + cumulative[2] - cumulativeSpentMinor }, both(subReceived[1], subReceived[2]), subSpent,
      { opening: openingShare, planned: both(subPlanned[0], subPlanned[1]), filtered: both(subFiltered[1], subFiltered[2]) });
    return ([1, 2] as const).map((table, index): AllocationRow => ({ key: `${workspace.school.id}/${workspace.year.id}/${table}/${rubric.id}`, schoolId: workspace.school.id, schoolName: workspace.school.name,
      yearName: workspace.year.name, feeName: "Rubrique commune · disponible global", classLabel: "Toutes les classes", currency: workspace.currency,
      rubricName: rubric.name, amountMinor: planned[table], percent: 0, config: workspace.configs[0], stale: false,
      table, rubricId: rubric.id, ...labels, ...("arrearsYearName" in rubric && rubric.arrearsYearName ? { arrearsYearName: rubric.arrearsYearName } : {}),
      financial: { receivedMinor: received[table], spentMinor: spent[index], openingMinor: opening[index],
        cumulativeReceivedMinor: cumulative[table], cumulativeSpentMinor: cumSpent[index], arrearsMinor: arrears[table], formerMinor: former[table],
        availableMinor: opening[index] + cumulative[table] - cumSpent[index] }, ...(perTable && subLinesTotal ? { subLines: perTable[index], subLinesTotal } : {}) }));
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
    // F2 : le tableau 3 prend ses propres lignes « ↳ » (tableaux 1 et 2 additionnés), calculées avec la rubrique.
    if (!current) { sum.set(key, { ...row, table: 3, key: `${row.key}/total`, financial: row.financial ? { ...row.financial } : undefined, ...(row.subLinesTotal ? { subLines: row.subLinesTotal } : {}) }); continue; }
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
