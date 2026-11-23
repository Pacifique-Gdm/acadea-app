import { useEffect, useRef, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { AllocationApiError, allocationRequest, loadAllocationActivation, type AllocationActivationView, type AllocationWorkspace, type AllocationEvidence, type AllocationProof } from "../../services/feeAllocation";
import { formatCurrencyMoney } from "../../utils/currency";
import { AllocationActionButton as Action } from "./AllocationActionButton";
import { userFacingError } from "../../utils/userFacingError";
import { ErrorNotice } from "../../components/ui/ErrorNotice";
import { useLoadRetry } from "../../hooks/useLoadRetry";
import { SOCIAL_PUBLISH_PHRASE, TypedConfirmation } from "./FeeAllocationSocialPart";
import { pendingPublications } from "./feeAllocationPublishPlan";
import { allocationClassLabel } from "../../utils/feeAllocationView";
import { openingPlan, reasonReady } from "./feeAllocationOpeningPlan";
import { proofPhotoProblem, uploadProofPhoto } from "../../services/feeAllocationProofPhoto";
import { AllocationJustifications, parseJustifications } from "../../components/AllocationJustifications";

const errorText = (e: unknown) => userFacingError(e, "Confirmation serveur indisponible.");
/** Lot « 3 étapes » : phrases tapées par l'Administrateur. */
export const VALIDATE_OPENING_PHRASE = "VALIDER LE SOLDE DE DEPART";
export const CANCEL_OPENING_PHRASE = "ANNULER LE SOLDE DE DEPART";

/** Phrase à taper soi-même : pas de coller, pas de glisser, pas de remplissage automatique. */
function PhraseField({ phrase, value, onChange, disabled, label }: { phrase: string; value: string; onChange: (value: string) => void; disabled?: boolean; label?: string }) {
  const block = (event: { preventDefault: () => void }) => event.preventDefault();
  const [name] = useState(() => `confirmation-${crypto.randomUUID()}`);
  return <label className="grid gap-1 text-sm">{label ?? `Tapez vous-même « ${phrase} »`}
    <input className="input" value={value} disabled={disabled} aria-label={`Phrase « ${phrase} »`} autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false}
      name={name} data-typed-phrase={phrase} onPaste={block} onDrop={block} onDragOver={block} onContextMenu={block}
      onChange={(event) => { const native = event.nativeEvent as InputEvent; if (native?.inputType === "insertFromPaste" || native?.inputType === "insertFromDrop" || native?.inputType === "insertReplacementText") return; onChange(event.target.value); }} />
    {value && value !== phrase && <span className="text-xs text-amber-800">La phrase n'est pas encore exacte.</span>}
  </label>;
}

/** Version 1.15.2 : phrase montrée à la place de « Préparer la nouvelle version » quand le frais est déjà réparti. */
export const DRAFT_LOCKED_TEXT = "Ce frais est déjà réparti pour cette année : sa répartition ne change plus. « Publier le nouveau frais » sert seulement à un frais pas encore réparti, par exemple un frais ou une classe ajouté en cours d’année.";

/** The UI never invents an opening allocation or treats an uncertain reply as success. */
/** Texte des étapes validé par l’utilisateur le 19/11. */
export function ActivationSteps() {
  return <>
    <p className="mt-2 font-semibold">Avant l’activation</p>
    <ol className="ml-5 mt-1 grid list-decimal gap-1">
      <li>Créer la répartition : « + Ajouter », choisir le frais et les classes, puis les rubriques (en pourcentage ou en montant fixe ; le reste va dans « Non affecté »). Une rubrique créée par « + Nouvelle rubrique… » n’est enregistrée qu’avec la répartition.</li>
      <li>Préparer et publier : un seul bouton prépare puis publie toutes les classes enregistrées.</li>
    </ol>
    <p className="mt-2 font-semibold">Ensuite, 3 étapes</p>
    <ol className="ml-5 mt-1 grid list-decimal gap-1">
      <li>Vérifier et justifier : Acadéa examine les encaissements et dépenses déjà enregistrés. Les écritures signalées s’affichent sur le même écran : justifiez-les par une preuve Acadéa ou par un motif écrit (avec une photo si vous en avez une).</li>
      <li>Valider le solde de départ : comptez la caisse, partagez les fonds entre les rubriques ; le reste va dans « Non affecté » avec une justification. Un écart de caisse ou des dépenses supérieures aux encaissements se déclarent avec un motif. Confirmez avec « VALIDER LE SOLDE DE DEPART ». Tant que l’école n’est pas active, « Annuler ce solde » permet de le refaire.</li>
      <li>Activer : le même administrateur tape la phrase demandée.</li>
    </ol>
    <p className="mt-2">Une école sans aucun paiement ni dépense cette année passe directement à « Activer ». Un encaissement reçu pendant ces étapes ne fait rien recommencer : il est réparti à l’activation.</p>
    <p className="mt-2 font-semibold">Après l’activation</p>
    <ul className="ml-5 mt-1 grid list-disc gap-1">
      <li>Chaque paiement est réparti automatiquement. Un paiement qui ne peut pas l’être tout de suite est quand même encaissé et attend : il n’est jamais bloqué.</li>
      <li>Les arriérés vont dans leurs propres lignes « … (arriéré AAAA-AAAA) ».</li>
      <li>Cas sociaux (tableau 2) : une partie 2 peut être publiée à part pour chaque frais. Elle s’applique dès le premier paiement réparti d’un cas social après sa publication. Une nouvelle partie 2 s’applique aux paiements suivants de cet élève.</li>
      <li>Chaque dépense est imputée à une rubrique, dans la limite de son disponible.</li>
      <li>Un nouveau frais peut être ajouté et publié ; il ne concerne que les nouveaux encaissements.</li>
      <li>« Partager » : donner au personnel choisi une vue en lecture seule de la ligne d’ensemble des rubriques partagées. L’onglet « Partage répartition » permet de la retirer.</li>
    </ul>
  </>;
}

export function FeeAllocationActivation({ workspace, onChanged }: { workspace: AllocationWorkspace; onChanged: () => void }) {
  const [view, setView] = useState<AllocationActivationView | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [errorLoad, setErrorLoad] = useState(""), errorLoadRetry = useLoadRetry(Boolean(errorLoad), () => setErrorLoad(""));
  const [confirmation, setConfirmation] = useState(""), [cash, setCash] = useState("");
  // Version 1.19.0 : phrase tapée quand la partie des cas sociaux, publiée en même temps, diffère de la partie 1.
  const [socialConfirmation, setSocialConfirmation] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({}), [reason, setReason] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef<{ action: string; body: Record<string, unknown> } | null>(null);
  const locked = useRef(false);
  const stopScan = useRef(false);
  const [scanning, setScanning] = useState(false);
  const [actionBusy, setActionBusy] = useState('initial');
  const [evidenceOpen, setEvidenceOpen] = useState(false), [blockedOnly, setBlockedOnly] = useState(false);
  const [pauseForm, setPauseForm] = useState(false);
  const [proofSource, setProofSource] = useState<AllocationEvidence | null>(null);
  const [proofs, setProofs] = useState<AllocationProof[]>([]), [proofSelected, setProofSelected] = useState('');
  const [proofReason, setProofReason] = useState(''), [proofCursor, setProofCursor] = useState<string | null>(null);
  // Lot « 3 étapes » : justification par motif écrit, motifs du solde de départ, annulation du solde.
  const [proofMode, setProofMode] = useState<'proof' | 'declaration'>('proof');
  const [declarationCurrency, setDeclarationCurrency] = useState(''), [photo, setPhoto] = useState<File | null>(null);
  const [deficitReason, setDeficitReason] = useState(''), [cashGapReason, setCashGapReason] = useState(''), [unallocatedReason, setUnallocatedReason] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false), [cancelPhrase, setCancelPhrase] = useState('');
  const autoStarted = useRef(''), autoScanned = useRef(''), autoBlocked = useRef('');
  const schoolId = workspace.school.id;
  // Version 1.15.2 : le premier chargement finit toujours, par l'état ou par une erreur claire avec « Réessayer ».
  const [initialRound, setInitialRound] = useState(0);
  useEffect(() => {
    let disposed = false; stopScan.current = false;
    setActionBusy('initial'); setErrorLoad('');
    void loadAllocationActivation(schoolId).then(v => { if (!disposed) setView(v); })
      .catch(e => { if (!disposed) setErrorLoad(errorText(e)); }).finally(() => { if (!disposed) setActionBusy(''); });
    return () => { disposed = true; stopScan.current = true; };
  }, [schoolId, initialRound, errorLoadRetry.token]);
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
    if (!cursor) { setProofSource(row); setProofs([]); setProofSelected(''); setProofReason(''); setProofMode('proof'); setPhoto(null); setDeclarationCurrency(''); }
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
      pending.current = null; setUncertain(false); setConfirmation(""); setSocialConfirmation(""); setCancelPhrase(""); confirmed = true;
      const messages: Record<string, string> = {
        'validate-opening': 'Solde de départ validé. Dernière étape : « Activer ».',
        'cancel-opening': 'Solde de départ annulé. Vous pouvez en saisir un nouveau.',
        activate: 'Répartition activée. Les prochains paiements sont répartis automatiquement.',
        'activate-without-history': 'Répartition activée. Les prochains paiements sont répartis automatiquement.',
        'start-reconciliation': 'Vérification lancée.',
      };
      setNotice(result.decision === 'rejected' ? `Justification refusée : ${result.reason ?? 'preuve non vérifiée'}`
        : result.decision === 'accepted' ? 'Justification conservée. Cliquez sur « Vérifier à nouveau » quand toutes les écritures sont justifiées.'
          : messages[action] ?? "Opération confirmée par le serveur. Aucune autre école n'a été activée.");
      if (result.decision === "accepted") { setProofSource(null); setProofs([]); setPhoto(null); }
      if (action === 'cancel-opening') setCancelOpen(false);
      setView(await loadAllocationActivation(schoolId)); setBlockedOnly(false);
      // Keep the preparation panel mounted: its proof decision/progress is
      // necessary feedback, not a reason to reload the entire workspace.
      if (['publish-configuration', 'activate', 'activate-without-history', 'pause', 'resume'].includes(action)) onChanged();
    } catch (e) {
      if (confirmed) { setView(null); setError(`Opération enregistrée ; consultation à actualiser. ${errorText(e)}`); }
      else {
        const unknown = !(e instanceof AllocationApiError && e.confirmedRejection);
        setUncertain(unknown); if (!unknown) pending.current = null;
        setError(errorText(e));
      }
    } finally { locked.current = false; setBusy(false); setActionBusy(""); }
  }
  // Lot « 3 étapes » : justifications consultables avant et après l'activation (Administrateur de l'école seulement).
  const loadJustifications = async () => parseJustifications(await allocationRequest<unknown>('get-justifications', {}));
  const money = (n: number) => formatCurrencyMoney(n / 100, view?.currency ?? workspace.currency);
  const opening = view?.opening;
  const activationPhrase = view?.testOnly ? "ACTIVER LA REPARTITION FICTIVE" : "ACTIVER LA REPARTITION DE MON ETABLISSEMENT";
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
  // Lot « 3 étapes » : calcul guidé du solde de départ (« Non affecté » = le reste, écart de caisse, déficit).
  const plan2 = view?.inventory ? openingPlan({ rubricIds: view.rubrics.map(r => r.id), amounts, schoolAvailableMinor: view.inventory.schoolAvailableMinor,
    cashExpectedMinor: view.inventory.cashExpectedMinor ?? view.inventory.cashAvailableMinor, cash }) : null;
  const openingReady = !!plan2 && !plan2.error && plan2.cashCountMinor !== null && confirmation === VALIDATE_OPENING_PHRASE
    && (!plan2.needsDeficitReason || reasonReady(deficitReason)) && (!plan2.needsCashGapReason || reasonReady(cashGapReason))
    && (!plan2.needsUnallocatedReason || reasonReady(unallocatedReason));
  async function submitOpening() {
    if (!plan2 || !openingReady || plan2.cashCountMinor === null) return;
    await mutate("validate-opening", { lines: plan2.lines, cashCountMinor: plan2.cashCountMinor, confirmation,
      ...(plan2.needsDeficitReason ? { deficitReason } : {}), ...(plan2.needsCashGapReason ? { cashGapReason } : {}), ...(plan2.needsUnallocatedReason ? { unallocatedReason } : {}) });
  }
  async function submitDeclaration() {
    if (!proofSource || !reasonReady(proofReason)) return;
    let photoPath: string | undefined;
    if (photo) {
      if (locked.current) return;
      locked.current = true; setBusy(true); setActionBusy('justify-history'); setError('');
      try { photoPath = await uploadProofPhoto(schoolId, photo); }
      catch (e) { setError(`Photo non envoyée : ${errorText(e)}`); return; }
      finally { locked.current = false; setBusy(false); setActionBusy(''); }
    }
    await mutate('justify-history', { collection: proofSource.collection, sourceId: proofSource.id, evidenceType: 'declaration', reason: proofReason,
      ...(photoPath ? { photoPath } : {}), ...(!proofSource.currency && declarationCurrency ? { currency: declarationCurrency } : {}) });
  }
  const rows = view?.evidencePage?.rows ?? [], run = view?.reconciliation;
  // Correction 1.20.1 : chaque frais à publier est repéré pour lui-même (et non « le premier frais trouvé ») ;
  // un seul bouton prépare puis publie toutes ses classes, avant comme après l'activation.
  const plan = pendingPublications(workspace.configs, view?.versions ?? [], view?.status ?? 'EN_PREPARATION');
  const planSocial = plan.items.some(item => item.hasSocialPart);
  const planCount = plan.items.length;
  const feeName = (feeTypeId: string) => { const fee = workspace.fees.find(f => f.id === feeTypeId); return fee ? `${fee.name} · ${allocationClassLabel(fee.classOptionKey || fee.className)}` : 'Frais'; };
  const planBlock = planCount > 0 && <div className="grid gap-2 rounded border p-3 text-justify text-sm" data-publish-plan>
    <p>{planCount > 1 ? `${planCount} classes à publier` : '1 classe à publier'} : {plan.items.map(item => feeName(item.feeTypeId)).join(', ')}.</p>
    {planSocial && <div className="grid gap-2 rounded border border-amber-200 bg-amber-50 p-3" data-social-with-part-one>
      <p>Au moins une classe a une partie des cas sociaux différente de celle des élèves normaux. Les deux parties seront publiées en même temps.</p>
      <TypedConfirmation value={socialConfirmation} onChange={(value) => setSocialConfirmation(value)} disabled={fieldsLocked} /></div>}
  </div>;
  const socialMissing = planSocial && socialConfirmation !== SOCIAL_PUBLISH_PHRASE;
  const planRequests = useRef(new Map<string, string>());
  const requestKey = (key: string) => { if (!planRequests.current.has(key)) planRequests.current.set(key, crypto.randomUUID().replaceAll("-", "")); return planRequests.current.get(key)!; };
  async function publishAll() {
    if (locked.current || !planCount || socialMissing) return;
    locked.current = true; setBusy(true); setActionBusy('publish-all'); setError(''); setNotice('');
    let done = 0;
    try {
      for (const item of plan.items) {
        let versionId = item.preparedId;
        if (!versionId) {
          const prepared = await allocationRequest<{ version: { id: string } }>('prepare-version', { feeTypeId: item.feeTypeId, expectedRevision: item.draftRevision, requestId: requestKey(`prepare/${item.feeTypeId}/${item.draftRevision}`) });
          if (!prepared.version?.id) throw new AllocationApiError('Version préparée non confirmée.');
          versionId = prepared.version.id;
        }
        await allocationRequest('publish-configuration', { versionId, ...(item.hasSocialPart ? { confirmation: socialConfirmation } : {}),
          requestId: requestKey(`publish/${versionId}/${item.hasSocialPart ? socialConfirmation : ''}`) });
        done += 1;
      }
      setSocialConfirmation('');
      setNotice(`${done > 1 ? `${done} classes publiées` : '1 classe publiée'}. ${view?.status === 'EN_PREPARATION' ? 'Aucun argent ne bouge avant l’activation.' : 'Seuls les paiements reçus à partir de maintenant suivent cette répartition.'}`);
    } catch (e) {
      setError(`${done} classe(s) publiée(s) sur ${planCount}. ${errorText(e)} Cliquez de nouveau pour continuer : les classes déjà publiées ne sont pas refaites.`);
    } finally {
      try { setView(await loadAllocationActivation(schoolId)); } catch { /* l'icône « Actualiser » reste disponible */ }
      locked.current = false; setBusy(false); setActionBusy('');
      if (done) onChanged();
    }
  }
  const readableDate = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('fr-FR') : 'Date non justifiée';
  const label = (row: AllocationEvidence) => row.nature + (row.receiptNumber ? ' · reçu ' + row.receiptNumber : '') + ' · ' + readableDate(row.createdAt) + ' · ' + (row.amountMinor === null ? 'Montant non justifié' : row.currency ? formatCurrencyMoney(row.amountMinor / 100, row.currency) : (row.amountMinor / 100).toLocaleString('fr-FR') + ' (devise non justifiée)');
  const payrollOnly = run?.blockedCount === 1 && view?.singleBlocker?.nature === 'Paiement de personnel';
  const missing = !workspace.configs.length ? 'Configurer une répartition.' : planCount ? 'Préparer et publier la répartition.'
    : view?.emptyHistory ? 'Taper la phrase demandée pour activer.'
    : !run || run.stale || run.status === 'RUNNING' ? 'Terminer la vérification.' : run.blockedCount ? 'Justifier les écritures signalées, puis vérifier à nouveau.'
    : !opening || opening.stale ? 'Valider le solde de départ.' : opening.status === 'proposed' ? 'Approuver le solde de départ.'
    : !opening.approvedByCurrentUser ? 'L’activation doit être faite par l’administrateur qui a validé le solde.' : 'Taper la phrase demandée pour activer.';
  // Lot « 3 étapes » : étape affichée, caisse attendue et encaissements reçus pendant la mise en route.
  const step = view?.status !== 'EN_PREPARATION' || !workspace.configs.length || planCount ? null
    : view.emptyHistory ? 'Dernière étape — Activer'
    : !run || run.stale || run.status !== 'COMPLETE' ? 'Étape 1 sur 3 — Vérifier et justifier'
    : !opening || opening.stale ? 'Étape 2 sur 3 — Valider le solde de départ' : 'Étape 3 sur 3 — Activer';
  const setupCount = view?.setupPayments?.count ?? 0;
  const cashExpected = view?.inventory ? view.inventory.cashExpectedMinor ?? view.inventory.cashAvailableMinor : 0;
  const otherMinor = view?.inventory ? view.inventory.cashAvailableMinor - view.inventory.schoolAvailableMinor : 0;
  // La vérification démarre et avance seule ; les écritures à justifier s'affichent seules (une fois par vérification).
  const checkEligible = view?.status === 'EN_PREPARATION' && workspace.configs.length > 0 && planCount === 0;
  useEffect(() => {
    if (!view || !checkEligible || uncertain || busy) return;
    const current = view.reconciliation;
    if (!current && autoStarted.current !== schoolId) { autoStarted.current = schoolId; void mutate('start-reconciliation', {}); return; }
    if (current?.status === 'RUNNING' && !current.stale && autoScanned.current !== current.id) { autoScanned.current = current.id; void continueScan(); return; }
    if (current?.status === 'BLOCKED' && !current.stale && autoBlocked.current !== current.id) { autoBlocked.current = current.id; setEvidenceOpen(true); void refresh(0, true, 'blocked'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, checkEligible, uncertain, busy]);
  // Version 1.15.2 : « Actualiser » devient un bouton icône, à droite de l'action principale, sur la même ligne.
  const refreshButton = <button type="button" className="secondary-button inline-flex h-11 w-11 shrink-0 items-center justify-center p-0" disabled={fieldsLocked} aria-busy={busy && actionBusy === 'refresh'} title="Actualiser" onClick={() => void refresh()}><RefreshCw aria-hidden className={`h-5 w-5 ${busy && actionBusy === 'refresh' ? 'animate-spin' : ''}`} /><span className="sr-only">Actualiser</span></button>;
  // Lot du 21/11 : l'icône « Actualiser » passe à l'extrémité droite de la ligne du statut.
  const actionRow = (node: ReactNode) => <div className="flex min-w-0 flex-wrap items-center gap-2" data-allocation-action-row>{node}</div>;
  const primary = (key: string, text: string, click: () => void, disabled = false) => <Action busy={busy && actionBusy === key} disabled={fieldsLocked || disabled} className="primary-button justify-self-start" onClick={click}>{text}</Action>;
  return <section className="grid min-w-0 gap-3 rounded border p-3" aria-label="Activation par établissement">
    <div className="flex min-w-0 items-center justify-between gap-2" data-allocation-status-row><h3 className="min-w-0 font-bold">{view ? view.status === 'ACTIVE' ? 'Active' : view.status === 'PAUSED' ? 'Active' : 'En préparation' : actionBusy === 'initial' ? 'État de la répartition' : 'État à vérifier'}</h3>{view && refreshButton}</div>
    {!view && actionBusy === 'initial' && <p role="status">Chargement...</p>}
    {!view && actionBusy !== 'initial' && <div role="alert" className="grid gap-2 rounded border border-red-200 p-3 text-justify text-sm"><p>L'état de la répartition n'a pas pu être chargé.{error ? ` ${error}` : ''}</p><button type="button" className="secondary-button justify-self-start" onClick={() => setInitialRound(n => n + 1)}>Réessayer</button></div>}
    <ErrorNotice error={errorLoad} onRetry={errorLoadRetry.retry} /><ErrorNotice error={error} />
    {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
    {uncertain && <div role="status"><p>Réponse incertaine : vérifiez la même demande, sans recréer l’opération.</p><Action busy={busy && actionBusy === 'retry'} disabled={busy} onClick={() => { if (pending.current) void mutate(pending.current.action, pending.current.body); }}>Vérifier la même demande</Action></div>}
    {view && <>
      {run && <p role="status" className="text-sm">{run.scanned} écritures examinées · {run.blockedCount ? payrollOnly ? '1 paiement de personnel à vérifier' : run.blockedCount + ' écriture(s) à vérifier' : 'aucune écriture signalée'}. {run.stale ? 'Les écritures ont changé : vérification à actualiser.' : run.status === 'COMPLETE' ? 'Vérification terminée.' : run.status === 'RUNNING' ? 'Vérification en cours.' : run.reason}</p>}
      {view.status === 'EN_PREPARATION' ? <>
        {actionRow(!workspace.configs.length ? <p className="text-sm">Utilisez « + Ajouter » pour préparer la première répartition.</p>
          : planCount ? primary('publish-all', planCount > 1 ? `Préparer et publier les ${planCount} classes` : 'Préparer et publier la répartition', () => void publishAll(), socialMissing)
          : !run || run.stale ? primary('start-reconciliation', run?.stale ? 'Vérifier à nouveau' : 'Vérifier et justifier', () => void mutate('start-reconciliation', {}))
          : run.status === 'RUNNING' ? primary('continue', 'Continuer la vérification', () => void continueScan())
          : run.blockedCount ? primary('start-reconciliation', 'Vérifier à nouveau', () => void mutate('start-reconciliation', {}))
          : null)}
        {planBlock}
        {step && <p className="text-sm font-semibold" data-activation-step>{step}</p>}
        {scanning && <button className="secondary-button justify-self-start" type="button" onClick={() => { stopScan.current = true; }}>Suspendre la vérification après cette étape</button>}
        {setupCount > 0 && <p role="status" className="text-justify text-sm" data-setup-payments>{setupCount > 1 ? `${setupCount} encaissements reçus` : '1 encaissement reçu'} depuis la vérification ({money(view.setupPayments?.receivedMinor ?? 0)}). Ils sont comptés dans la caisse attendue et seront répartis à l’activation : rien n’est à refaire.</p>}
        {run && !run.stale && run.status === 'BLOCKED' && <p className="text-justify text-sm" data-blocked-help>Chaque écriture ci-dessous doit être justifiée : par une preuve Acadéa (reçu ou paie liée) si elle existe, sinon par un motif écrit, avec une photo si vous en avez une. Quand tout est justifié, cliquez sur « Vérifier à nouveau ».</p>}
        {evidenceOpen && <div className="grid gap-2 rounded border p-3 text-sm" aria-label="Pièces examinées"><p>{blockedOnly ? 'Écritures à justifier.' : 'Vérifier une ancienne écriture ne l’affecte pas à une rubrique et ne valide pas le solde.'}</p>
          {rows.map(row => <article key={row.collection + '/' + row.id} className="rounded border p-2"><p className="font-semibold">{label(row)}</p><p>{row.reason ?? 'Pièce vérifiée'}</p>{row.reason && <button className="secondary-button mt-2" type="button" disabled={fieldsLocked} onClick={() => void findProofs(row)}>Justifier</button>}</article>)}
          {!rows.length && <p>Aucune pièce {blockedOnly ? 'à justifier ' : ''}dans cette page.</p>}
          <div className="flex flex-wrap gap-2">{!blockedOnly && (view.evidencePage?.page ?? 0) > 0 && <Action busy={busy && actionBusy === 'previous'} disabled={fieldsLocked} onClick={() => void refresh(view.evidencePage!.page - 1, false, 'previous')}>Pièces précédentes</Action>}{view.evidencePage?.hasNext && <Action busy={busy && actionBusy === 'next'} disabled={fieldsLocked} onClick={() => void refresh(view.evidencePage!.page + 1, blockedOnly, 'next')}>Pièces suivantes</Action>}</div>
        </div>}
        {proofSource && <fieldset className="grid gap-2 rounded border p-3 text-justify text-sm" disabled={fieldsLocked} aria-label="Justifier une écriture"><legend>Justifier : {proofSource.nature}</legend><p>{label(proofSource)}</p><p>{proofSource.reason}</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Type de justification">
            <label className="inline-flex items-center gap-2"><input type="radio" name="proof-mode" checked={proofMode === 'proof'} onChange={() => setProofMode('proof')}/>Preuve Acadéa</label>
            <label className="inline-flex items-center gap-2"><input type="radio" name="proof-mode" checked={proofMode === 'declaration'} onChange={() => setProofMode('declaration')}/>Motif écrit</label>
          </div>
          {proofMode === 'proof' ? <>
            <p>Choisissez un reçu ou une paie enregistrés par Acadéa. Le montant, la date et l’élève seront contrôlés.</p>
            {actionBusy === 'proof-search' && busy && <p role="status">Chargement...</p>}
            <label>Preuve<select className="input" value={proofSelected} onChange={e => setProofSelected(e.target.value)}><option value="">Choisir une preuve</option>{proofs.map(p => <option key={p.type + '/' + p.id} value={p.type + '/' + p.id}>{p.nature} · {readableDate(p.createdAt)} · {p.currency ? formatCurrencyMoney(p.amount, p.currency) : 'Devise non justifiée'}{p.receiptNumber ? ' · reçu ' + p.receiptNumber : ''}</option>)}</select></label>
            {!proofs.length && !busy && <p>Aucune preuve Acadéa trouvée pour cette écriture. Choisissez « Motif écrit ».</p>}
            {proofCursor && <Action busy={busy && actionBusy === 'proof-search'} onClick={() => void findProofs(proofSource, proofCursor)}>Rechercher d’autres preuves</Action>}
            <label>Motif de justification<textarea className="input" maxLength={500} value={proofReason} onChange={e => setProofReason(e.target.value)}/></label>
            <Action busy={busy && actionBusy === 'justify-history'} disabled={!proofSelected || proofReason.trim().length < 10} onClick={() => { const p = proofs.find(p => p.type + '/' + p.id === proofSelected); if (p) void mutate('justify-history', { collection: proofSource.collection, sourceId: proofSource.id, evidenceType: p.type, evidenceId: p.id, reason: proofReason }); }}>Vérifier la preuve</Action>
          </> : <>
            <p>Expliquez d’où vient cette écriture (par exemple : ancien cahier de caisse, reçu papier n° 12). Votre motif est gardé dans l’historique ; le montant ne change pas.</p>
            <label>Motif écrit (10 caractères au moins)<textarea className="input" maxLength={500} value={proofReason} onChange={e => setProofReason(e.target.value)} data-declaration-reason/></label>
            {!proofSource.currency && <label>Devise de l’écriture<select className="input" value={declarationCurrency} onChange={e => setDeclarationCurrency(e.target.value)}><option value="">Choisir la devise</option><option value="USD">Dollar (USD)</option><option value="CDF">Franc congolais (CDF)</option></select></label>}
            <label>Photo de la pièce (facultative)<input className="input" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={e => setPhoto(e.target.files?.[0] ?? null)} data-declaration-photo/></label>
            {photo && proofPhotoProblem(photo) && <p role="alert" className="text-red-700">{proofPhotoProblem(photo)}</p>}
            <Action busy={busy && actionBusy === 'justify-history'} disabled={!reasonReady(proofReason) || (!proofSource.currency && !declarationCurrency) || (!!photo && !!proofPhotoProblem(photo))} onClick={() => void submitDeclaration()}>Enregistrer la justification</Action>
          </>}
          <button className="secondary-button" type="button" onClick={() => setProofSource(null)}>Fermer la justification</button>
        </fieldset>}
        {view.emptyHistory && (!opening || opening.stale) && <fieldset disabled={fieldsLocked} className="grid gap-2 rounded border p-3 text-justify text-sm" data-empty-history><legend>Activer</legend>
          <p>Aucun paiement, aucune dépense et aucune autre entrée ne sont enregistrés cette année : il n’y a rien à vérifier ni à partager. Toutes les rubriques partent de zéro.</p>
          <PhraseField phrase={activationPhrase} value={confirmation} onChange={setConfirmation} disabled={fieldsLocked}/>
          {primary('activate-without-history', 'Activer la répartition', () => void mutate('activate-without-history', { confirmation }), confirmation !== activationPhrase)}
        </fieldset>}
        {view.inventory && plan2 && !view.emptyHistory && (!opening || opening.stale) && <fieldset disabled={fieldsLocked} className="grid gap-3 rounded border p-3 text-justify text-sm" data-opening-form><legend>Valider le solde de départ</legend>
          <p>Fonds scolaires justifiés (frais encaissés moins dépenses) : <strong>{money(view.inventory.schoolAvailableMinor)}</strong>.</p>
          {plan2.deficit && <div className="grid gap-2 rounded border border-amber-200 bg-amber-50 p-2" data-deficit><p>Les dépenses dépassent les frais encaissés de {money(-view.inventory.schoolAvailableMinor)}. Cette différence ira en négatif dans « Non affecté » ; les prochains encaissements la combleront. Les rubriques partent de zéro.</p>
            <label>Motif (obligatoire, 10 caractères au moins)<textarea className="input" maxLength={500} value={deficitReason} onChange={e => setDeficitReason(e.target.value)}/></label></div>}
          <p>Caisse attendue : <strong>{money(cashExpected)}</strong>{setupCount > 0 ? `, dont ${money(view.setupPayments?.receivedMinor ?? 0)} reçus depuis la vérification` : ''}{otherMinor > 0 ? `. Elle comprend ${money(otherMinor)} d’autres entrées, qui restent hors répartition` : ''}.</p>
          <label>Caisse comptée ({view.currency})<input className="input" inputMode="decimal" value={cash} onChange={e => setCash(e.target.value)} data-cash-count/></label>
          {plan2.needsCashGapReason && plan2.cashGapMinor !== null && <div className="grid gap-2 rounded border border-amber-200 bg-amber-50 p-2" data-cash-gap><p>{plan2.cashGapMinor < 0 ? `Manque en caisse : ${money(-plan2.cashGapMinor)}` : `Surplus en caisse : ${money(plan2.cashGapMinor)}`}. L’écart ira dans « Non affecté » et restera dans l’historique.</p>
            <label>Motif de l’écart (obligatoire, 10 caractères au moins)<textarea className="input" maxLength={500} value={cashGapReason} onChange={e => setCashGapReason(e.target.value)}/></label></div>}
          {!plan2.deficit && <div className="grid gap-2"><p>Partagez les fonds scolaires justifiés entre les rubriques.</p>{view.rubrics.map(r => <label key={r.id}>Ouverture : {r.name} ({view.currency})<input className="input" inputMode="decimal" value={amounts[r.id] ?? ''} onChange={e => setAmounts(a => ({ ...a, [r.id]: e.target.value }))}/></label>)}</div>}
          <p data-unallocated>Non affecté (le reste, calculé automatiquement) : <strong>{money(plan2.unallocatedMinor)}</strong></p>
          {plan2.needsUnallocatedReason && <label>Justification de « Non affecté » (obligatoire, 10 caractères au moins)<textarea className="input" maxLength={500} value={unallocatedReason} onChange={e => setUnallocatedReason(e.target.value)} data-unallocated-reason/></label>}
          {plan2.error && <p role="alert" className="text-red-700">{plan2.error}</p>}
          <div className="grid gap-1 rounded border p-2" data-opening-recap><p className="font-semibold">Récapitulatif</p>
            {view.rubrics.map(r => <p key={r.id}>{r.name} : {money(plan2.lines.find(l => l.rubricId === r.id)?.amountMinor ?? 0)}</p>)}
            <p>Non affecté : {money(plan2.unallocatedMinor + (plan2.cashGapMinor ?? 0))}{plan2.cashGapMinor ? ` (dont écart de caisse ${money(plan2.cashGapMinor)})` : ''}</p></div>
          <PhraseField phrase={VALIDATE_OPENING_PHRASE} value={confirmation} onChange={setConfirmation} disabled={fieldsLocked}/>
          {primary('validate-opening', 'Valider le solde de départ', () => void submitOpening(), !openingReady)}
        </fieldset>}
        {view.inventory && opening && !opening.stale && <fieldset disabled={fieldsLocked} className="grid gap-2 rounded border p-3 text-justify text-sm" data-opening-summary><legend>Solde de départ {opening.status === 'approved' ? 'validé' : 'proposé'} — école pas encore active</legend>
          {opening.lines.map(l => <p key={l.rubricId}>{view.rubrics.find(r => r.id === l.rubricId)?.name ?? 'Non affecté'} : {money(l.amountMinor)}</p>)}
          {!!opening.cashGapMinor && <p>Écart de caisse déclaré : {money(opening.cashGapMinor)} (ajouté à « Non affecté »).</p>}
          {opening.status === 'proposed' ? <>
            <PhraseField phrase="APPROUVER LE RAPPROCHEMENT" value={confirmation} onChange={setConfirmation} disabled={fieldsLocked}/>
            {primary('approve-opening', 'Approuver le solde de départ', () => void mutate('approve-opening', { openingId: opening.id, confirmation }), confirmation !== 'APPROUVER LE RAPPROCHEMENT')}
          </> : <>
            {!opening.approvedByCurrentUser && <p role="alert">Seul l’administrateur qui a validé le solde peut activer.</p>}
            <PhraseField phrase={activationPhrase} value={confirmation} onChange={setConfirmation} disabled={fieldsLocked}/>
            {primary('activate', 'Activer la répartition', () => void mutate('activate', { openingId: opening.id, confirmation }), confirmation !== activationPhrase || !opening.approvedByCurrentUser)}
          </>}
          <button className="secondary-button justify-self-start" type="button" disabled={fieldsLocked} onClick={() => setCancelOpen(v => !v)} data-cancel-opening>Annuler ce solde</button>
          {cancelOpen && <div className="grid gap-2 rounded border border-amber-200 bg-amber-50 p-2"><p>Le solde sera annulé ; vous pourrez en saisir un nouveau. Rien n’est encore réparti.</p>
            <PhraseField phrase={CANCEL_OPENING_PHRASE} value={cancelPhrase} onChange={setCancelPhrase} disabled={fieldsLocked}/>
            <Action busy={busy && actionBusy === 'cancel-opening'} disabled={fieldsLocked || cancelPhrase !== CANCEL_OPENING_PHRASE} className="secondary-button justify-self-start" onClick={() => void mutate('cancel-opening', { openingId: opening.id, confirmation: cancelPhrase })}>Confirmer l’annulation</Action></div>}
        </fieldset>}
        <details className="text-sm"><summary className="cursor-pointer">Voir les étapes d’activation</summary><ActivationSteps /><p className="mt-2">Avant « Activer la répartition » : {missing}</p><p>Une configuration publiée ou un solde validé n’est pas une activation.</p></details>
        <AllocationJustifications load={loadJustifications} />
        {!!view.versions.length && <details className="text-sm"><summary>Voir les configurations</summary>{view.versions.map(v => <p key={v.id}>{workspace.fees.find(f => f.id === v.feeTypeId)?.name ?? 'Frais historique'} — {workspace.fees.find(f => f.id === v.feeTypeId)?.className} · version {v.version} · {v.status === 'published' ? 'publiée' : 'préparée'}</p>)}</details>}
        {!!run?.pageCount && <Action busy={busy && actionBusy === 'evidence'} disabled={fieldsLocked} className="secondary-button justify-self-start" onClick={() => { setEvidenceOpen(v => !v); if (!evidenceOpen && blockedOnly) void refresh(0, false, 'evidence'); }}>{evidenceOpen ? 'Masquer les pièces' : 'Voir les pièces vérifiées'}</Action>}
      </> : <>
        {actionRow(planCount ? primary('publish-all', planCount > 1 ? `Publier les nouveaux frais (${planCount} classes)` : 'Publier le nouveau frais', () => void publishAll(), socialMissing) : null)}
        {planBlock}
        {plan.locked > 0 && !planCount && <p className="text-justify text-sm" data-draft-locked>{DRAFT_LOCKED_TEXT}</p>}
        <AllocationJustifications load={loadJustifications} />
        {planCount > 0 && <p className="text-justify text-sm">La publication explicite concernera uniquement les nouveaux encaissements confirmés ensuite. Les anciens paiements et le solde de départ restent inchangés.</p>}
        {view.status === 'PAUSED' && <><button className="secondary-button justify-self-start" type="button" disabled={fieldsLocked} onClick={() => setPauseForm(v => !v)}>Reprendre la répartition</button>{pauseForm && <fieldset className="grid gap-2" disabled={fieldsLocked}><label>Motif audité<textarea className="input" value={reason} maxLength={500} onChange={e => setReason(e.target.value)}/></label><Action busy={busy && actionBusy === 'resume'} disabled={reason.trim().length < 5} onClick={() => void mutate('resume', { reason })}>Confirmer la reprise</Action></fieldset>}</>}
      </>}
    </>}
  </section>;
}
