import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Banknote } from "lucide-react";
import { AdminDrawer } from "../../components/ui";
import type { AppUser, School } from "../../types";
import type { FeeAllocationConfig, FeeAllocationRubric, FeeAllocationVersion } from "../../types/feeAllocation";
import { AllocationApiError, allocationRequest, loadAllocationVersions, loadAllocationWorkspace, saveAllocationDrafts, type AllocationWorkspace, type SaveAllocationDrafts } from "../../services/feeAllocation";
import { validateFeeAllocationRubrics } from "../../../api/_lib/feeAllocationMath.js";
import { allocationClassKey, allocationClassLabel, allocationFeeKey, allocationTotals, projectAllocations, unavailableAllocation, type AllocationFilter, type AllocationRow } from "../../utils/feeAllocationView";
import { formatCurrencyMoney } from "../../utils/currency";
import { toMoneyMinor } from "../../utils/money";
import { renderAcadPdfPreview } from "../../utils/pdf";
import { feeAllocationPdfSections } from "../../utils/feeAllocationPdf";

const roles = new Set(["school_admin", "cashier", "coordination_admin", "sub_coordination_admin"]);
const newId = () => crypto.randomUUID().replaceAll("-", "");
const message = (cause: unknown) => cause instanceof Error ? cause.message : "Répartition indisponible.";
type Props = { user: AppUser; schools: School[]; selectedSchoolId?: string; onSchoolChange?: (id: string) => void; institution?: School };
export function FeeAllocationEntry({ user, schools, selectedSchoolId = "", onSchoolChange, institution }: Props) {
  const [open, setOpen] = useState(false);
  if (!roles.has(user.role)) return null;
  const selected = schools.filter((school) => !selectedSchoolId || school.id === selectedSchoolId);
  return <>
    <button type="button" className="min-w-0 rounded border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-mint" onClick={() => setOpen(true)}>
      <span className="flex items-center gap-3 font-bold text-ink"><Banknote className="h-5 w-5 shrink-0" />Répartition des frais</span>
    </button>
    {open && <AdminDrawer title="Répartition des frais" closeLabel="Fermer Répartition des frais" width="wide" onClose={() => setOpen(false)}
      toolbar={onSchoolChange && <label className="grid gap-1 text-sm">Établissement<select className="input" value={selectedSchoolId} onChange={(event) => onSchoolChange(event.target.value)}><option value="">Toutes les écoles autorisées</option>{schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label>}>
      <FeeAllocationContent key={`${user.id}:${selected.map((school) => school.id).sort().join("|")}`} user={user} schools={selected} institution={institution} />
    </AdminDrawer>}
  </>;
}

export function FeeAllocationContent({ user, schools, institution }: Pick<Props, "user" | "schools" | "institution">) {
  const ids = schools.map((school) => school.id).sort().join("|");
  const [workspaces, setWorkspaces] = useState<AllocationWorkspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const [filter, setFilter] = useState<AllocationFilter>({ kind: "fee", value: "", from: "", to: "" });
  const [editor, setEditor] = useState<{ workspace: AllocationWorkspace; config?: FeeAllocationConfig } | null>(null);
  const [detail, setDetail] = useState<AllocationRow | null>(null);
  const [versions, setVersions] = useState<FeeAllocationVersion[] | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const versionRequests = useRef(new Map<string, string>());
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    const load = async () => {
      const results: AllocationWorkspace[] = [];
      const schoolIds = ids ? ids.split("|") : [];
      for (let index = 0; index < schoolIds.length; index += 4) {
        results.push(...await Promise.all(schoolIds.slice(index, index + 4).map((id) => loadAllocationWorkspace(id, controller.signal))));
      }
      if (!controller.signal.aborted) setWorkspaces(results);
    };
    void load().catch((cause) => { if (!controller.signal.aborted) setError(message(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [ids, reload]);
  const projection = useMemo(() => {
    try { const rows = projectAllocations(workspaces, filter); return { rows, totals: allocationTotals(rows), error: "" }; }
    catch (cause) { return { rows: [], totals: [], error: message(cause) }; }
  }, [workspaces, filter]);
  const ready = !loading && !error && !projection.error && workspaces.length > 0;
  const configurable = user.role === "school_admin" && workspaces.length === 1 && workspaces[0].canConfigure;
  const choices = useMemo(() => {
    const pairs = workspaces.flatMap((workspace) => workspace.fees.map((fee) => filter.kind === "class"
      ? [allocationClassKey(workspace.school.id, fee.classOptionKey || fee.className), `${workspace.school.name} · ${allocationClassLabel(fee.classOptionKey || fee.className)}`]
      : [allocationFeeKey(workspace.school.id, fee.id), `${workspace.school.name} · ${fee.name} · ${allocationClassLabel(fee.classOptionKey || fee.className)}`]));
    return [...new Map(pairs.map(([value, label]) => [value, label]))];
  }, [workspaces, filter.kind]);
  const periods = [["today", "Aujourd'hui"], ["week", "Cette semaine"], ["month", "Ce mois"], ["year", "Cette année scolaire"], ["custom", "Dates personnalisées"]];
  const filterLabel = `${filter.kind === "fee" ? "Frais" : filter.kind === "class" ? "Classe" : "Période de préparation"} : ${filter.kind === "period"
    ? `${periods.find(([value]) => value === filter.value)?.[1] ?? "Cette année scolaire"}${filter.value === "custom" ? ` (${filter.from} au ${filter.to})` : ""}`
    : choices.find(([value]) => value === filter.value)?.[1] ?? (filter.kind === "fee" ? "Tous les frais" : "Toutes les classes")}`;
  async function exportPdf() {
    if (!ready || pdfBusy) return;
    setPdfBusy(true); setError("");
    try {
      const school = institution ?? schools[0];
      if (!school) throw new Error("Établissement indisponible.");
      await renderAcadPdfPreview({ filename: "repartition-frais-preparatoire.pdf", title: "Répartition des frais", school,
        subtitle: "Configuration préparatoire — aucune disponibilité financière", throwOnError: true,
        sections: feeAllocationPdfSections(projection.rows, filterLabel, workspaces.map((item) => `${item.school.name} · ${item.year.name} · ${item.currency}`).join(" ; ")) });
    } catch (cause) { setError(message(cause)); } finally { setPdfBusy(false); }
  }
  async function showVersions(config: FeeAllocationConfig, prepare = false) {
    if (detailBusy) return;
    setDetailBusy(true); setError("");
    try {
      if (prepare) {
        const key = `${config.id}/${config.draftRevision}`;
        if (!versionRequests.current.has(key)) versionRequests.current.set(key, newId());
        await allocationRequest("prepare-version", { feeTypeId: config.feeTypeId, expectedRevision: config.draftRevision, requestId: versionRequests.current.get(key) });
        setNotice("Version préparée et confirmée. Elle n'est ni publiée ni active.");
      }
      setVersions(await loadAllocationVersions(config));
    } catch (cause) { setError(message(cause)); } finally { setDetailBusy(false); }
  }
  return <div className="grid min-w-0 gap-4" aria-label="Configuration préparatoire des répartitions">
    <div className="flex flex-wrap items-end gap-2" aria-label="Commandes de répartition">
      {configurable && <button type="button" className="primary-button" disabled={!ready} onClick={() => setEditor({ workspace: workspaces[0] })}>+ Ajouter</button>}
      <label className="grid min-w-0 gap-1 text-sm">Filtre<select aria-label="Filtre" className="input" value={filter.kind} onChange={(event) => setFilter({ kind: event.target.value as AllocationFilter["kind"], value: event.target.value === "period" ? "year" : "", from: "", to: "" })}><option value="fee">Frais</option><option value="class">Classe</option><option value="period">Période</option></select></label>
      <label className="grid min-w-0 max-w-full gap-1 text-sm">Valeur correspondante<select aria-label="Valeur correspondante" className="input min-w-0 max-w-full" value={filter.value} onChange={(event) => setFilter({ ...filter, value: event.target.value })}>{filter.kind === "period" ? periods.map(([value, label]) => <option key={value} value={value}>{label}</option>) : <><option value="">{filter.kind === "fee" ? "Tous les frais" : "Toutes les classes"}</option>{choices.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</>}</select></label>
      <button type="button" className="secondary-button" disabled={!ready || pdfBusy} onClick={() => void exportPdf()}>{pdfBusy ? "Export en cours…" : "Exporter PDF"}</button>
    </div>
    {filter.kind === "period" && <p className="text-xs text-slate-600">La période filtre les dates de préparation des brouillons, pas des encaissements. Aucun flux financier n'est encore ventilé.</p>}
    {filter.kind === "period" && filter.value === "custom" && <div className="flex flex-wrap gap-2"><label className="grid gap-1 text-sm">Du<input className="input" type="date" value={filter.from} onChange={(event) => setFilter({ ...filter, from: event.target.value })}/></label><label className="grid gap-1 text-sm">Au<input className="input" type="date" value={filter.to} onChange={(event) => setFilter({ ...filter, to: event.target.value })}/></label></div>}
    <p className="text-sm text-slate-600">{workspaces.map((workspace) => `${workspace.school.name} · ${workspace.year.name} · ${workspace.currency}`).join(" ; ")}</p>
    <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">Préparatoire uniquement. « Prévu » représente un tarif de référence par classe configurée, sans effectifs ni réductions individuelles. Ce n'est ni une créance totale ni de l'argent disponible.</p>
    {loading && <p role="status">Chargement des répartitions autorisées…</p>}
    {(error || projection.error) && <div role="alert" className="rounded border border-red-200 p-3 text-sm"><p>{error || projection.error}</p>{workspaces.length > 0 && <p>Les données conservées ne sont pas revérifiées. L'export et les modifications sont bloqués.</p>}<button type="button" disabled={loading} className="secondary-button mt-2" onClick={() => setReload((value) => value + 1)}>Réessayer la consultation</button></div>}
    {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
    <div className="grid gap-2 rounded border bg-slate-50 p-3 sm:grid-cols-4" aria-label="Synthèse des répartitions">
      <div><b>Prévu</b><div>{projection.totals.length ? projection.totals.map((total) => <p key={total.currency}>{formatCurrencyMoney(total.amountMinor / 100, total.currency)}</p>) : "Aucune configuration dans cette vue"}</div></div>
      {["Encaissé", "Dépensé", "Disponible"].map((label) => <div key={label}><b>{label}</b><p className="text-xs">{unavailableAllocation}</p></div>)}
    </div>
    <h3 className="font-bold">Situation des répartitions</h3>
    <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-sm"><thead><tr>{["Rubrique", "Prévu", "Encaissé", "Dépensé", "Disponible"].map((title) => <th key={title} className="border-b p-2 text-left">{title}</th>)}</tr></thead><tbody>{projection.rows.map((row) => <tr key={row.key}><td className="border-b p-2"><button type="button" className="text-left text-blue-700 underline" onClick={() => { setDetail(row); setVersions(null); }}>{row.rubricName}</button><p className="text-xs text-slate-500">{row.schoolName} · {row.feeName} · {row.classLabel} · v{row.config.draftRevision}</p>{row.stale && <p className="text-xs text-amber-800">Tarif ou cible modifié : brouillon à reprendre.</p>}</td><td className="border-b p-2 whitespace-nowrap">{formatCurrencyMoney(row.amountMinor / 100, row.currency)}</td>{[0, 1, 2].map((value) => <td key={value} className="border-b p-2 text-xs">Non disponible</td>)}</tr>)}</tbody></table></div>
    {!loading && !projection.rows.length && <p>Aucune répartition préparée pour ce filtre.</p>}
    {detail && <AdminDrawer title={detail.rubricName} closeLabel="Fermer le détail de rubrique" onClose={() => setDetail(null)}>
      {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
      <dl className="grid gap-2 text-sm">{[["Établissement", detail.schoolName], ["Frais", `${detail.feeName} (${detail.config.feeTypeId})`], ["Classe", detail.classLabel], ["Année", detail.yearName], ["Version", `Brouillon ${detail.config.draftRevision}`], ["Mode", detail.rubric?.mode === "fixed" ? "Montant fixe" : detail.rubric ? "Pourcentage" : "Reliquat automatique"], ["Valeur", detail.rubric?.mode === "fixed" ? formatCurrencyMoney((detail.rubric.fixedMinor ?? 0) / 100, detail.currency) : detail.rubric ? `${(detail.rubric.basisPoints ?? 0) / 100} %` : "Non affecté"], ["Prévu", `${formatCurrencyMoney(detail.amountMinor / 100, detail.currency)} (${detail.percent.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %)`], ["Statut", "Préparatoire — non actif"]].map(([label, value]) => <div key={label}><dt className="font-semibold">{label}</dt><dd className="break-words">{value}</dd></div>)}</dl>
      <p className="my-3 text-sm">Aucun mouvement financier ni historique d'encaissement n'est créé par ce brouillon. Les références d'origine restent conservées pour les phases suivantes.</p>
      <div className="flex flex-wrap gap-2"><button className="secondary-button" type="button" disabled={detailBusy} onClick={() => void showVersions(detail.config)}>Consulter les versions</button>{configurable && <><button type="button" className="secondary-button" disabled={!ready} onClick={() => { setEditor({ workspace: workspaces[0], config: detail.config }); setDetail(null); }}>Reprendre le brouillon</button><button type="button" className="secondary-button" disabled={!ready || detailBusy || detail.stale} onClick={() => void showVersions(detail.config, true)}>Préparer une version</button></>}</div>
      {detailBusy && <p role="status">Vérification serveur…</p>}{versions && <ul className="mt-3 grid gap-2">{versions.map((version) => <li key={version.id} className="rounded border p-2 text-sm">Version {version.version} · {version.status} · {version.createdAt.slice(0, 10)} · {version.currency}<ul>{version.rubrics.map((rubric) => <li key={rubric.id}>{rubric.name} : {rubric.mode === "fixed" ? formatCurrencyMoney((rubric.fixedMinor ?? 0) / 100, version.currency) : `${(rubric.basisPoints ?? 0) / 100} %`}</li>)}</ul></li>)}{!versions.length && <li>Aucune version préparée.</li>}</ul>}
    </AdminDrawer>}
    {editor && <AllocationEditor workspace={editor.workspace} config={editor.config} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setNotice("Brouillons enregistrés et confirmés par le serveur. Aucune activation financière."); setReload((value) => value + 1); }} />}
  </div>;
}

type RubricInput = { id: string; name: string; mode: "percent" | "fixed"; value: string };
function AllocationEditor({ workspace, config, onClose, onSaved }: { workspace: AllocationWorkspace; config?: FeeAllocationConfig; onClose: () => void; onSaved: () => void }) {
  const [feeId, setFeeId] = useState(config?.feeTypeId ?? "");
  const [selected, setSelected] = useState<string[]>(config ? [config.feeTypeId] : []);
  const [rubrics, setRubrics] = useState<RubricInput[]>(config?.draft?.rubrics.map((rubric) => ({ id: rubric.id, name: rubric.name, mode: rubric.mode, value: String((rubric.mode === "fixed" ? rubric.fixedMinor ?? 0 : rubric.basisPoints ?? 0) / 100) })) ?? [{ id: newId(), name: "", mode: "percent", value: "" }]);
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState("");
  const request = useRef<SaveAllocationDrafts | null>(null);
  const locked = useRef(false);
  const base = workspace.fees.find((fee) => fee.id === feeId);
  const sameName = (name: string) => name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");
  const targets = workspace.fees.filter((fee) => base && sameName(fee.name) === sameName(base.name));
  const preview = useMemo(() => {
    try {
      if (!base || !selected.length) throw new Error("Choisissez un frais et au moins une classe.");
      const normalized: FeeAllocationRubric[] = rubrics.map((rubric) => {
        if (!/^[0-9]+(?:[.,][0-9]{1,2})?$/.test(rubric.value.trim())) throw new Error("Renseignez une valeur positive avec au maximum deux décimales.");
        const amount = Number(rubric.value.replace(",", "."));
        return { id: rubric.id, name: rubric.name, mode: rubric.mode, ...(rubric.mode === "fixed" ? { fixedMinor: toMoneyMinor(amount) } : { basisPoints: toMoneyMinor(amount) }) };
      });
      const rows = targets.filter((fee) => selected.includes(fee.id)).map((fee) => ({ fee, ...validateFeeAllocationRubrics(normalized, toMoneyMinor(fee.amount)) }));
      if (rows.length !== selected.length) throw new Error("Une classe sélectionnée n'est plus disponible.");
      return { rows, rubrics: normalized, error: "" };
    } catch (cause) { return { rows: [], rubrics: [], error: message(cause) }; }
  }, [base, selected, rubrics, targets]);
  const update = (index: number, changes: Partial<RubricInput>) => setRubrics((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...changes } : row));
  const save = useCallback(async () => {
    if (locked.current || (!request.current && preview.error)) return;
    locked.current = true; setBusy(true); setError("");
    if (!request.current) request.current = { schoolYearId: workspace.year.id, baseFeeTypeId: feeId, requestId: newId(), rubrics: preview.rubrics,
      targets: selected.map((id) => ({ feeTypeId: id, expectedRevision: workspace.configs.find((item) => item.feeTypeId === id)?.draftRevision ?? 0 })) };
    try { await saveAllocationDrafts(request.current); request.current = null; onSaved(); }
    catch (cause) { const pending = !(cause instanceof AllocationApiError && cause.confirmedRejection); setUncertain(pending); if (!pending) request.current = null; setError(message(cause)); }
    finally { locked.current = false; setBusy(false); }
  }, [preview, workspace, feeId, selected, onSaved]);
  return <AdminDrawer title={config ? "Reprendre le brouillon" : "Ajouter une répartition"} closeLabel="Fermer la configuration" width="wide" onClose={() => { if (!busy) onClose(); }}>
    <p className="mb-3 text-sm">{workspace.school.name} · {workspace.year.name} · {workspace.currency}. Enregistrement préparatoire uniquement.</p>
    <fieldset disabled={busy || uncertain} className="grid gap-3">
      <label className="grid gap-1 text-sm">Frais existant<select aria-label="Frais existant" className="input" value={feeId} onChange={(event) => { setFeeId(event.target.value); setSelected(event.target.value ? [event.target.value] : []); }}><option value="">Choisir un frais exact</option>{workspace.fees.map((fee) => <option key={fee.id} value={fee.id}>{fee.name} · {allocationClassLabel(fee.classOptionKey || fee.className)} · {formatCurrencyMoney(fee.amount, workspace.currency)}</option>)}</select></label>
      <div><b className="text-sm">Classes concernées</b><label className="my-2 flex gap-2 text-sm"><input type="checkbox" checked={targets.length > 0 && selected.length === targets.length} onChange={(event) => setSelected(event.target.checked ? targets.map((fee) => fee.id) : [])}/>Toutes les classes concernées</label>{targets.map((fee) => <label key={fee.id} className="flex gap-2 py-1 text-sm"><input type="checkbox" checked={selected.includes(fee.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, fee.id] : selected.filter((id) => id !== fee.id))}/>{allocationClassLabel(fee.classOptionKey || fee.className)} · {formatCurrencyMoney(fee.amount, workspace.currency)}</label>)}</div>
      {selected.some((id) => workspace.configs.some((item) => item.feeTypeId === id && item.draft)) && <p className="text-sm text-amber-800">Les brouillons des classes sélectionnées seront remplacés après vérification de leur révision. Les autres classes et les versions historiques restent inchangées.</p>}
      {rubrics.map((rubric, index) => <div key={rubric.id} className="grid gap-2 rounded border p-3 sm:grid-cols-4"><label className="grid gap-1 text-sm">Nom de la rubrique {index + 1}<input className="input" maxLength={80} value={rubric.name} onChange={(event) => update(index, { name: event.target.value })}/></label><label className="grid gap-1 text-sm">Mode<select className="input" value={rubric.mode} onChange={(event) => update(index, { mode: event.target.value as RubricInput["mode"] })}><option value="percent">Pourcentage</option><option value="fixed">Montant fixe</option></select></label><label className="grid gap-1 text-sm">{rubric.mode === "percent" ? "Pourcentage (%)" : `Montant (${workspace.currency})`}<input className="input" inputMode="decimal" value={rubric.value} onChange={(event) => update(index, { value: event.target.value })}/></label><button type="button" className="secondary-button self-end" disabled={rubrics.length === 1} onClick={() => setRubrics((rows) => rows.filter((row) => row.id !== rubric.id))}>Retirer la rubrique</button></div>)}
      <button type="button" className="secondary-button" disabled={rubrics.length >= 40} onClick={() => setRubrics((rows) => [...rows, { id: newId(), name: "", mode: "percent", value: "" }])}>+ Ajouter une rubrique</button>
    </fieldset>
    <h3 className="mt-4 font-bold">Aperçu par classe</h3>{preview.error && <p role="status" className="text-sm text-amber-800">{preview.error}</p>}
    {preview.rows.map((row) => <section key={row.fee.id} className="my-2 rounded border p-3 text-sm"><h4 className="font-semibold">{allocationClassLabel(row.fee.classOptionKey || row.fee.className)} · {formatCurrencyMoney(row.fee.amount, workspace.currency)}</h4><ul>{row.shares.map((share) => <li key={share.rubricId}>{row.rubrics.find((rubric) => rubric.id === share.rubricId)?.name ?? "Non affecté"} : {formatCurrencyMoney(share.amountMinor / 100, workspace.currency)} · {(share.amountMinor / toMoneyMinor(row.fee.amount) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %</li>)}</ul></section>)}
    {error && <p role="alert" className="my-3 text-sm text-red-700">{error}</p>}{uncertain && <p className="my-2 text-sm">L'enregistrement a peut-être abouti. La vérification renvoie exactement la même demande, sans nouvelle répartition.</p>}
    <div className="mt-4 flex flex-wrap gap-2"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Annuler</button><button type="button" className="primary-button" disabled={busy || (!uncertain && !!preview.error)} onClick={() => void save()}>{busy ? "Confirmation serveur…" : uncertain ? "Vérifier la même demande" : "Enregistrer la répartition"}</button></div>
  </AdminDrawer>;
}
