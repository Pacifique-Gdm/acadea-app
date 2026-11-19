import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChartPie } from "lucide-react";
import { AdminDrawer } from "../../components/ui";
import type { AppUser, School } from "../../types";
import type { FeeAllocationConfig, FeeAllocationRubric, FeeAllocationVersion } from "../../types/feeAllocation";
import { AllocationApiError, allocationRequest, createRubric, loadAllocationVersions, loadAllocationWorkspace, loadRubricCatalog, saveAllocationDrafts, type AllocationCatalogRubric, type AllocationWorkspace, type SaveAllocationDrafts } from "../../services/feeAllocation";
import { RubricCatalogPanel } from "./RubricCatalogPanel";
import { allocationSnapshotIsCurrent, loadAllocationSnapshot, markAllocationAccess, peekAllocationSnapshot, pendingAllocationSnapshot, rememberAllocationUse } from "../../services/feeAllocationStore";
import { SharingTab } from "./FeeAllocationSharing";
import { useAllocationShares } from "./feeAllocationSharingState";
import { loadMySharedRubrics } from "../../services/feeAllocation";
import { validateFeeAllocationRubrics } from "../../../api/_lib/feeAllocationMath.js";
import { allocationClassLabel, allocationFilterChoices, allocationTotals, allocationFinancialTotals, buildAllocationTables, projectAllocations, unavailableAllocation, type AllocationFilter, type AllocationRow } from "../../utils/feeAllocationView";
import { formatCurrencyMoney } from "../../utils/currency";
import { toMoneyMinor } from "../../utils/money";
import { renderAcadPdfPreview } from "../../utils/pdf";
import { feeAllocationPdfSections } from "../../utils/feeAllocationPdf";
import { FeeAllocationActivation } from "./FeeAllocationActivation";
import { AllocationActionButton as Action } from "./AllocationActionButton";
import { SocialPartEditor } from "./FeeAllocationSocialPart";

const roles = new Set(["school_admin", "cashier", "coordination_admin", "sub_coordination_admin"]);
/** Lot « Deux onglets » : le personnel voit le drawer seulement si une rubrique lui est partagée. */
const staffRoles = new Set(["discipline_director", "study_director", "secretary", "teacher"]);
const myShares = new Map<string, Promise<string[]>>();
function useHasSharedRubrics(user: AppUser) {
  const staff = staffRoles.has(user.role);
  const [shared, setShared] = useState<boolean | null>(staff ? null : false);
  useEffect(() => {
    if (!staff) return;
    let alive = true;
    // Vérifié à chaque affichage du Menu : un partage retiré fait disparaître le drawer.
    const pending = loadMySharedRubrics().then((r) => r.rubricIds).catch(() => [] as string[]);
    myShares.set(user.id, pending);
    void pending.then((ids) => { if (alive) setShared(ids.length > 0); });
    return () => { alive = false; };
  }, [staff, user.id]);
  return shared;
}
const newId = () => crypto.randomUUID().replaceAll("-", "");
const message = (cause: unknown) => cause instanceof Error ? cause.message : "Répartition indisponible.";
type Props = { user: AppUser; schools: School[]; selectedSchoolId?: string; onSchoolChange?: (id: string) => void; institution?: School };
export function FeeAllocationEntry({ user, schools, selectedSchoolId = "", onSchoolChange, institution }: Props) {
  const [open, setOpen] = useState(false);
  const shared = useHasSharedRubrics(user);
  if (!roles.has(user.role) && !shared) return null;
  const selected = schools.filter((school) => !selectedSchoolId || school.id === selectedSchoolId);
  return <>
    <button type="button" className="min-w-0 rounded border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-mint" onClick={() => setOpen(true)}>
      <span className="flex items-center gap-3 font-bold text-ink"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-100 text-ink"><ChartPie className="h-5 w-5" /></span>Répartition des frais</span>
    </button>
    {open && <AdminDrawer title="Répartition des frais" closeLabel="Fermer Répartition des frais" width="wide" onClose={() => setOpen(false)}
      toolbar={onSchoolChange && <label className="grid gap-1 text-sm">Établissement<select className="input" value={selectedSchoolId} onChange={(event) => onSchoolChange(event.target.value)}><option value="">Toutes les écoles autorisées</option>{schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label>}>
      <FeeAllocationContent key={`${user.id}:${selected.map((school) => school.id).sort().join("|")}`} user={user} schools={selected} institution={institution} />
    </AdminDrawer>}
  </>;
}

export function FeeAllocationContent({ user, schools, institution }: Pick<Props, "user" | "schools" | "institution">) {
  const ids = schools.map((school) => school.id).sort().join("|");
  const schoolIds = useMemo(() => ids ? ids.split("|") : [], [ids]);
  // Lot « répartition rapide » : les données préparées (à la connexion ou à une ouverture précédente)
  // s'affichent tout de suite ; elles sont vérifiées en arrière-plan et rechargées seulement si
  // quelque chose a réellement changé (paiement, dépense, correction, répartition, élèves, frais).
  const staffView = staffRoles.has(user.role);
  markAllocationAccess(user);
  const initial = peekAllocationSnapshot(user.id, schoolIds);
  const [workspaces, setWorkspaces] = useState<AllocationWorkspace[]>(initial?.workspaces ?? []);
  const [loading, setLoading] = useState(!initial);
  const [checking, setChecking] = useState(Boolean(initial));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState<AllocationFilter>({ kind: "fee", value: "", from: "", to: "" });
  const [editor, setEditor] = useState<{ workspace: AllocationWorkspace; config?: FeeAllocationConfig } | null>(null);
  const [detail, setDetail] = useState<AllocationRow | null>(null);
  const [versions, setVersions] = useState<FeeAllocationVersion[] | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const pdfLock = useRef(false), detailLock = useRef(false);
  const [detailAction, setDetailAction] = useState("");
  const [socialPart, setSocialPart] = useState<FeeAllocationConfig | null>(null);
  const versionRequests = useRef(new Map<string, string>());
  const generation = useRef(0), busy = useRef(false);
  const refresh = useCallback(async (mode: "verify" | "reload") => {
    const run = ++generation.current;
    const shown = peekAllocationSnapshot(user.id, schoolIds);
    busy.current = true;
    if (shown) setChecking(true); else setLoading(true);
    try {
      let snapshot = shown;
      if (mode === "reload" || !shown || !await allocationSnapshotIsCurrent(shown)) {
        const preparing = mode === "verify" && !shown ? pendingAllocationSnapshot(user.id, schoolIds) : null;
        snapshot = await (preparing ?? loadAllocationSnapshot(user.id, schoolIds, mode === "reload"));
      }
      if (run !== generation.current) return;
      if (snapshot && snapshot !== shown) setWorkspaces(snapshot.workspaces);
      setError("");
    } catch (cause) {
      if (run === generation.current) setError(shown ? `Actualisation automatique non confirmée. ${message(cause)}` : message(cause));
    } finally {
      if (run === generation.current) { busy.current = false; setLoading(false); setChecking(false); }
    }
  }, [user.id, schoolIds]);
  useEffect(() => {
    rememberAllocationUse(user.id);
    void refresh("verify");
    // Fermeture : une réponse arrivée après coup est ignorée (compteur de génération).
    const runs = generation, running = busy;
    return () => { runs.current++; running.current = false; };
  }, [refresh, user.id]);
  useEffect(() => {
    // Un changement fait sur cet appareil (paiement, dépense…) : rechargement immédiat en arrière-plan.
    const changed = () => void refresh("reload");
    const check = () => { if (!busy.current && document.visibilityState !== "hidden" && navigator.onLine) void refresh("verify"); };
    window.addEventListener('acadea:financial-projection-changed', changed);
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', check);
    // Changements faits ailleurs : une petite vérification par minute tant que le drawer est ouvert.
    const timer = window.setInterval(check, Math.max(60_000, schoolIds.length * 4000));
    return () => { window.removeEventListener('acadea:financial-projection-changed', changed); window.removeEventListener('online', check); document.removeEventListener('visibilitychange', check); window.clearInterval(timer); };
  }, [refresh, schoolIds.length]);
  // Lot 27b : les noms viennent du catalogue des rubriques (un renommage s'applique partout).
  const named = useMemo(() => workspaces.map((w) => {
    const names = new Map((w.rubricCatalog ?? []).map((r) => [r.id, r.name]));
    if (!names.size) return w;
    return { ...w,
      ...(w.forecast ? { forecast: { ...w.forecast, rows: w.forecast.rows.map((row) => names.has(row.rubricId) ? { ...row, rubricName: names.get(row.rubricId)! } : row) } } : {}),
      ...(w.ledger ? { ledger: { ...w.ledger, rubrics: w.ledger.rubrics.map((r) => names.has(r.id) ? { ...r, name: names.get(r.id)! } : r) } } : {}) };
  }), [workspaces]);
  const projection = useMemo(() => {
    try { const rows = projectAllocations(named, filter); return { rows, totals: allocationTotals(rows), error: "" }; }
    catch (cause) { return { rows: [], totals: [], error: message(cause) }; }
  }, [named, filter]);
  // Lot 27c-1 : trois tableaux sur le même modèle (1 = élèves normaux, 2 = cas sociaux, 3 = ensemble).
  const tables = useMemo(() => buildAllocationTables(projection.rows), [projection.rows]);
  const ready = !loading && !error && !projection.error && workspaces.length > 0;
  // Tant que la vérification n'a pas confirmé les données affichées : pas d'export ni de modification.
  const current = ready && !checking;
  const operational = workspaces.some(w => w.ledger);
  const configurable = user.role === "school_admin" && workspaces.length === 1 && workspaces[0].canConfigure;
  // Lot « Deux onglets » : « Répartition annuelle » / « Partage répartition » (Administrateur seulement).
  const [tab, setTab] = useState<"annual" | "sharing">("annual");
  const sharing = useAllocationShares(workspaces[0]?.school.id ?? "", configurable);
  const rubricNames = useMemo(() => new Map((workspaces[0]?.rubricCatalog ?? []).map((r) => [r.id, r.name] as const)), [workspaces]);
  const rubricOrder = useMemo(() => [...new Set(tables.three.map((row) => row.rubricId ?? ""))].filter(Boolean), [tables]);
  const multipleSchools = workspaces.length > 1;
  const hasConfiguration = workspaces.some(w => w.configs.length || w.ledger || w.forecast?.rows.length);
  const choices = useMemo(() => allocationFilterChoices(workspaces, filter.kind), [workspaces, filter.kind]);
  const detailWorkspace = workspaces.find(w => w.school.id === detail?.schoolId);
  const detailConfigs = detailWorkspace?.configs.filter(c => detailWorkspace.forecast?.rows.some(r => r.feeTypeId === c.feeTypeId
    && r.rubricId === detail?.key.split('/').at(-1)
    && (filter.kind !== 'fee' || !filter.value || filter.value === JSON.stringify([c.schoolId, c.feeTypeId]))
    && (filter.kind !== 'class' || !filter.value || filter.value === JSON.stringify([c.schoolId, r.classOptionKey || r.className])))) ?? [];
  const periods = [["today", "Aujourd'hui"], ["week", "Cette semaine"], ["month", "Ce mois"], ["year", "Cette année scolaire"], ["custom", "Dates personnalisées"]];
  const filterLabel = `${filter.kind === "fee" ? "Frais" : filter.kind === "class" ? "Classe" : operational ? "Période comptabilisée" : "Période de préparation"} : ${filter.kind === "period"
    ? `${periods.find(([value]) => value === filter.value)?.[1] ?? "Cette année scolaire"}${filter.value === "custom" ? ` (${filter.from} au ${filter.to})` : ""}`
    : choices.find(([value]) => value === filter.value)?.[1] ?? (filter.kind === "fee" ? "Tous les frais" : "Toutes les classes")}`;
  async function exportPdf() {
    if (!current || pdfLock.current) return;
    pdfLock.current = true; setPdfBusy(true); setError("");
    try {
      const school = institution ?? schools[0];
      if (!school) throw new Error("Établissement indisponible.");
      // Re-read the authoritative snapshot before export, including changes
      // whose asynchronous invalidation signal has not arrived yet.
      const fresh: AllocationWorkspace[] = [];
      for (const workspace of workspaces) fresh.push(await loadAllocationWorkspace(workspace.school.id, undefined, { fresh: true, shared: staffView }));
      const freshRows = projectAllocations(fresh, filter);
      setWorkspaces(fresh);
      await renderAcadPdfPreview({ filename: "repartition-frais.pdf", title: "Répartition des frais", school,
        subtitle: operational ? "Registre rapproché — situation par établissement" : "Configuration préparatoire — aucune disponibilité financière", throwOnError: true,
        sections: feeAllocationPdfSections(freshRows, filterLabel, fresh.map((item) => `${item.school.name} · ${item.year.name} · ${item.currency}`).join(" ; "), filter.kind === 'period', { onlyTableThree: staffView }) });
    } catch (cause) { setError(message(cause)); } finally { pdfLock.current = false; setPdfBusy(false); }
  }
  async function showVersions(config: FeeAllocationConfig, prepare = false) {
    if (detailLock.current) return;
    detailLock.current = true; setDetailAction(prepare ? "prepare" : "versions"); setDetailBusy(true); setError("");
    try {
      if (prepare) {
        const key = `${config.id}/${config.draftRevision}`;
        if (!versionRequests.current.has(key)) versionRequests.current.set(key, newId());
        await allocationRequest("prepare-version", { feeTypeId: config.feeTypeId, expectedRevision: config.draftRevision, requestId: versionRequests.current.get(key) });
        setNotice("Version préparée et confirmée. Elle n'est ni publiée ni active.");
      }
      setVersions(await loadAllocationVersions(config));
    } catch (cause) { setError(message(cause)); } finally { detailLock.current = false; setDetailBusy(false); setDetailAction(""); }
  }
  return <div className="grid min-w-0 gap-4" aria-label="Configuration préparatoire des répartitions">
    {configurable && <div role="tablist" aria-label="Onglets de la répartition" className="sticky top-0 z-20 -mt-1 grid grid-cols-2 border-b border-slate-200 bg-white pt-1">
      {([["annual", "Répartition annuelle"], ["sharing", "Partage répartition"]] as const).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key}
        className={`min-w-0 px-2 py-2 text-center text-sm ${tab === key ? "border-b-2 border-ink font-semibold text-ink" : "text-slate-600"}`} onClick={() => setTab(key)}>{label}</button>)}
    </div>}
    {configurable && tab === "sharing" && <SharingTab schoolId={workspaces[0].school.id} shares={sharing.shares} error={sharing.error} names={rubricNames} onChanged={sharing.setShares} />}
    {!(configurable && tab === "sharing") && <>
    {ready && user.role !== 'school_admin' && <p className="text-sm" role="status">{workspaces.map(w => `${multipleSchools ? w.school.name + ' : ' : ''}${w.ledger?.status === 'ACTIVE' ? 'Active' : 'En préparation'}`).join(' · ')}</p>}
    {user.role === "school_admin" && workspaces.length === 1 && ready && workspaces[0].canConfigure && <FeeAllocationActivation workspace={workspaces[0]} onChanged={() => void refresh("reload")}/>}
    {configurable && <RubricCatalogPanel schoolId={workspaces[0].school.id} onChanged={() => void refresh("reload")} order={rubricOrder} shares={sharing.shares} onSharesChanged={sharing.setShares} />}
    <div className="min-w-0 max-w-full pb-1" role="region" aria-label="Commandes de répartition">
      {/* Sur téléphone : deux colonnes, rien ne dépasse le bord droit ; sur ordinateur : une seule ligne. */}
      <div className={`grid min-w-0 grid-cols-2 items-center gap-2 ${configurable ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
        {configurable && <button type="button" className="primary-button min-h-11 min-w-0 justify-center whitespace-nowrap" disabled={!current} onClick={() => setEditor({ workspace: workspaces[0] })}>+ Ajouter</button>}
        <label className="min-w-0"><span className="sr-only">Filtre</span><select aria-label="Filtre" className="input h-11 w-full min-w-0" value={filter.kind} onChange={event => setFilter({ kind: event.target.value as AllocationFilter["kind"], value: event.target.value === "period" ? "year" : "", from: "", to: "" })}><option value="fee">Frais</option><option value="class">Classe</option><option value="period">Période</option></select></label>
        <label className="min-w-0"><span className="sr-only">Valeur du filtre</span><select aria-label="Valeur correspondante" className="input h-11 w-full min-w-0 truncate" value={filter.value} onChange={event => setFilter({ ...filter, value: event.target.value })}>{filter.kind === "period" ? periods.map(([value, label]) => <option key={value} value={value}>{label}</option>) : <><option value="">{filter.kind === "fee" ? "Tous les frais" : "Toutes les classes"}</option>{choices.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</>}</select></label>
        <Action busy={pdfBusy} disabled={!current || !hasConfiguration} className="secondary-button w-full min-w-0 justify-items-center" onClick={() => void exportPdf()}>PDF</Action>
      </div>
    </div>
    {filter.kind === "period" && <p className="text-xs text-slate-600">Prévu total de l’année active, indépendamment des dates sélectionnées. Encaissé sur la période : dates de comptabilisation. Le disponible cumule toutes les écritures jusqu’à sa fin, ouverture incluse.</p>}
    {filter.kind === "period" && filter.value === "custom" && <div className="flex flex-wrap gap-2"><label className="grid gap-1 text-sm">Du<input className="input" type="date" value={filter.from} onChange={(event) => setFilter({ ...filter, from: event.target.value })}/></label><label className="grid gap-1 text-sm">Au<input className="input" type="date" value={filter.to} onChange={(event) => setFilter({ ...filter, to: event.target.value })}/></label></div>}
    {ready && hasConfiguration && <details className="text-sm"><summary className="cursor-pointer">Comprendre les montants</summary><p>Le prévu total de l’année additionne les frais nets des élèves actifs concernés, réductions et exonérations comprises, même sans paiement. Chaque paiement d'un ancien élève y est ajouté du même montant qu'à l'encaissé. Les filtres Frais et Classe réduisent ce périmètre ; les dates filtrent uniquement les encaissements. Une prise en charge non réglée n’est pas un encaissement.</p><p>La situation globale reste commune à la rubrique, jamais propre à une classe ou à un frais. Solde disponible = ouverture + encaissements cumulés − dépenses nettes cumulées. Les dépenses nettes incluent les corrections et annulations compensatoires.</p></details>}
    {loading && <p role="status">Chargement...</p>}
    {checking && !loading && <p role="status" className="text-xs text-slate-600">Mise à jour… Les montants affichés sont en cours de vérification ; l'export attend la confirmation.</p>}
    {(error || projection.error) && <div role="alert" className="rounded border border-red-200 p-3 text-sm"><p>{error || projection.error}</p>{workspaces.length > 0 && <p>Les données conservées ne sont pas revérifiées. L'export et les modifications sont bloqués.</p>}<Action busy={loading} className="secondary-button mt-2" onClick={() => void refresh("reload")}>Réessayer la consultation</Action></div>}
    {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
    {/* Lot 27a : un paiement n'est jamais bloqué ; s'il n'a pas pu être réparti tout de suite, il attend ici. */}
    {ready && !staffView && workspaces.some(w => (w.pendingAllocations ?? 0) > 0) && <p role="status" className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{workspaces.reduce((n, w) => n + Math.max(0, w.pendingAllocations ?? 0), 0)} encaissement(s) enregistré(s) en attente de répartition. Ils ont bien été encaissés ; la répartition sera reprise automatiquement ou rapprochée par l'Administrateur.</p>}
    {ready && hasConfiguration && projection.rows.length > 0 && (staffView ? [["Rubriques partagées avec vous — ensemble", tables.three]] as const : [["Tableau 1 — Élèves normalement inscrits", tables.one], ["Tableau 2 — Cas sociaux et prises en charge", tables.two], ["Tableau 3 — Ensemble (tableaux 1 et 2 additionnés)", tables.three]] as const).map(([title, rows]) => <section key={title} data-allocation-table className="mt-6 grid min-w-0 gap-2 rounded border border-slate-200 bg-white p-3 first-of-type:mt-2 sm:p-4"><h3 className="text-sm font-bold text-ink">{title}</h3>{rows.length ? <div className="min-w-0 max-w-full overflow-x-auto"><table className={`w-full ${operational ? "min-w-[980px]" : "min-w-[600px]"} text-sm`} aria-label={title}><thead>
      <tr><th rowSpan={2} scope="col" className="border-b p-2 text-left">Rubrique</th><th colSpan={2} scope="colgroup" className="border-b p-2">Selon le filtre</th>{operational && <th colSpan={4} scope="colgroup" className="border-b border-l p-2">Situation globale de la rubrique à la fin de la période</th>}</tr>
      <tr>{["Prévu total de l’année", filter.kind === 'period' ? "Encaissé sur la période" : "Encaissé selon le filtre", ...(operational ? ["Ouverture", "Encaissements cumulés", "Dépenses nettes cumulées", "Solde disponible"] : [])].map(title => <th key={title} scope="col" className="border-b p-2 text-left">{title}</th>)}</tr>
    </thead><tbody>{rows.flatMap((row, index) => [...(row.arrearsYearName && row.arrearsYearName !== rows[index - 1]?.arrearsYearName ? [<tr key={`arrieres-${row.arrearsYearName}`} data-arrears-group><th colSpan={operational ? 7 : 3} scope="rowgroup" className="border-b bg-amber-50 p-2 text-left text-sm font-bold text-amber-900">Arriérés {row.arrearsYearName}</th></tr>] : []), <tr key={row.key}><td className="border-b p-2">{staffView ? <span className="font-medium">{row.rubricName}</span> : <button type="button" className="text-left text-blue-700 underline" onClick={() => { setDetail(row); setVersions(null); }}>{row.rubricName}{row.percentLabel ? ` (${row.percentLabel})` : ""}</button>}{row.percentDetail && <p className="text-xs text-slate-500">{row.percentDetail}</p>}<p className="text-xs text-slate-500">{multipleSchools ? row.schoolName + " · " + row.yearName + " · " + row.currency : ""}{!row.financial && ` · ${row.feeName} · ${row.classLabel} · v${row.config.draftRevision}`}</p>{row.financial && <p className="text-xs">Dont arriérés selon le filtre : {formatCurrencyMoney(row.financial.arrearsMinor / 100, row.currency)}</p>}{row.financial && row.financial.formerMinor !== 0 && <p className="text-xs">Dont anciens élèves (prévu et encaissé) : {formatCurrencyMoney(row.financial.formerMinor / 100, row.currency)}</p>}{row.stale && <p className="text-xs text-amber-800">Tarif ou cible modifié : brouillon à reprendre.</p>}</td><td className="border-b p-2 whitespace-nowrap">{formatCurrencyMoney(row.amountMinor / 100, row.currency)}</td>{(["receivedMinor", ...(operational ? ["openingMinor", "cumulativeReceivedMinor", "cumulativeSpentMinor", "availableMinor"] as const : [])] as const).map(field => <td key={field} className={`border-b p-2 text-xs whitespace-nowrap ${field === "openingMinor" ? "border-l" : ""}`}>{row.financial ? formatCurrencyMoney(row.financial[field] / 100, row.currency) : "Non disponible"}</td>)}</tr>])}</tbody><tfoot>{allocationTotals(rows).map(total => <tr key={total.currency} className="font-semibold"><td className="p-2">Total {total.currency}</td><td className="p-2 whitespace-nowrap">{formatCurrencyMoney(total.amountMinor / 100, total.currency)}</td>{(["receivedMinor", ...(operational ? ["openingMinor", "cumulativeReceivedMinor", "cumulativeSpentMinor", "availableMinor"] as const : [])] as const).map(field => { const value = allocationFinancialTotals(rows, field).find(t => t.currency === total.currency)?.value; return <td key={field} className="p-2 whitespace-nowrap">{value === null || value === undefined ? unavailableAllocation : formatCurrencyMoney(value / 100, total.currency)}</td>; })}</tr>)}</tfoot></table></div> : <p className="text-sm text-slate-500">Aucun montant dans ce tableau.</p>}</section>)}
    {ready && !workspaces.some(w => w.configs.length) && <p role="status">Aucune répartition configurée.{configurable ? ' Utilisez « + Ajouter » pour commencer.' : ''} Les opérations habituelles de l’établissement restent disponibles.</p>}
    {ready && hasConfiguration && !projection.rows.length && <p role="status">Aucun résultat pour ce filtre. Les autres répartitions sont conservées.</p>}
    </>}
    {detail && <AdminDrawer title={detail.rubricName} closeLabel="Fermer le détail de rubrique" onClose={() => setDetail(null)}>
      {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
      <dl className="grid gap-2 text-sm">{[["Établissement", detail.schoolName], ["Périmètre du prévu", filterLabel], ["Année", detail.yearName], ["Prévu total de l’année", formatCurrencyMoney(detail.amountMinor / 100, detail.currency)], ["Statut", detail.financial ? "Registre rapproché" : "Préparatoire — non actif"]].map(([label, value]) => <div key={label}><dt className="font-semibold">{label}</dt><dd className="break-words">{value}</dd></div>)}</dl>
      <p className="my-3 text-sm">{detail.financial ? "Les montants proviennent du registre rapproché. Le disponible est commun à cette rubrique dans l'établissement ; aucune attribution artificielle à un frais ou à une classe." : "Aucun mouvement financier ni historique d'encaissement n'est créé par ce brouillon. Les références d'origine restent conservées pour les phases suivantes."}</p>
      {detailConfigs.map(config => <section key={config.id} className="my-3 rounded border p-3"><h3 className="mb-2 text-sm font-semibold">{detailWorkspace?.fees.find(f => f.id === config.feeTypeId)?.name ?? 'Frais'} · {allocationClassLabel(config.classOptionKey || config.className)}</h3><div className="flex flex-wrap gap-2"><Action busy={detailBusy && detailAction === "versions"} disabled={detailBusy} onClick={() => void showVersions(config)}>Consulter les versions</Action>{config.currentVersionId && <button type="button" className="secondary-button" onClick={() => setSocialPart(config)}>Partie 2 — cas sociaux{config.socialVersionId ? " (publiée)" : ""}</button>}{configurable && !config.currentVersionId && <><button type="button" className="secondary-button" disabled={!ready} onClick={() => { setEditor({ workspace: workspaces[0], config }); setDetail(null); }}>Reprendre le brouillon</button><Action busy={detailBusy && detailAction === "prepare"} disabled={!ready || detailBusy} onClick={() => void showVersions(config, true)}>Préparer une version</Action></>}</div></section>)}
      {detailBusy && <p role="status">Vérification serveur…</p>}{versions && <ul className="mt-3 grid gap-2">{versions.map((version) => <li key={version.id} className="rounded border p-2 text-sm">Version {version.version} · {version.status} · {version.createdAt.slice(0, 10)} · {version.currency}<ul>{version.rubrics.map((rubric) => <li key={rubric.id}>{rubric.name} : {rubric.mode === "fixed" ? formatCurrencyMoney((rubric.fixedMinor ?? 0) / 100, version.currency) : `${(rubric.basisPoints ?? 0) / 100} %`}</li>)}</ul></li>)}{!versions.length && <li>Aucune version préparée.</li>}</ul>}
    </AdminDrawer>}
    {socialPart && <SocialPartEditor config={socialPart} feeName={detailWorkspace?.fees.find(f => f.id === socialPart.feeTypeId)?.name ?? 'Frais'}
      classLabel={allocationClassLabel(socialPart.classOptionKey || socialPart.className)} currency={socialPart.currency}
      canPublish={configurable && current} onClose={() => setSocialPart(null)} onPublished={() => void refresh("reload")} />}
    {editor && <AllocationEditor workspace={editor.workspace} config={editor.config} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setNotice("Brouillons enregistrés et confirmés par le serveur. Aucune activation financière."); void refresh("reload"); }} />}
  </div>;
}

type RubricInput = { id: string; name: string; mode: "percent" | "fixed"; value: string };
function AllocationEditor({ workspace, config, onClose, onSaved }: { workspace: AllocationWorkspace; config?: FeeAllocationConfig; onClose: () => void; onSaved: () => void }) {
  const [feeId, setFeeId] = useState(config?.feeTypeId ?? "");
  const [selected, setSelected] = useState<string[]>(config ? [config.feeTypeId] : []);
  const [rubrics, setRubrics] = useState<RubricInput[]>(config?.draft?.rubrics.map((rubric) => ({ id: rubric.id, name: rubric.name, mode: rubric.mode, value: String((rubric.mode === "fixed" ? rubric.fixedMinor ?? 0 : rubric.basisPoints ?? 0) / 100) })) ?? [{ id: "", name: "", mode: "percent", value: "" }]);
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState("");
  // Lot 27b : rubriques de l'école et de l'année (liste déroulante, « + Nouvelle rubrique… »).
  const [catalog, setCatalog] = useState<AllocationCatalogRubric[] | null>(null);
  const [newName, setNewName] = useState<{ index: number; value: string } | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void loadRubricCatalog(workspace.school.id, controller.signal).then((result) => setCatalog(result.rubrics)).catch((cause) => { if (!controller.signal.aborted) setError(message(cause)); });
    return () => controller.abort();
  }, [workspace.school.id]);
  const request = useRef<SaveAllocationDrafts | null>(null);
  const locked = useRef(false);
  const eligibleFees = workspace.fees.filter(f => !workspace.ledger || !workspace.configs.some(c => c.feeTypeId === f.id && c.currentVersionId));
  const base = eligibleFees.find((fee) => fee.id === feeId);
  const sameName = (name: string) => name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");
  const targets = eligibleFees.filter((fee) => base && sameName(fee.name) === sameName(base.name));
  const preview = useMemo(() => {
    try {
      if (!base || !selected.length) throw new Error("Choisissez un frais et au moins une classe.");
      const normalized: FeeAllocationRubric[] = rubrics.map((rubric) => {
        if (!rubric.id) throw new Error("Choisissez chaque rubrique dans la liste.");
        if (!/^[0-9]+(?:[.,][0-9]{1,2})?$/.test(rubric.value.trim())) throw new Error("Renseignez une valeur positive avec au maximum deux décimales.");
        const amount = Number(rubric.value.replace(",", "."));
        return { id: rubric.id, name: rubric.name, mode: rubric.mode, ...(rubric.mode === "fixed" ? { fixedMinor: toMoneyMinor(amount) } : { basisPoints: toMoneyMinor(amount) }) };
      });
      const rows = targets.filter((fee) => selected.includes(fee.id)).map((fee) => ({ fee, ...validateFeeAllocationRubrics(normalized, toMoneyMinor(fee.amount)) }));
      if (rows.length !== selected.length) throw new Error("Une classe sélectionnée n'est plus disponible.");
      return { rows, rubrics: normalized, error: "" };
    } catch (cause) { return { rows: [], rubrics: [], error: message(cause) }; }
  }, [base, selected, rubrics, targets]);
  // Lot « Deux onglets » (décision du 17/11) : une rubrique créée ici n'est enregistrée qu'avec la répartition.
  // Si la ligne est retirée ou le formulaire annulé avant, elle n'est jamais créée.
  const pendingNames = useRef(new Map<string, string>()), created = useRef(new Map<string, string>());
  async function createNamed(index: number) {
    const name = newName?.value.normalize("NFKC").trim().replace(/\s+/g, " ") ?? "";
    if (!name || creating) return;
    const key = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");
    if (key(name) === key("Non affecté")) { setError("« Non affecté » est réservé : choisissez un autre nom."); return; }
    if ((catalog ?? []).some((item) => key(item.name) === key(name))) { setError("Une rubrique porte déjà ce nom : choisissez-la dans la liste."); return; }
    setError("");
    const temporary = newId();
    pendingNames.current.set(temporary, name);
    setCatalog((items) => [...(items ?? []), { id: temporary, name, hidden: false }].sort((a, b) => a.name.localeCompare(b.name, "fr")));
    update(index, { id: temporary, name });
    // Ne ferme que le champ de cette ligne : si une autre ligne a ouvert « + Nouvelle rubrique… » entre-temps, son champ reste ouvert.
    setNewName((current) => current?.index === index ? null : current);
  }
  const update = (index: number, changes: Partial<RubricInput>) => setRubrics((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...changes } : row));
  const save = useCallback(async () => {
    if (locked.current || (!request.current && preview.error)) return;
    locked.current = true; setBusy(true); setError("");
    try {
      if (!request.current) {
        // Les nouvelles rubriques utilisées sont créées maintenant, une seule fois chacune, juste avant l'enregistrement.
        setCreating(true);
        for (const rubric of preview.rubrics) {
          const name = pendingNames.current.get(rubric.id);
          if (name && !created.current.has(rubric.id)) created.current.set(rubric.id, (await createRubric(workspace.school.id, name)).rubric.id);
        }
        request.current = { schoolYearId: workspace.year.id, baseFeeTypeId: feeId, requestId: newId(),
          rubrics: preview.rubrics.map((rubric) => ({ ...rubric, id: created.current.get(rubric.id) ?? rubric.id })),
          targets: selected.map((id) => ({ feeTypeId: id, expectedRevision: workspace.configs.find((item) => item.feeTypeId === id)?.draftRevision ?? 0 })) };
      }
      await saveAllocationDrafts(request.current); request.current = null; onSaved();
    }
    catch (cause) { const pending = !(cause instanceof AllocationApiError && cause.confirmedRejection); setUncertain(pending); if (!pending) request.current = null; setError(message(cause)); }
    finally { locked.current = false; setBusy(false); setCreating(false); }
  }, [preview, workspace, feeId, selected, onSaved]);
  return <AdminDrawer title={config ? "Reprendre le brouillon" : "Ajouter une répartition"} closeLabel="Fermer la configuration" width="wide" onClose={() => { if (!busy) onClose(); }}>
    <p className="mb-3 text-sm">{workspace.school.name} · {workspace.year.name} · {workspace.currency}. Enregistrement préparatoire uniquement.</p>
    <fieldset disabled={busy || uncertain} className="grid gap-3">
      <label className="grid gap-1 text-sm">Frais existant<select aria-label="Frais existant" className="input" value={feeId} onChange={(event) => { setFeeId(event.target.value); setSelected(event.target.value ? [event.target.value] : []); }}><option value="">Choisir un frais exact</option>{eligibleFees.map((fee) => <option key={fee.id} value={fee.id}>{fee.name} · {allocationClassLabel(fee.classOptionKey || fee.className)} · {formatCurrencyMoney(fee.amount, workspace.currency)}</option>)}</select></label>
      <div><b className="text-sm">Classes concernées</b><label className="my-2 flex gap-2 text-sm"><input type="checkbox" checked={targets.length > 0 && selected.length === targets.length} onChange={(event) => setSelected(event.target.checked ? targets.map((fee) => fee.id) : [])}/>Toutes les classes concernées</label>{targets.map((fee) => <label key={fee.id} className="flex gap-2 py-1 text-sm"><input type="checkbox" checked={selected.includes(fee.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, fee.id] : selected.filter((id) => id !== fee.id))}/>{allocationClassLabel(fee.classOptionKey || fee.className)} · {formatCurrencyMoney(fee.amount, workspace.currency)}</label>)}</div>
      {selected.some((id) => workspace.configs.some((item) => item.feeTypeId === id && item.draft)) && <p className="text-sm text-amber-800">Les brouillons des classes sélectionnées seront remplacés après vérification de leur révision. Les autres classes et les versions historiques restent inchangées.</p>}
      {rubrics.map((rubric, index) => <div key={`ligne-${index}`} className="grid gap-2 rounded border p-3 sm:grid-cols-4"><label className="grid gap-1 text-sm">Rubrique {index + 1}<select className="input" aria-label={`Rubrique ${index + 1}`} value={newName?.index === index ? "__new__" : rubric.id} onChange={(event) => {
          if (event.target.value === "__new__") { setNewName({ index, value: "" }); return; }
          const entry = catalog?.find((item) => item.id === event.target.value); setNewName(null); update(index, { id: entry?.id ?? "", name: entry?.name ?? "" });
        }}><option value="">{catalog ? "Choisir une rubrique" : "Chargement…"}</option>{(catalog ?? []).filter((item) => (!item.hidden || item.id === rubric.id) && (item.id === rubric.id || !rubrics.some((row) => row.id === item.id))).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}{!catalog?.some((item) => item.id === rubric.id) && rubric.id && <option value={rubric.id}>{rubric.name}</option>}<option value="__new__">+ Nouvelle rubrique…</option></select>
        {newName?.index === index && <span className="flex gap-2"><input className="input" maxLength={80} placeholder="Nom de la nouvelle rubrique" aria-label="Nom de la nouvelle rubrique" value={newName.value} onChange={(event) => setNewName({ index, value: event.target.value })}/><button type="button" className="secondary-button" disabled={creating || !newName.value.trim()} onClick={() => void createNamed(index)}>Ajouter à la liste</button></span>}</label><label className="grid gap-1 text-sm">Mode<select className="input" value={rubric.mode} onChange={(event) => update(index, { mode: event.target.value as RubricInput["mode"] })}><option value="percent">Pourcentage</option><option value="fixed">Montant fixe</option></select></label><label className="grid gap-1 text-sm">{rubric.mode === "percent" ? "Pourcentage (%)" : `Montant (${workspace.currency})`}<input className="input" inputMode="decimal" value={rubric.value} onChange={(event) => update(index, { value: event.target.value })}/></label><button type="button" className="secondary-button self-end" disabled={rubrics.length === 1} onClick={() => { setNewName(null); setRubrics((rows) => rows.filter((_, rowIndex) => rowIndex !== index)); }}>Retirer la ligne</button></div>)}
      <button type="button" className="secondary-button" disabled={rubrics.length >= 40} onClick={() => setRubrics((rows) => [...rows, { id: "", name: "", mode: "percent", value: "" }])}>+ Ajouter une ligne</button>
    </fieldset>
    <h3 className="mt-4 font-bold">Aperçu par classe</h3>{preview.error && <p role="status" className="text-sm text-amber-800">{preview.error}</p>}
    {preview.rows.map((row) => <section key={row.fee.id} className="my-2 rounded border p-3 text-sm"><h4 className="font-semibold">{allocationClassLabel(row.fee.classOptionKey || row.fee.className)} · {formatCurrencyMoney(row.fee.amount, workspace.currency)}</h4><ul>{row.shares.map((share) => <li key={share.rubricId}>{row.rubrics.find((rubric) => rubric.id === share.rubricId)?.name ?? "Non affecté"} : {formatCurrencyMoney(share.amountMinor / 100, workspace.currency)} · {(share.amountMinor / toMoneyMinor(row.fee.amount) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %</li>)}</ul></section>)}
    {error && <p role="alert" className="my-3 text-sm text-red-700">{error}</p>}{uncertain && <p className="my-2 text-sm">L'enregistrement a peut-être abouti. La vérification renvoie exactement la même demande, sans nouvelle répartition.</p>}
    <div className="mt-4 flex flex-wrap gap-2"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Annuler</button><Action className="primary-button" busy={busy} disabled={!uncertain && !!preview.error} onClick={() => void save()}>{uncertain ? "Vérifier la même demande" : "Enregistrer la répartition"}</Action></div>
  </AdminDrawer>;
}
