import { useEffect, useRef, useState } from "react";
import { AllocationApiError, allocationRequest, loadAllocationActivation, type AllocationActivationView, type AllocationWorkspace } from "../../services/feeAllocation";
import { formatCurrencyMoney } from "../../utils/currency";
import { toMoneyMinor } from "../../utils/money";

const errorText = (e: unknown) => e instanceof Error ? e.message : "Confirmation serveur indisponible.";
const parseAmount = (value: string) => {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value.trim())) throw new Error("Indiquez un montant positif avec deux décimales au maximum.");
  return toMoneyMinor(Number(value.replace(",", ".")));
};

/** The UI never invents an opening allocation or treats an uncertain reply as success. */
export function FeeAllocationActivation({ workspace, onChanged }: { workspace: AllocationWorkspace; onChanged: () => void }) {
  const [view, setView] = useState<AllocationActivationView | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [confirmation, setConfirmation] = useState(""), [cash, setCash] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({}), [reason, setReason] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef<{ action: string; body: Record<string, unknown> } | null>(null);
  const locked = useRef(false);
  const stopScan = useRef(false);
  const [scanning, setScanning] = useState(false);
  const [proofSource, setProofSource] = useState(''), [proofType, setProofType] = useState('financialIdempotency');
  const [proofId, setProofId] = useState(''), [proofReason, setProofReason] = useState('');
  const schoolId = workspace.school.id;
  useEffect(() => {
    let disposed = false;
    void loadAllocationActivation(schoolId).then(v => { if (!disposed) setView(v); })
      .catch(e => { if (!disposed) setError(errorText(e)); });
    return () => { disposed = true; stopScan.current = true; };
  }, [schoolId]);
  async function refresh(page = 0) {
    if (locked.current || uncertain) return;
    locked.current = true; setBusy(true); setError("");
    try { setView(await loadAllocationActivation(schoolId, page, page ? view?.evidencePage?.fingerprint ?? undefined : undefined)); }
    catch (e) { setView(null); setError(errorText(e)); }
    finally { locked.current = false; setBusy(false); }
  }
  async function mutate(action: string, body: Record<string, unknown>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(""); setNotice("");
    if (!pending.current) pending.current = { action, body: { ...body, requestId: crypto.randomUUID().replaceAll("-", "") } };
    let confirmed = false;
    try {
      const result = await allocationRequest<{ decision?: string; reason?: string }>(pending.current.action, pending.current.body);
      pending.current = null; setUncertain(false); setConfirmation(""); confirmed = true;
      setNotice(result.decision === 'rejected' ? `Justification refusée : ${result.reason ?? 'preuve non vérifiée'}`
        : result.decision === 'accepted' ? 'Justification vérifiée et conservée. Relancez le rapprochement avant toute approbation.'
          : "Opération confirmée par le serveur. Aucune autre école n'a été activée.");
      setView(await loadAllocationActivation(schoolId));
      // Keep the preparation panel mounted: its proof decision/progress is
      // necessary feedback, not a reason to reload the entire workspace.
      if (['publish-configuration', 'activate', 'pause', 'resume'].includes(action)) onChanged();
    } catch (e) {
      if (confirmed) { setView(null); setError(`Opération enregistrée ; consultation à actualiser. ${errorText(e)}`); }
      else {
        const unknown = !(e instanceof AllocationApiError && e.confirmedRejection);
        setUncertain(unknown); if (!unknown) pending.current = null;
        setError(errorText(e));
      }
    } finally { locked.current = false; setBusy(false); }
  }
  const money = (n: number) => formatCurrencyMoney(n / 100, view?.currency ?? workspace.currency);
  const opening = view?.opening;
  const activationPhrase = view?.testOnly ? "ACTIVER LA REPARTITION FICTIVE" : "ACTIVER LA REPARTITION DE MON ETABLISSEMENT";
  const phrase = opening && !opening.stale ? opening.status === "proposed" ? "APPROUVER LE RAPPROCHEMENT" : activationPhrase : "RAPPROCHER LA CAISSE";
  const fieldsLocked = busy || uncertain;
  async function continueScan() {
    if (locked.current || !view?.reconciliation || view.reconciliation.stale) return;
    locked.current = true; stopScan.current = false; setBusy(true); setScanning(true); setError('');
    let run = view.reconciliation;
    try {
      while (run.status === 'RUNNING' && !stopScan.current) {
        const response = await allocationRequest<{ run: NonNullable<AllocationActivationView['reconciliation']> }>('advance-reconciliation', { runId: run.id, sequence: run.sequence });
        run = { ...response.run, stale: false };
        setView(v => v ? { ...v, reconciliation: run } : v);
      }
      if (!stopScan.current) setView(await loadAllocationActivation(schoolId));
    } catch (e) { setError(`Avancement conservé sur le serveur. ${errorText(e)}`); }
    finally { locked.current = false; setBusy(false); setScanning(false); }
  }
  async function submitOpening() {
    if (!view?.inventory) return;
    try {
      const lines = [...view.rubrics, { id: "UNALLOCATED", name: "Non affecté" }].filter(r => amounts[r.id]?.trim())
        .map(r => ({ rubricId: r.id, amountMinor: parseAmount(amounts[r.id]) }));
      if (!lines.length || lines.reduce((s, l) => s + l.amountMinor, 0) !== view.inventory.schoolAvailableMinor) throw new Error("Les montants saisis doivent expliquer exactement les fonds scolaires justifiés. Aucune affectation automatique n'est faite.");
      await mutate("prepare-opening", { lines, cashCountMinor: parseAmount(cash), confirmation });
    } catch (e) { setError(errorText(e)); }
  }
  return <section className="grid gap-3 rounded border p-3" aria-label="Activation par établissement">
    <h3 className="font-bold">Activation de {workspace.school.name}</h3>
    <p className="text-sm">Disponibilité du module et activation sont distinctes. Seul cet établissement et son année active sont concernés. Les créances et les promesses ne constituent pas des fonds disponibles.</p>
    {!view && !error && <p role="status">Vérification du périmètre et des pièces…</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
    <button type="button" className="secondary-button justify-self-start" disabled={fieldsLocked} onClick={() => void refresh()}>Actualiser le rapprochement</button>
    {uncertain && <div role="status"><p>Réponse non confirmée : ne recréez pas l'opération. Vérifiez la même demande.</p><button className="secondary-button" type="button" disabled={busy} onClick={() => { if (pending.current) void mutate(pending.current.action, pending.current.body); }}>Vérifier la même demande</button></div>}
    {view && <>
      <p className="text-sm">{workspace.year.name} · {view.currency} · {view.status === "ACTIVE" ? "Répartition active" : view.status === "PAUSED" ? "Répartition en pause — opérations conservées" : "Circuit historique maintenu jusqu'à confirmation"}</p>
      {view.status === "EN_PREPARATION" ? <>
        <h4 className="font-semibold">1. Publier les configurations préparées</h4>
        <p className="text-sm">L'approbation lie ces versions aux prochains encaissements de l'année active, y compris les soldes de tarifs existants. Les encaissements antérieurs restent uniquement dans l'ouverture ; les dettes des anciennes années conservent leur traitement historique.</p>
        {view.versions.map(v => <div key={v.id} className="flex flex-wrap items-center gap-2 text-sm"><span>{workspace.fees.find(f => f.id === v.feeTypeId)?.name ?? v.feeTypeId} · {workspace.fees.find(f => f.id === v.feeTypeId)?.className} · version {v.version} · {v.status}</span>{v.status === "prepared" && <button type="button" className="secondary-button" disabled={fieldsLocked} onClick={() => void mutate("publish-configuration", { versionId: v.id })}>Publier cette version</button>}</div>)}
        {!view.versions.length && <p className="text-sm">Préparez une version depuis le détail de chaque configuration. Aucune publication n'active la caisse.</p>}
        <h4 className="font-semibold">2. Contrôler les pièces et préparer l'ouverture</h4>
        <p className="text-sm">Le rapprochement avance par lots conservés sur le serveur. Aucun total incomplet ne peut être approuvé. Une nouvelle écriture ou configuration impose un nouveau rapprochement.</p>
        {view.reconciliation && <p role="status">{view.reconciliation.scanned} écritures examinées · {view.reconciliation.pageCount} lots confirmés · {view.reconciliation.blockedCount} pièces à justifier. {view.reconciliation.stale ? 'Pièces modifiées : rapprochement périmé.' : view.reconciliation.status === 'COMPLETE' ? 'Rapprochement complet.' : view.reconciliation.reason ?? 'Rapprochement en cours.'}</p>}
        {(!view.reconciliation || view.reconciliation.stale || view.reconciliation.status === 'BLOCKED') && <button type="button" className="secondary-button" disabled={fieldsLocked} onClick={() => void mutate('start-reconciliation', {})}>Lancer un nouveau rapprochement</button>}
        {view.reconciliation?.status === 'RUNNING' && !view.reconciliation.stale && <button type="button" className="secondary-button" disabled={fieldsLocked} onClick={() => void continueScan()}>Continuer le rapprochement</button>}
        {scanning && <button type="button" className="secondary-button" onClick={() => { stopScan.current = true; }}>Arrêter après ce lot — progression conservée</button>}
        {view.evidencePage && !view.inventory && (view.reconciliation?.pageCount ?? 0) > 0 && <div className="grid gap-2 text-sm">
          <h4 className="font-semibold">Pièces examinées — aucune affectation automatique</h4>
          {view.evidencePage.rows.map(row => <p key={`${row.collection}/${row.id}`} className="break-all">{row.collection}/{row.id} : {row.reason ?? 'Pièce vérifiée'}</p>)}
          {!view.evidencePage.rows.length && <p>Aucune pièce dans ce lot. Les autres lots restent consultables.</p>}
          {view.evidencePage.page > 0 && <button className="secondary-button" type="button" disabled={fieldsLocked} onClick={() => void refresh(view.evidencePage!.page - 1)}>Pièces précédentes</button>}
          {view.evidencePage.hasNext && <button className="secondary-button" type="button" disabled={fieldsLocked} onClick={() => void refresh(view.evidencePage!.page + 1)}>Pièces suivantes</button>}
          <label>Écriture bloquante<select className="input" value={proofSource} onChange={e => setProofSource(e.target.value)}><option value="">Sélectionner une écriture</option>{view.evidencePage.rows.filter(r => r.reason).map(r => <option key={`${r.collection}/${r.id}`} value={`${r.collection}/${r.id}`}>{r.collection}/{r.id}</option>)}</select></label>
          <p>Une pièce jointe ou une déclaration ne suffit pas. Indiquez la référence d'un reçu serveur ou de la paie liée ; le serveur vérifiera établissement, écriture, montant, devise et absence de réutilisation. L'historique d'origine ne sera pas modifié.</p>
          <label>Nature de la preuve<select className="input" value={proofType} onChange={e => setProofType(e.target.value)}><option value="financialIdempotency">Reçu serveur de transaction</option><option value="personnelPayments">Paiement de personnel lié</option></select></label>
          <label>Référence de preuve<input className="input" value={proofId} onChange={e => setProofId(e.target.value)}/></label>
          <label>Motif de justification<textarea className="input" maxLength={500} value={proofReason} onChange={e => setProofReason(e.target.value)}/></label>
          <button className="secondary-button" type="button" disabled={fieldsLocked || !proofSource || !proofId || proofReason.trim().length < 10} onClick={() => { const [collection, sourceId] = proofSource.split('/'); void mutate('justify-history', { collection, sourceId, evidenceType: proofType, evidenceId: proofId, reason: proofReason }); }}>Vérifier et enregistrer la décision</button>
        </div>}
        {view.inventory && <>
          <p className="text-sm">Situation vérifiée au {new Date(view.cutoffAt).toLocaleString("fr-FR")}. Caisse globale justifiée : {money(view.inventory.cashAvailableMinor)}. Fonds scolaires justifiés : {money(view.inventory.schoolAvailableMinor)}. Les autres recettes restent hors répartition.</p>
          <p className="text-sm">{view.inventory.evidenceCount} pièces retenues. Page {view.inventory.page + 1}. La coupure définitive sera fixée par le serveur lors de l'activation.</p>
          <div className="max-h-60 overflow-auto"><table className="w-full text-xs"><thead><tr><th>Pièce</th><th>Date</th><th>Montant</th></tr></thead><tbody>{view.inventory.evidence.map(e => <tr key={`${e.collection}/${e.id}`}><td className="break-all">{e.collection}/{e.id}</td><td>{new Date(e.createdAt).toLocaleDateString("fr-FR")}</td><td>{money(e.amountMinor)}</td></tr>)}</tbody></table></div>
          {view.inventory.hasNext && <button className="secondary-button" type="button" disabled={fieldsLocked} onClick={() => void refresh(view.inventory!.page + 1)}>Pièces suivantes</button>}
          {view.inventory.page > 0 && <button className="secondary-button" type="button" disabled={fieldsLocked} onClick={() => void refresh(view.inventory!.page - 1)}>Pièces précédentes</button>}
          {opening?.stale && <p role="alert" className="text-amber-800">Les pièces ou configurations ont changé. L'ancienne approbation ne permet plus l'activation : préparez un nouveau rapprochement.</p>}
          {(!opening || opening.stale) && <fieldset disabled={fieldsLocked} className="grid gap-2">
            <label className="grid gap-1 text-sm">Caisse constatée ({view.currency})<input className="input" inputMode="decimal" value={cash} onChange={e => setCash(e.target.value)}/></label>
            {[...view.rubrics, { id: "UNALLOCATED", name: "Non affecté — uniquement si justifié explicitement" }].map(r => <label key={r.id} className="grid gap-1 text-sm">Ouverture : {r.name} ({view.currency})<input className="input" inputMode="decimal" value={amounts[r.id] ?? ""} onChange={e => setAmounts(a => ({ ...a, [r.id]: e.target.value }))}/></label>)}
            <p className="text-sm">Aucun montant n'est prérempli ni attribué automatiquement.</p>
          </fieldset>}
          {opening && !opening.stale && <div className="text-sm"><h4 className="font-semibold">Ouverture {opening.status === "approved" ? "approuvée" : "proposée"}</h4>{opening.lines.map(l => <p key={l.rubricId}>{view.rubrics.find(r => r.id === l.rubricId)?.name ?? "Non affecté"} : {money(l.amountMinor)}</p>)}<p>Caisse constatée : {money(opening.cashCountMinor)}</p></div>}
          <label className="grid gap-1 text-sm">Saisissez exactement « {phrase} »<input className="input" disabled={fieldsLocked} value={confirmation} onChange={e => setConfirmation(e.target.value)} aria-label="Confirmation du rapprochement" autoComplete="off"/></label>
          {(!opening || opening.stale) ? <button className="primary-button" type="button" disabled={fieldsLocked || confirmation !== phrase || !view.rubrics.length} onClick={() => void submitOpening()}>Préparer l'ouverture</button>
            : opening.status === "proposed" ? <button className="primary-button" type="button" disabled={fieldsLocked || confirmation !== phrase} onClick={() => void mutate("approve-opening", { openingId: opening.id, confirmation })}>Approuver le rapprochement</button>
              : <button className="primary-button" type="button" disabled={fieldsLocked || confirmation !== phrase || !opening.approvedByCurrentUser} onClick={() => void mutate("activate", { openingId: opening.id, confirmation })}>Activer cet établissement</button>}
        </>}
      </> : <fieldset className="grid gap-2" disabled={fieldsLocked}>
        <p className="text-sm">Coupure : {new Date(view.cutoffAt).toLocaleString("fr-FR")}. Une pause préserve le registre et refuse les opérations concernées, sans les détourner vers le circuit historique.</p>
        <label className="grid gap-1 text-sm">Motif audité<textarea className="input" value={reason} maxLength={500} onChange={e => setReason(e.target.value)}/></label>
        <button type="button" className="secondary-button" disabled={reason.trim().length < 5} onClick={() => void mutate(view.status === "ACTIVE" ? "pause" : "resume", { reason })}>{view.status === "ACTIVE" ? "Mettre en pause cet établissement" : "Reprendre la répartition"}</button>
      </fieldset>}
    </>}
  </section>;
}
