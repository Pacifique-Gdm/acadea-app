import { useEffect, useRef, useState } from "react";
import { Download, Edit3 } from "lucide-react";
import { listPayrollHistoryPage, updatePersonnelPayment, type PayrollHistoryCursor, type PayrollHistoryEntry } from "../../services/personnelPayroll";
import { formatCurrencyMoney } from "../../utils/currency";
import { printPersonnelPaymentPdf } from "../../utils/personnelPayrollPdf";
import type { School } from "../../types";

export function PersonnelPayrollHistory({ schoolId = "", schools = [], refreshToken = 0, allowEdit = false }: { schoolId?: string; schools?: School[]; refreshToken?: number; allowEdit?: boolean }) {
  const [payments, setPayments] = useState<PayrollHistoryEntry[]>([]);
  const [cursor, setCursor] = useState<PayrollHistoryCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [editTarget, setEditTarget] = useState<PayrollHistoryEntry | null>(null);
  const [nextAmount, setNextAmount] = useState("");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [feedback, setFeedback] = useState("");
  const requestId = useRef(0);
  const correctionAttempt = useRef<{ signature: string; requestId: string } | null>(null);

  function canPrint(payment: PayrollHistoryEntry) {
    return Boolean(schools.some((school) => school.id === payment.schoolId)
      && payment.beneficiaryName && payment.beneficiaryJobTitle && payment.reference && payment.paidAt && payment.createdAt
      && payment.currency && Number.isFinite(payment.amount) && Number.isFinite(payment.netPaid)
      && Array.isArray(payment.recoveries) && Number.isFinite(payment.recoveredAmount)
      && Number.isFinite(payment.deduction) && Number.isFinite(payment.cnss) && Number.isFinite(payment.tax)
      && payment.periodMonth && payment.periodYear);
  }

  async function download(payment: PayrollHistoryEntry) {
    const school = schools.find((item) => item.id === payment.schoolId);
    if (!school || !canPrint(payment)) { setError("Bulletin indisponible : données historiques incomplètes ou école hors périmètre."); return; }
    setBusyId(payment.id); setError("");
    try { await printPersonnelPaymentPdf(payment, school); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Téléchargement du bulletin impossible."); }
    finally { setBusyId(""); }
  }

  function openEdit(payment: PayrollHistoryEntry) {
    correctionAttempt.current = null;
    setEditTarget(payment); setNextAmount(String(payment.amount)); setReason(""); setConfirmation(""); setFeedback("");
  }

  async function saveEdit() {
    if (!allowEdit || !editTarget || busyId) return;
    const expected = editTarget.kind === "salary" ? "MODIFIER CE SALAIRE" : "MODIFIER CETTE PRIME";
    if (confirmation !== expected || !reason.trim() || !Number.isFinite(Number(nextAmount)) || Number(nextAmount) <= 0) return;
    setBusyId(editTarget.id); setFeedback("");
    try {
      const signature = JSON.stringify([editTarget.id, nextAmount, reason.trim(), confirmation, editTarget.updatedAt ?? editTarget.createdAt]);
      if (correctionAttempt.current?.signature !== signature) correctionAttempt.current = { signature, requestId: crypto.randomUUID() };
      const updated = await updatePersonnelPayment({ paymentId: editTarget.id, amount: Number(nextAmount), reason: reason.trim(), confirmation, expectedUpdatedAt: editTarget.updatedAt ?? editTarget.createdAt, clientRequestId: correctionAttempt.current.requestId });
      setPayments((items) => items.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
      correctionAttempt.current = null;
      setEditTarget(null); setFeedback("Modification enregistrée. Le bulletin et les montants ont été actualisés.");
    } catch (cause) { setFeedback(cause instanceof Error ? cause.message : "Modification impossible."); }
    finally { setBusyId(""); }
  }

  useEffect(() => {
    const id = ++requestId.current;
    setPayments([]); setCursor(null); setLoading(true); setError("");
    void listPayrollHistoryPage(schoolId).then((page) => {
      if (requestId.current === id) { setPayments(page.payments); setCursor(page.nextCursor); }
    }).catch((cause) => {
      if (requestId.current === id) setError(cause instanceof Error ? cause.message : "Historique indisponible.");
    }).finally(() => { if (requestId.current === id) setLoading(false); });
    return () => { requestId.current = id + 1; };
  }, [schoolId, refreshToken]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    const id = requestId.current;
    setLoadingMore(true); setError("");
    try {
      const page = await listPayrollHistoryPage(schoolId, cursor);
      if (requestId.current === id) {
        setPayments((current) => [...current, ...page.payments.filter((item) => !current.some((existing) => existing.id === item.id))]);
        setCursor(page.nextCursor);
      }
    } catch (cause) { if (requestId.current === id) setError(cause instanceof Error ? cause.message : "Chargement impossible."); }
    finally { if (requestId.current === id) setLoadingMore(false); }
  }

  return <div className="grid min-w-0 gap-3">
    {loading && <p role="status">Chargement de l’historique Salaire/prime…</p>}
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {!loading && !error && payments.length === 0 && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucun salaire ou prime versé dans ce périmètre.</p>}
    {feedback && <p role="status" className="rounded bg-slate-50 p-3 text-sm">{feedback}</p>}
    {payments.map((payment) => <article key={payment.id} className="grid min-w-0 gap-1 rounded border border-slate-200 p-3 text-sm">
      <strong>{payment.kind === "salary" ? "Salaire" : "Prime"} — {payment.beneficiaryName || "Bénéficiaire non renseigné"}</strong>
      <span>École : {schools.find((school) => school.id === payment.schoolId)?.name ?? payment.schoolId}</span>
      <span>Net payé : {typeof payment.netPaid === "number" ? formatCurrencyMoney(payment.netPaid, payment.currency) : "Non renseigné"} · Date : {payment.paidAt || "Non renseignée"}</span>
      <span>Période : {payment.periodMonth && payment.periodYear ? `${String(payment.periodMonth).padStart(2, "0")}/${payment.periodYear}` : "Non renseignée"} · Référence : {payment.reference || "Non renseignée"}</span>
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" title="Télécharger le bulletin PDF" aria-label={`Télécharger le bulletin PDF ${payment.reference}`} className="rounded bg-slate-100 p-2 text-slate-700 disabled:opacity-50" disabled={busyId === payment.id || !canPrint(payment)} onClick={() => void download(payment)}><Download className="h-4 w-4" /></button>
        {allowEdit && <button type="button" title="Modifier le paiement du personnel" aria-label={`Modifier ${payment.kind === "salary" ? "le salaire" : "la prime"} ${payment.reference}`} className="rounded bg-slate-100 p-2 text-slate-700 disabled:opacity-50" disabled={Boolean(busyId)} onClick={() => openEdit(payment)}><Edit3 className="h-4 w-4" /></button>}
      </div>
    </article>)}
    {editTarget && <div className="grid min-w-0 gap-3 rounded border border-slate-300 bg-white p-3 text-sm">
      <strong>Modifier {editTarget.kind === "salary" ? "le salaire" : "la prime"} — {editTarget.reference}</strong>
      <span>Bénéficiaire : {editTarget.beneficiaryName} · École : {schools.find((item) => item.id === editTarget.schoolId)?.name}</span>
      <label className="grid gap-1">Ancien montant<input className="input" readOnly value={formatCurrencyMoney(editTarget.amount, editTarget.currency)} /></label>
      <label className="grid gap-1">Nouveau montant<input className="input" type="number" min="0.01" step="0.01" value={nextAmount} onChange={(event) => setNextAmount(event.target.value)} /></label>
      <label className="grid gap-1">Raison obligatoire<textarea className="input" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <label className="grid gap-1">Saisissez exactement {editTarget.kind === "salary" ? "MODIFIER CE SALAIRE" : "MODIFIER CETTE PRIME"}<input className="input" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
      <div className="flex flex-wrap gap-2"><button type="button" className="primary-button justify-center" disabled={Boolean(busyId) || !reason.trim() || !(Number(nextAmount) > 0) || confirmation !== (editTarget.kind === "salary" ? "MODIFIER CE SALAIRE" : "MODIFIER CETTE PRIME")} onClick={() => void saveEdit()}>Enregistrer la modification</button><button type="button" className="secondary-button justify-center" onClick={() => setEditTarget(null)}>Annuler</button></div>
    </div>}
    {cursor && <button type="button" className="secondary-button w-full justify-center" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Chargement…" : "Charger plus"}</button>}
  </div>;
}
