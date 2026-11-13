import { useEffect, useRef, useState } from "react";
import { AllocationApiError, allocationRequest, loadAllocationActivation, type AllocationActivationView, type AllocationWorkspace, type AllocationEvidence, type AllocationProof } from "../../services/feeAllocation";
import { formatCurrencyMoney } from "../../utils/currency";
import { toMoneyMinor } from "../../utils/money";
import { AllocationActionButton as Action } from "./AllocationActionButton";

const errorText = (e: unknown) => e instanceof Error ? e.message : "Confirmation serveur indisponible.";
const parseAmount = (value: string) => {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value.trim())) throw new Error("Indiquez un montant positif avec deux décimales au maximum.");
  return toMoneyMinor(Number(value.replace(",", ".")));
};

/** The UI never invents an opening allocation or treats an uncertain reply as success. */
export function FeeAllocationActivation({ workspace, onChanged, onConfigure }: { workspace: AllocationWorkspace; onChanged: () => void; onConfigure: () => void }) {
  const [view, setView] = useState<AllocationActivationView | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [confirmation, setConfirmation] = useState(""), [cash, setCash] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({}), [reason, setReason] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef<{ action: string; body: Record<string, unknown> } | null>(null);
  const locked = useRef(false);
  const stopScan = useRef(false);
  const [scanning, setScanning] = useState(false);
  const [actionBusy, setActionBusy] = useState('initial');
  const [evidenceOpen, setEvidenceOpen] = useState(false), [blockedOnly, setBlockedOnly] = useState(false);
  const [openingForm, setOpeningForm] = useState(false), [pauseForm, setPauseForm] = useState(false);
  const [proofSource, setProofSource] = useState<AllocationEvidence | null>(null);
  const [proofs, setProofs] = useState<AllocationProof[]>([]), [proofSelected, setProofSelected] = useState('');
  const [proofReason, setProofReason] = useState(''), [proofCursor, setProofCursor] = useState<string | null>(null);
  const schoolId = workspace.school.id;
  useEffect(() => {
    let disposed = false; stopScan.current = false;
    void loadAllocationActivation(schoolId).then(v => { if (!disposed) setView(v); })
      .catch(e => { if (!disposed) setError(errorText(e)); }).finally(() => { if (!disposed) setActionBusy(''); });
    return () => { disposed = true; stopScan.current = true; };
  }, [schoolId]);
  async function refresh(page = 0, onlyBlocked = false, key = 'refresh') {
    if (locked.current || uncertain) return;
    locked.current = true; setBusy(true); setActionBusy(key); setError('');
    try {
      let next = await loadAllocationActivation(schoolId, page, page ? view?.evidencePage?.fingerprint ?? undefined : undefined, onlyBlocked);
      while (onlyBlocked && !next.evidencePage?.rows.length && next.evidencePage?.hasNext) {
        next = await loadAllocationActivation(schoolId, next.evidencePage.page + 1, next.evidencePage.fingerprint ?? undefined, true);
      }
      setView(next); setBlockedOnly(onlyBlocked);
    } catch (e) { setView(null); setError(errorText(e)); }
    finally { locked.current = false; setBusy(false); setActionBusy(''); }
  }
  async function findProofs(row: AllocationEvidence, cursor?: string) {
    if (locked.current || uncertain) return;
    if (!cursor) { setProofSource(row); setProofs([]); setProofSelected(''); setProofReason(''); }
    locked.current = true; setBusy(true); setActionBusy('proof-search'); setError('');
    try {
      const result = await allocationRequest<{ candidates: AllocationProof[]; schoolId: string; nextCursor: string | null }>('get-history-proofs', { collection: row.collection, sourceId: row.id, ...(cursor ? { cursor } : {}) });
      if (result.schoolId !== schoolId) throw new Error('Preuves hors établissement.');
      setProofs(p => cursor ? [...p, ...result.candidates] : result.candidates); setProofCursor(result.nextCursor);
    } catch (e) { setError(errorText(e)); }
    finally { locked.current = false; setBusy(false); setActionBusy(''); }
  }
  async function mutate(action: string, body: Record<string, unknown>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setActionBusy(uncertain ? "retry" : action); setError(""); setNotice("");
    if (!pending.current) pending.current = { action, body: { ...body, requestId: crypto.randomUUID().replaceAll("-", "") } };
    let confirmed = false;
    try {
      const result = await allocationRequest<{ decision?: string; reason?: string }>(pending.current.action, pending.current.body);
      pending.current = null; setUncertain(false); setConfirmation(""); confirmed = true;
      setNotice(result.decision === 'rejected' ? `Justification refusée : ${result.reason ?? 'preuve non vérifiée'}`
        : result.decision === 'accepted' ? 'Justification vérifiée et conservée. Relancez le rapprochement avant toute approbation.'
          : "Opération confirmée par le serveur. Aucune autre école n'a été activée.");
      if (result.decision === "accepted") { setProofSource(null); setProofs([]); }
      setView(await loadAllocationActivation(schoolId)); setBlockedOnly(false); setOpeningForm(false);
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
    } finally { locked.current = false; setBusy(false); setActionBusy(""); }
  }
  const money = (n: number) => formatCurrencyMoney(n / 100, view?.currency ?? workspace.currency);
  const opening = view?.opening;
  const activationPhrase = view?.testOnly ? "ACTIVER LA REPARTITION FICTIVE" : "ACTIVER LA REPARTITION DE MON ETABLISSEMENT";
  const phrase = opening && !opening.stale ? opening.status === "proposed" ? "APPROUVER LE RAPPROCHEMENT" : activationPhrase : "RAPPROCHER LA CAISSE";
  const fieldsLocked = busy || uncertain;
  async function continueScan() {
    if (locked.current || !view?.reconciliation || view.reconciliation.stale) return;
    locked.current = true; stopScan.current = false; setBusy(true); setScanning(true); setActionBusy('continue'); setError('');
    let run = view.reconciliation;
    try {
      while (run.status === 'RUNNING' && !stopScan.current) {
        const response = await allocationRequest<{ run: NonNullable<AllocationActivationView['reconciliation']> }>('advance-reconciliation', { runId: run.id, sequence: run.sequence });
        run = { ...response.run, stale: false };
        setView(v => v ? { ...v, reconciliation: run } : v);
      }
      if (!stopScan.current) setView(await loadAllocationActivation(schoolId));
    } catch (e) { setError(`Avancement conservé sur le serveur. ${errorText(e)}`); }
    finally { locked.current = false; setBusy(false); setScanning(false); setActionBusy(""); }
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
  const rows = view?.evidencePage?.rows ?? [], run = view?.reconciliation;
  const prepared = view?.versions.find(v => v.status === 'prepared' && workspace.configs.some(c => c.feeTypeId === v.feeTypeId && c.draftRevision === v.version));
  const draft = workspace.configs.find(c => c.draft && !view?.versions.some(v => v.feeTypeId === c.feeTypeId && v.version === c.draftRevision));
  const readableDate = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('fr-FR') : 'Date non justifiée';
  const label = (row: AllocationEvidence) => row.nature + (row.receiptNumber ? ' · reçu ' + row.receiptNumber : '') + ' · ' + readableDate(row.createdAt) + ' · ' + (row.amountMinor === null ? 'Montant non justifié' : row.currency ? formatCurrencyMoney(row.amountMinor / 100, row.currency) : (row.amountMinor / 100).toLocaleString('fr-FR') + ' (devise non justifiée)');
  const payrollOnly = run?.blockedCount === 1 && view?.singleBlocker?.nature === 'Paiement de personnel';
  const missing = !workspace.configs.length ? 'Configurer une répartition.' : prepared || draft ? 'Préparer et publier la répartition.' : !run || run.stale || run.status === 'RUNNING' ? 'Terminer la vérification du solde de départ.' : run.blockedCount ? 'Justifier les écritures signalées, puis vérifier à nouveau le solde.' : !opening || opening.stale ? 'Préparer le solde de départ.' : opening.status === 'proposed' ? 'Approuver le solde de départ.' : !opening.approvedByCurrentUser ? 'La confirmation doit être faite par l’administrateur qui a approuvé.' : 'Saisir la confirmation pour activer la répartition.';
  const primary = (key: string, text: string, click: () => void, disabled = false) => <Action busy={busy && actionBusy === key} disabled={fieldsLocked || disabled} className="primary-button justify-self-start" onClick={click}>{text}</Action>;
  return <section className="grid min-w-0 gap-3 rounded border p-3" aria-label="Activation par établissement">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">{view ? view.status === 'ACTIVE' ? 'Active' : view.status === 'PAUSED' ? 'En pause' : 'En préparation' : 'État à vérifier'}</h3><Action busy={busy && actionBusy === 'refresh'} disabled={fieldsLocked} onClick={() => void refresh()}>Actualiser</Action></div>
    {!view && actionBusy === 'initial' && <p role="status">Chargement...</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
    {uncertain && <div role="status"><p>Réponse incertaine : vérifiez la même demande, sans recréer l’opération.</p><Action busy={busy && actionBusy === 'retry'} disabled={busy} onClick={() => { if (pending.current) void mutate(pending.current.action, pending.current.body); }}>Vérifier la même demande</Action></div>}
    {view && <>
      {run && <p role="status" className="text-sm">{run.scanned} écritures examinées · {run.blockedCount ? payrollOnly ? '1 paiement de personnel à vérifier' : run.blockedCount + ' écriture(s) à vérifier' : 'aucune écriture signalée'}. {run.stale ? 'Les écritures ont changé : vérification à actualiser.' : run.status === 'COMPLETE' ? 'Vérification terminée.' : run.status === 'RUNNING' ? 'Vérification en cours.' : run.reason}</p>}
      {view.status === 'EN_PREPARATION' ? <>
        {!workspace.configs.length ? <button className="primary-button justify-self-start" type="button" disabled={fieldsLocked} onClick={onConfigure}>Configurer une répartition</button>
          : prepared ? primary('publish-configuration', 'Publier la répartition', () => void mutate('publish-configuration', { versionId: prepared.id }))
          : draft ? primary('prepare-version', 'Préparer une version', () => void mutate('prepare-version', { feeTypeId: draft.feeTypeId, expectedRevision: draft.draftRevision }))
          : !run || run.stale ? primary('start-reconciliation', 'Vérifier le solde de départ', () => void mutate('start-reconciliation', {}))
          : run.status === 'RUNNING' ? primary('continue', 'Continuer la vérification', () => void continueScan())
          : run.blockedCount ? primary('blocked', 'Voir les écritures à vérifier', () => { setEvidenceOpen(true); void refresh(0, true, 'blocked'); })
          : !view.inventory ? primary('start-reconciliation', 'Vérifier à nouveau le solde', () => void mutate('start-reconciliation', {}))
          : (!opening || opening.stale) && !openingForm ? <button className="primary-button justify-self-start" type="button" disabled={fieldsLocked} onClick={() => setOpeningForm(true)}>Préparer le solde de départ</button>
          : (!opening || opening.stale) ? primary('prepare-opening', 'Confirmer le solde de départ', () => void submitOpening(), confirmation !== phrase || !view.rubrics.length)
          : opening.status === 'proposed' ? primary('approve-opening', 'Approuver le solde de départ', () => void mutate('approve-opening', { openingId: opening.id, confirmation }), confirmation !== phrase)
          : primary('activate', 'Activer la répartition', () => void mutate('activate', { openingId: opening.id, confirmation }), confirmation !== phrase || !opening.approvedByCurrentUser)}
        {scanning && <button className="secondary-button justify-self-start" type="button" onClick={() => { stopScan.current = true; }}>Suspendre la vérification après cette étape</button>}
        <details className="text-sm"><summary className="cursor-pointer">Voir les étapes d’activation</summary><ol className="ml-5 mt-2 list-decimal"><li>Configurer et publier une répartition.</li><li>Vérifier le solde de départ et justifier les écritures signalées.</li><li>Préparer puis approuver le solde de départ.</li><li>Activer la répartition avec la confirmation requise.</li></ol><p className="mt-2">Avant « Activer la répartition » : {missing}</p><p>Une configuration publiée ou un solde approuvé n’est pas une activation.</p></details>
        {!!view.versions.length && <details className="text-sm"><summary>Voir les configurations</summary>{view.versions.map(v => <p key={v.id}>{workspace.fees.find(f => f.id === v.feeTypeId)?.name ?? 'Frais historique'} — {workspace.fees.find(f => f.id === v.feeTypeId)?.className} · version {v.version} · {v.status === 'published' ? 'publiée' : 'préparée'}</p>)}</details>}
        {!!run?.pageCount && <Action busy={busy && actionBusy === 'evidence'} disabled={fieldsLocked} className="secondary-button justify-self-start" onClick={() => { setEvidenceOpen(v => !v); if (!evidenceOpen && blockedOnly) void refresh(0, false, 'evidence'); }}>{evidenceOpen ? 'Masquer les pièces' : 'Voir les pièces vérifiées'}</Action>}
        {evidenceOpen && <div className="grid gap-2 rounded border p-3 text-sm" aria-label="Pièces examinées"><p>Vérifier une ancienne écriture ne l’affecte pas à une rubrique et n’approuve pas le solde.</p>
          {rows.map(row => <article key={row.collection + '/' + row.id} className="rounded border p-2"><p className="font-semibold">{label(row)}</p><p>{row.reason ?? 'Pièce vérifiée'}</p>{row.reason && <button className="secondary-button mt-2" type="button" disabled={fieldsLocked} onClick={() => void findProofs(row)}>Justifier</button>}<details><summary>Référence technique</summary><p className="break-all">{row.collection}/{row.id}</p></details></article>)}
          {!rows.length && <p>Aucune pièce {blockedOnly ? 'à vérifier ' : ''}dans cette page.</p>}
          <div className="flex flex-wrap gap-2">{!blockedOnly && (view.evidencePage?.page ?? 0) > 0 && <Action busy={busy && actionBusy === 'previous'} disabled={fieldsLocked} onClick={() => void refresh(view.evidencePage!.page - 1, false, 'previous')}>Pièces précédentes</Action>}{view.evidencePage?.hasNext && <Action busy={busy && actionBusy === 'next'} disabled={fieldsLocked} onClick={() => void refresh(view.evidencePage!.page + 1, blockedOnly, 'next')}>Pièces suivantes</Action>}</div>
        </div>}
        {proofSource && <fieldset className="grid gap-2 rounded border p-3 text-sm" disabled={fieldsLocked} aria-label="Justifier une écriture"><legend>Justifier : {proofSource.nature}</legend><p>{label(proofSource)}</p><p>{proofSource.reason} {proofSource.reason === 'Date ou devise non justifiée' && 'Ce motif historique ne précise pas si la date, la devise, ou les deux sont en cause.'}</p>
          <p>Choisissez une preuve serveur. Une suggestion n’est pas une validation ; la concordance et l’absence de réutilisation seront contrôlées.</p>
          {actionBusy === 'proof-search' && busy && <p role="status">Chargement...</p>}
          <label>Preuve autorisée<select className="input" value={proofSelected} onChange={e => setProofSelected(e.target.value)}><option value="">Choisir une preuve</option>{proofs.map(p => <option key={p.type + '/' + p.id} value={p.type + '/' + p.id}>{p.nature} · {readableDate(p.createdAt)} · {p.currency ? formatCurrencyMoney(p.amount, p.currency) : 'Devise non justifiée'}{p.receiptNumber ? ' · reçu ' + p.receiptNumber : ''}</option>)}</select></label>
          {!proofs.length && !busy && <p>Aucune preuve liée trouvée dans les reçus examinés. Sans preuve vérifiable, l’activation reste en attente.</p>}
          {proofCursor && <Action busy={busy && actionBusy === 'proof-search'} onClick={() => void findProofs(proofSource, proofCursor)}>Rechercher d’autres preuves</Action>}
          <label>Motif de justification<textarea className="input" maxLength={500} value={proofReason} onChange={e => setProofReason(e.target.value)}/></label>
          <Action busy={busy && actionBusy === 'justify-history'} disabled={!proofSelected || proofReason.trim().length < 10} onClick={() => { const p = proofs.find(p => p.type + '/' + p.id === proofSelected); if (p) void mutate('justify-history', { collection: proofSource.collection, sourceId: proofSource.id, evidenceType: p.type, evidenceId: p.id, reason: proofReason }); }}>Vérifier la preuve</Action>
          <button className="secondary-button" type="button" onClick={() => setProofSource(null)}>Fermer la justification</button>
        </fieldset>}
        {view.inventory && ((opening && !opening.stale) || openingForm) && <fieldset disabled={fieldsLocked} className="grid gap-2 rounded border p-3 text-sm"><legend>Solde de départ</legend><p>Fonds scolaires justifiés : {money(view.inventory.schoolAvailableMinor)}. Caisse globale justifiée : {money(view.inventory.cashAvailableMinor)}. Les autres recettes restent hors répartition.</p>
          {(!opening || opening.stale) ? <><label>Caisse constatée ({view.currency})<input className="input" inputMode="decimal" value={cash} onChange={e => setCash(e.target.value)}/></label>{[...view.rubrics, { id: 'UNALLOCATED', name: 'Non affecté — uniquement si justifié explicitement' }].map(r => <label key={r.id}>Ouverture : {r.name} ({view.currency})<input className="input" inputMode="decimal" value={amounts[r.id] ?? ''} onChange={e => setAmounts(a => ({ ...a, [r.id]: e.target.value }))}/></label>)}<p>Aucun montant n’est attribué automatiquement.</p></> : <><p>Solde {opening.status === 'approved' ? 'approuvé' : 'proposé'} — école non activée.</p>{opening.lines.map(l => <p key={l.rubricId}>{view.rubrics.find(r => r.id === l.rubricId)?.name ?? 'Non affecté'} : {money(l.amountMinor)}</p>)}</>}
          <label>Saisissez exactement « {phrase} »<input className="input" value={confirmation} onChange={e => setConfirmation(e.target.value)} aria-label="Confirmation du rapprochement" autoComplete="off"/></label>
          {opening?.status === 'approved' && !opening.approvedByCurrentUser && <p role="alert">Seul l’administrateur qui a approuvé peut confirmer l’activation.</p>}
        </fieldset>}
      </> : <><button className="secondary-button justify-self-start" type="button" disabled={fieldsLocked} onClick={() => setPauseForm(v => !v)}>{view.status === 'ACTIVE' ? 'Mettre en pause' : 'Reprendre la répartition'}</button>{pauseForm && <fieldset className="grid gap-2" disabled={fieldsLocked}><p className="text-sm">Une pause conserve le registre et refuse les opérations concernées, sans retour au circuit historique.</p><label>Motif audité<textarea className="input" value={reason} maxLength={500} onChange={e => setReason(e.target.value)}/></label><Action busy={busy && actionBusy === (view.status === 'ACTIVE' ? 'pause' : 'resume')} disabled={reason.trim().length < 5} onClick={() => void mutate(view.status === 'ACTIVE' ? 'pause' : 'resume', { reason })}>{view.status === 'ACTIVE' ? 'Confirmer la pause' : 'Confirmer la reprise'}</Action></fieldset>}</>}
    </>}
  </section>;
}
