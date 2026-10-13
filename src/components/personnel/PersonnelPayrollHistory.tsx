import { useEffect, useRef, useState } from "react";
import { Download, Edit3 } from "lucide-react";
import { MoneyInput } from "../ui";
import { listPayrollHistoryPage, updatePersonnelPayment, type PayrollHistoryCursor, type PayrollHistoryEntry } from "../../services/personnelPayroll";
import { formatCurrencyMoney } from "../../utils/currency";
import { printPersonnelPaymentPdf } from "../../utils/personnelPayrollPdf";
import type { School } from "../../types";

const months = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

export function PersonnelPayrollHistory({ schoolId = "", schools = [], refreshToken = 0, allowEdit = false, startDate = "", endDate = "" }: { schoolId?: string; schools?: School[]; refreshToken?: number; allowEdit?: boolean; startDate?: string; endDate?: string }) {
  const [payments, setPayments] = useState<PayrollHistoryEntry[]>([]);
  const [cursor, setCursor] = useState<PayrollHistoryCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [editTarget, setEditTarget] = useState<PayrollHistoryEntry | null>(null);
  const [nextAmount, setNextAmount] = useState("");
  const [deduction, setDeduction] = useState("");
  const [deductionReason, setDeductionReason] = useState("");
  const [cnss, setCnss] = useState("");
  const [tax, setTax] = useState("");
  const [description, setDescription] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [periodMonth, setPeriodMonth] = useState(1);
  const [periodYear, setPeriodYear] = useState(2026);
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
    setEditTarget(payment); setNextAmount(String(payment.amount)); setDeduction(String(payment.deduction ?? 0)); setDeductionReason(payment.deductionReason ?? "");
    setCnss(String(payment.cnss ?? 0)); setTax(String(payment.tax ?? 0)); setDescription(payment.description ?? ""); setPaidAt(payment.paidAt);
    setPeriodMonth(payment.periodMonth ?? 1); setPeriodYear(payment.periodYear ?? 2026); setReason(""); setConfirmation(""); setFeedback("");
  }

  async function saveEdit() {
    if (!allowEdit || !editTarget || busyId) return;
    const expected = editTarget.kind === "salary" ? "MODIFIER CE SALAIRE" : "MODIFIER CETTE PRIME";
    const net = Number(nextAmount) - Number(editTarget.recoveredAmount ?? 0) - Number(deduction || 0) - Number(cnss || 0) - Number(tax || 0);
    if (confirmation !== expected || !reason.trim() || !paidAt || !Number.isFinite(net) || net <= 0 || Number(deduction || 0) > 0 && !deductionReason.trim()) return;
    setBusyId(editTarget.id); setFeedback("");
    try {
      const changes = { amount: Number(nextAmount), deduction: Number(deduction || 0), deductionReason: deductionReason.trim(), cnss: Number(cnss || 0), tax: Number(tax || 0),
        description: description.trim(), paidAt, periodMonth, periodYear };
      const signature = JSON.stringify([editTarget.id, changes, reason.trim(), confirmation, editTarget.updatedAt ?? editTarget.createdAt]);
      if (correctionAttempt.current?.signature !== signature) correctionAttempt.current = { signature, requestId: crypto.randomUUID() };
      const updated = await updatePersonnelPayment({ paymentId: editTarget.id, ...changes, reason: reason.trim(), confirmation, expectedUpdatedAt: editTarget.updatedAt ?? editTarget.createdAt, clientRequestId: correctionAttempt.current.requestId });
      setPayments((items) => items.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
      correctionAttempt.current = null;
      setEditTarget(null); setFeedback("Modification enregistrée. Le bulletin et les montants ont été actualisés.");
    } catch (cause) { setFeedback(cause instanceof Error ? cause.message : "Modification impossible."); }
    finally { setBusyId(""); }
  }

  useEffect(() => {
    const id = ++requestId.current;
    setPayments([]); setCursor(null); setLoading(true); setError("");
    void listPayrollHistoryPage(schoolId, undefined, { startDate, endDate }).then((page) => {
      if (requestId.current === id) { setPayments(page.payments); setCursor(page.nextCursor); }
    }).catch((cause) => {
      if (requestId.current === id) setError(cause instanceof Error ? cause.message : "Historique indisponible.");
    }).finally(() => { if (requestId.current === id) setLoading(false); });
    return () => { requestId.current = id + 1; };
  }, [schoolId, startDate, endDate, refreshToken]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    const id = requestId.current;
    setLoadingMore(true); setError("");
    try {
      const page = await listPayrollHistoryPage(schoolId, cursor, { startDate, endDate });
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
    {payments.map((payment) => <article key={payment.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded border border-slate-200 p-3 text-sm">
      <div className="grid min-w-0 gap-1 break-words">
        <strong>{payment.kind === "salary" ? "Salaire" : "Prime"} — {payment.beneficiaryName || "Bénéficiaire non renseigné"}</strong>
        <span>École : {schools.find((school) => school.id === payment.schoolId)?.name ?? payment.schoolId}</span>
        <span>Net payé : {typeof payment.netPaid === "number" ? formatCurrencyMoney(payment.netPaid, payment.currency) : "Non renseigné"} · Date : {payment.paidAt || "Non renseignée"}</span>
        <span>Période : {payment.periodMonth && payment.periodYear ? `${String(payment.periodMonth).padStart(2, "0")}/${payment.periodYear}` : "Non renseignée"} · Référence : {payment.reference || "Non renseignée"}</span>
      </div>
      <div className="flex shrink-0 flex-nowrap items-center gap-1 sm:gap-2">
        {allowEdit && <button type="button" title="Modifier le paiement du personnel" aria-label={`Modifier ${payment.kind === "salary" ? "le salaire" : "la prime"} ${payment.reference}`} className="rounded bg-slate-100 p-2 text-slate-700 disabled:opacity-50" disabled={Boolean(busyId)} onClick={() => openEdit(payment)}><Edit3 className="h-4 w-4" /></button>}
        <button type="button" title="Télécharger le bulletin PDF" aria-label={`Télécharger le bulletin PDF ${payment.reference}`} className="rounded bg-slate-100 p-2 text-slate-700 disabled:opacity-50" disabled={busyId === payment.id || !canPrint(payment)} onClick={() => void download(payment)}><Download className="h-4 w-4" /></button>
      </div>
    </article>)}
    {editTarget && <div className="grid min-w-0 gap-3 rounded border border-slate-300 bg-white p-3 text-sm">
      <strong>Modifier {editTarget.kind === "salary" ? "le salaire" : "la prime"} — {editTarget.reference}</strong>
      <span>Bénéficiaire : {editTarget.beneficiaryName} · Fonction : {editTarget.beneficiaryJobTitle} · École : {schools.find((item) => item.id === editTarget.schoolId)?.name}</span>
      <span>Nature : {editTarget.kind === "salary" ? "Salaire" : "Prime"} · Référence : {editTarget.reference} · Devise : {editTarget.currency}</span>
      <div className="grid grid-cols-2 gap-2"><label className="grid gap-1">Mois concerné<select className="input min-w-0" value={periodMonth} onChange={(event) => setPeriodMonth(Number(event.target.value))}>{months.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</select></label><label className="grid gap-1">Année concernée<input className="input min-w-0" type="number" min="2000" max="2200" value={periodYear} onChange={(event) => setPeriodYear(Number(event.target.value))}/></label></div>
      <label className="grid gap-1">Date réelle du paiement<input className="input" type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} /></label>
      <label className="grid gap-1">{editTarget.kind === "salary" ? "Salaire brut" : "Prime brute"}<MoneyInput value={nextAmount} onChange={setNextAmount} /></label>
      <section className="grid gap-1 rounded border border-slate-200 p-3"><strong>Avances récupérées : {formatCurrencyMoney(editTarget.recoveredAmount, editTarget.currency)}</strong>{editTarget.recoveries.map((line) => <span key={line.advanceId}>{line.reference} — {formatCurrencyMoney(line.amount, editTarget.currency)}</span>)}<p className="text-xs text-slate-500">Les avances déjà imputées ne peuvent pas être modifiées sans réconciliation comptable.</p></section>
      <label className="grid gap-1">Autre retenue<MoneyInput value={deduction} onChange={setDeduction} /></label>
      {Number(deduction || 0) > 0 && <label className="grid gap-1">Motif de retenue<input className="input" value={deductionReason} onChange={(event) => setDeductionReason(event.target.value)} /></label>}
      <label className="grid gap-1">CNSS (saisie manuelle)<MoneyInput value={cnss} onChange={setCnss} /></label>
      <label className="grid gap-1">Impôt (saisie manuelle)<MoneyInput value={tax} onChange={setTax} /></label>
      <label className="grid gap-1">Description<textarea className="input min-h-20" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <strong>Net à payer : {formatCurrencyMoney(Number(nextAmount || 0) - Number(editTarget.recoveredAmount ?? 0) - Number(deduction || 0) - Number(cnss || 0) - Number(tax || 0), editTarget.currency)}</strong>
      <label className="grid gap-1">Raison obligatoire<textarea className="input" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <label className="grid gap-1">Saisissez exactement {editTarget.kind === "salary" ? "MODIFIER CE SALAIRE" : "MODIFIER CETTE PRIME"}<input className="input" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
      <div className="flex flex-wrap gap-2"><button type="button" className="primary-button justify-center" disabled={Boolean(busyId) || !reason.trim() || !paidAt || Number(nextAmount || 0) - Number(editTarget.recoveredAmount ?? 0) - Number(deduction || 0) - Number(cnss || 0) - Number(tax || 0) <= 0 || Number(deduction || 0) > 0 && !deductionReason.trim() || confirmation !== (editTarget.kind === "salary" ? "MODIFIER CE SALAIRE" : "MODIFIER CETTE PRIME")} onClick={() => void saveEdit()}>Enregistrer la modification</button><button type="button" className="secondary-button justify-center" onClick={() => setEditTarget(null)}>Annuler</button></div>
    </div>}
    {cursor && <button type="button" className="secondary-button w-full justify-center" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Chargement…" : "Charger plus"}</button>}
  </div>;
}
