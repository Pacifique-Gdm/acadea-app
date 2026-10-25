import { useEffect, useRef, useState, type FormEvent } from "react";
import { MoneyInput } from "../ui";
import { createPersonnelPayment, listPayrollAdvances, listPayrollPersonnel, loadPayrollCashBalance, PayrollCashError } from "../../services/personnelPayroll";
import type { PayrollBeneficiary, PayrollCashBalance } from "../../services/personnelPayroll";
import { printPersonnelPaymentPdf } from "../../utils/personnelPayrollPdf";
import { formatCurrencyMoney, resolveSchoolYearCurrency } from "../../utils/currency";
import { fromMoneyMinor, remainingMoney, sumMoney, toMoneyMinor } from "../../utils/money";
import type { PersonnelPayment, School, SchoolYear } from "../../types";
import { personnelJobTitleLabel } from "../../services/personnel";

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const months = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
function inputMinor(value: string) {
  if (value && !/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  try { return toMoneyMinor(Number(value || 0)); } catch { return null; }
}

export function PersonnelPaymentForm({ school, year, onRecorded }: { school: School; year: SchoolYear; onRecorded?: (payment: PersonnelPayment) => void }) {
  const [personnel, setPersonnel] = useState<PayrollBeneficiary[]>([]);
  const [beneficiaryId, setBeneficiaryId] = useState("");
  const [kind, setKind] = useState<PersonnelPayment["kind"]>("salary");
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [periodYear, setPeriodYear] = useState(new Date().getFullYear());
  const [paidAt, setPaidAt] = useState(today());
  const [gross, setGross] = useState("");
  const [deduction, setDeduction] = useState("");
  const [deductionReason, setDeductionReason] = useState("");
  const [cnss, setCnss] = useState("");
  const [tax, setTax] = useState("");
  const [description, setDescription] = useState("");
  const [advances, setAdvances] = useState<PersonnelPayment[]>([]);
  const [recoveries, setRecoveries] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastPayment, setLastPayment] = useState<PersonnelPayment>();
  const [cashBalance, setCashBalance] = useState<PayrollCashBalance>();
  const [cashLoading, setCashLoading] = useState(true);
  const [cashError, setCashError] = useState("");
  const attempt = useRef<{ signature: string; id: string } | null>(null);
  const busyRef = useRef(false);
  const currency = resolveSchoolYearCurrency(year, school);
  const format = (value: number) => formatCurrencyMoney(value, currency);
  useEffect(() => {
    let active = true;
    void listPayrollPersonnel().then((items) => { if (active) setPersonnel(items); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Personnel indisponible."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    setCashBalance(undefined); setCashLoading(true); setCashError("");
    void loadPayrollCashBalance(year.id).then((balance) => {
      if (!active) return;
      if (balance.schoolId !== school.id || balance.currency !== currency) throw new Error("La caisse ne correspond pas à cet établissement ou à cette devise.");
      setCashBalance(balance);
    }).catch((cause) => { if (active) setCashError(cause instanceof Error ? cause.message : "Solde de caisse indisponible."); })
      .finally(() => { if (active) setCashLoading(false); });
    return () => { active = false; };
  }, [currency, school.id, year.id]);
  useEffect(() => {
    if (!beneficiaryId) { setAdvances([]); setRecoveries({}); return; }
    let active = true;
    setRecoveries({});
    void listPayrollAdvances(beneficiaryId).then((items) => { if (active) setAdvances(items); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Avances indisponibles."); });
    return () => { active = false; };
  }, [beneficiaryId]);

  const grossCents = inputMinor(gross);
  const deductionCents = inputMinor(deduction), cnssCents = inputMinor(cnss), taxCents = inputMinor(tax);
  const recoveryAmounts = Object.values(recoveries).map((value) => value.trim() ? inputMinor(value) : null);
  const validAmounts = grossCents !== null && (kind === "advance" || deductionCents !== null && cnssCents !== null && taxCents !== null
    && recoveryAmounts.every((value) => value !== null));
  const recoveryCents = kind === "advance" ? 0 : recoveryAmounts.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const recoveryTotal = Number.isSafeInteger(recoveryCents) ? fromMoneyMinor(recoveryCents) : 0;
  const netCents = validAmounts && Number.isSafeInteger(recoveryCents) ? grossCents! - recoveryCents - (kind === "advance" ? 0 : deductionCents! + cnssCents! + taxCents!) : 0;
  const net = fromMoneyMinor(netCents);
  const availableCents = cashBalance?.availableCents;
  const shortfallCents = availableCents === undefined ? 0 : Math.max(netCents - availableCents, 0);
  const cashInsufficient = availableCents !== undefined && (availableCents < 0 || shortfallCents > 0);
  const validNet = validAmounts && Number.isSafeInteger(netCents) && netCents > 0;
  const recoverable = sumMoney(advances.filter((item) => item.currency === currency).map((item) => remainingMoney(item.amount, item.recoveredAmount)));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    setError(""); setLastPayment(undefined);
    if (!beneficiaryId || !paidAt || !gross || !validNet || kind !== "advance" && Number(deduction || 0) > 0 && !deductionReason.trim()) { setError("Complétez le bénéficiaire, la date, le montant et le motif de toute retenue."); return; }
    if (!cashBalance || cashBalance.schoolId !== school.id || cashBalance.currency !== currency) { setError("Solde de caisse indisponible : paiement bloqué."); return; }
    if (cashInsufficient) { setError("Paiement impossible : solde de caisse insuffisant."); return; }
    const lines = kind === "advance" ? [] : Object.entries(recoveries).filter(([, amount]) => Number(amount) > 0).map(([advanceId, amount]) => ({ advanceId, amount: Number(amount) }));
    if (lines.some((line) => { const advance = advances.find((item) => item.id === line.advanceId); return !advance || advance.currency !== currency || toMoneyMinor(line.amount) > toMoneyMinor(remainingMoney(advance.amount, advance.recoveredAmount)); })) { setError("Une récupération dépasse le solde de l'avance ou utilise une autre devise."); return; }
    const draft = { schoolYearId: year.id, beneficiaryId, kind, ...(kind === "advance" ? {} : { periodMonth: month, periodYear }), paidAt, amount: Number(gross), recoveries: lines,
      deduction: kind === "advance" ? 0 : Number(deduction || 0), deductionReason: kind === "advance" ? "" : deductionReason.trim(), cnss: kind === "advance" ? 0 : Number(cnss || 0), tax: kind === "advance" ? 0 : Number(tax || 0), description: description.trim() };
    const signature = JSON.stringify(draft);
    const clientRequestId = attempt.current?.signature === signature ? attempt.current.id : crypto.randomUUID();
    attempt.current = { signature, id: clientRequestId };
    busyRef.current = true; setBusy(true);
    try {
      const latestBalance = await loadPayrollCashBalance(year.id);
      if (latestBalance.schoolId !== school.id || latestBalance.currency !== currency) throw new Error("La caisse ne correspond pas à cet établissement ou à cette devise.");
      if (latestBalance.availableCents !== cashBalance.availableCents) {
        setCashBalance(latestBalance);
        setError("Le solde de caisse a changé. Vérifiez les nouveaux montants avant de confirmer à nouveau.");
        return;
      }
      const payment = await createPersonnelPayment({ ...draft, clientRequestId });
      attempt.current = null;
      setCashLoading(true);
      void loadPayrollCashBalance(year.id).then((updated) => { setCashBalance(updated); setCashError(""); })
        .catch(() => { setCashBalance(undefined); setCashError("Solde de caisse indisponible après paiement. Actualisez avant toute nouvelle opération."); })
        .finally(() => setCashLoading(false));
      setLastPayment(onRecorded ? undefined : payment);
      setBeneficiaryId(""); setKind("salary"); setMonth(new Date().getMonth() + 1); setPeriodYear(new Date().getFullYear()); setPaidAt(today());
      setGross(""); setDeduction(""); setDeductionReason(""); setCnss(""); setTax(""); setDescription(""); setAdvances([]); setRecoveries({});
      onRecorded?.(payment);
    } catch (cause) {
      if (cause instanceof PayrollCashError && cause.balance && cause.balance.schoolId === school.id && cause.balance.currency === currency) setCashBalance(cause.balance);
      if (cause instanceof PayrollCashError && ["cash-balance-unavailable", "cash-balance-inconsistent"].includes(cause.code)) setCashBalance(undefined);
      if (cause instanceof PayrollCashError && cause.code === "cash-balance-conflict") {
        setCashLoading(true);
        void loadPayrollCashBalance(year.id).then((updated) => { setCashBalance(updated); setCashError(""); })
          .catch(() => { setCashBalance(undefined); setCashError("Solde de caisse indisponible : paiement bloqué."); })
          .finally(() => setCashLoading(false));
      }
      setError(cause instanceof Error ? cause.message : "Paiement impossible.");
    }
    finally { busyRef.current = false; setBusy(false); }
  }

  return <form className="grid min-w-0 gap-3 text-sm" onSubmit={(event) => void submit(event)}>
    {loading && <p role="status">Chargement du personnel…</p>}
    <label className="grid gap-1 font-semibold">Bénéficiaire<select className="input min-w-0" value={beneficiaryId} onChange={(event) => setBeneficiaryId(event.target.value)}><option value="">Choisir un personnel</option>{personnel.map((item) => <option key={item.id} value={item.id}>{item.name} — {personnelJobTitleLabel(item.jobTitle, item.hasAccount)}</option>)}</select></label>
    <label className="grid gap-1 font-semibold">Nature<select className="input" value={kind} onChange={(event) => { setKind(event.target.value as PersonnelPayment["kind"]); setRecoveries({}); }}><option value="salary">Salaire</option><option value="bonus">Prime</option><option value="advance">Versement d'une avance</option></select></label>
    {kind !== "advance" && <div className="grid grid-cols-2 gap-2"><label className="grid gap-1 font-semibold">Mois concerné<select className="input min-w-0" value={month} onChange={(event) => setMonth(Number(event.target.value))}>{months.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select></label><label className="grid gap-1 font-semibold">Année concernée<input className="input min-w-0" type="number" min="2000" max="2200" value={periodYear} onChange={(event) => setPeriodYear(Number(event.target.value))}/></label></div>}
    <label className="grid gap-1 font-semibold">Date réelle du paiement<input className="input" type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)}/></label>
    <label className="grid gap-1 font-semibold">{kind === "advance" ? "Avance versée" : kind === "salary" ? "Salaire brut" : "Prime brute"}<MoneyInput value={gross} onChange={setGross}/></label>
    {kind !== "advance" && <>
      <section className="grid gap-2 rounded border border-slate-200 p-3"><h3 className="font-semibold">Avances récupérables : {format(recoverable)}</h3>{advances.map((advance) => <div key={advance.id} className="grid min-w-0 gap-2 border-t pt-2"><label className="flex items-start gap-2"><input type="checkbox" checked={recoveries[advance.id] !== undefined} disabled={advance.currency !== currency} onChange={(event) => setRecoveries((current) => { const next = { ...current }; if (event.target.checked) next[advance.id] = String(remainingMoney(advance.amount, advance.recoveredAmount)); else delete next[advance.id]; return next; })}/><span>{advance.reference} — {advance.paidAt} — solde {formatCurrencyMoney(remainingMoney(advance.amount, advance.recoveredAmount), advance.currency)}{advance.currency !== currency ? " (devise incompatible)" : ""}</span></label>{recoveries[advance.id] !== undefined && <label className="grid gap-1">Montant à récupérer<MoneyInput value={recoveries[advance.id]} onChange={(value) => setRecoveries((current) => ({ ...current, [advance.id]: value }))}/></label>}</div>)}{advances.length === 0 && <p>Aucune avance récupérable.</p>}</section>
      <label className="grid gap-1 font-semibold">Autre retenue<MoneyInput value={deduction} onChange={setDeduction}/></label>
      {Number(deduction || 0) > 0 && <label className="grid gap-1 font-semibold">Motif de retenue<input className="input" value={deductionReason} onChange={(event) => setDeductionReason(event.target.value)}/></label>}
      <label className="grid gap-1 font-semibold">CNSS (saisie manuelle)<MoneyInput value={cnss} onChange={setCnss}/></label>
      <label className="grid gap-1 font-semibold">Impôt (saisie manuelle)<MoneyInput value={tax} onChange={setTax}/></label>
      <p>Total des avances récupérées : {format(recoveryTotal)}</p>
    </>}
    <label className="grid gap-1 font-semibold">Description<textarea className="input min-h-20" value={description} onChange={(event) => setDescription(event.target.value)}/></label>
    <strong>Net à payer : {format(net)}</strong>
    <section className="grid min-w-0 gap-2 rounded border border-slate-200 bg-slate-50 p-3" aria-label="Solde de caisse">
      <p className="font-semibold">Caisse de l'établissement · {currency}</p>
      {cashLoading ? <p role="status">Chargement du solde disponible…</p> : cashError ? <p role="alert" className="text-red-700">{cashError}</p> : cashBalance ? <>
        <p>Solde disponible : <strong>{format(cashBalance.availableCents / 100)}</strong></p>
        <p>Montant net à décaisser : <strong>{format(net)}</strong></p>
        <p>Solde après paiement : <strong>{format((cashBalance.availableCents - netCents) / 100)}</strong></p>
        {cashInsufficient && <p role="alert" className="rounded bg-red-50 p-2 text-red-700">Paiement impossible : solde de caisse insuffisant. Montant manquant : {format(shortfallCents / 100)}. Veuillez approvisionner la caisse ou corriger le paiement.</p>}
      </> : <p role="alert" className="text-red-700">Solde de caisse indisponible : paiement bloqué.</p>}
    </section>
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{error}</p>}
    {lastPayment && <div role="status" className="grid gap-2 rounded bg-green-50 p-3 text-green-800"><span>Paiement enregistré : {lastPayment.reference}</span><button className="secondary-button justify-center" type="button" onClick={() => void printPersonnelPaymentPdf(lastPayment, school)}>{lastPayment.kind === "advance" ? "Télécharger le justificatif" : "Télécharger le bulletin de paie"}</button></div>}
    <button type="submit" disabled={busy || loading || cashLoading || !cashBalance || cashInsufficient || !beneficiaryId || !validNet} className="primary-button justify-center">{busy ? "Enregistrement…" : "Enregistrer le paiement personnel"}</button>
  </form>;
}
