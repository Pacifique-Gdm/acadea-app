import { useEffect, useRef, useState, type FormEvent } from "react";
import { MoneyInput } from "../ui";
import { createPersonnelPayment, listPayrollAdvances, listPayrollPersonnel } from "../../services/personnelPayroll";
import type { PayrollBeneficiary } from "../../services/personnelPayroll";
import { printPersonnelPaymentPdf } from "../../utils/personnelPayrollPdf";
import { formatCurrencyMoney, resolveSchoolYearCurrency } from "../../utils/currency";
import type { PersonnelPayment, School, SchoolYear } from "../../types";

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const months = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

export function PersonnelPaymentForm({ school, year, onRecorded }: { school: School; year: SchoolYear; onRecorded?: () => void }) {
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
    if (!beneficiaryId) { setAdvances([]); setRecoveries({}); return; }
    let active = true;
    setRecoveries({});
    void listPayrollAdvances(beneficiaryId).then((items) => { if (active) setAdvances(items); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Avances indisponibles."); });
    return () => { active = false; };
  }, [beneficiaryId]);

  const recoveryTotal = kind === "advance" ? 0 : Object.values(recoveries).reduce((sum, value) => sum + Number(value || 0), 0);
  const net = Number(gross || 0) - recoveryTotal - (kind === "advance" ? 0 : Number(deduction || 0) + Number(cnss || 0) + Number(tax || 0));
  const recoverable = advances.filter((item) => item.currency === currency).reduce((sum, item) => sum + item.amount - item.recoveredAmount, 0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    setError(""); setLastPayment(undefined);
    if (!beneficiaryId || !paidAt || !gross || net <= 0 || kind !== "advance" && Number(deduction || 0) > 0 && !deductionReason.trim()) { setError("Complétez le bénéficiaire, la date, le montant et le motif de toute retenue."); return; }
    const lines = kind === "advance" ? [] : Object.entries(recoveries).filter(([, amount]) => Number(amount) > 0).map(([advanceId, amount]) => ({ advanceId, amount: Number(amount) }));
    if (lines.some((line) => { const advance = advances.find((item) => item.id === line.advanceId); return !advance || advance.currency !== currency || line.amount > advance.amount - advance.recoveredAmount; })) { setError("Une récupération dépasse le solde de l'avance ou utilise une autre devise."); return; }
    const draft = { schoolYearId: year.id, beneficiaryId, kind, ...(kind === "advance" ? {} : { periodMonth: month, periodYear }), paidAt, amount: Number(gross), recoveries: lines,
      deduction: kind === "advance" ? 0 : Number(deduction || 0), deductionReason: kind === "advance" ? "" : deductionReason.trim(), cnss: kind === "advance" ? 0 : Number(cnss || 0), tax: kind === "advance" ? 0 : Number(tax || 0), description: description.trim() };
    const signature = JSON.stringify(draft);
    const clientRequestId = attempt.current?.signature === signature ? attempt.current.id : crypto.randomUUID();
    attempt.current = { signature, id: clientRequestId };
    busyRef.current = true; setBusy(true);
    try {
      const payment = await createPersonnelPayment({ ...draft, clientRequestId });
      attempt.current = null;
      setLastPayment(payment); setGross(""); setDeduction(""); setDeductionReason(""); setCnss(""); setTax(""); setDescription(""); setRecoveries({});
      onRecorded?.();
      void listPayrollAdvances(beneficiaryId).then(setAdvances).catch(() => setError("Paiement enregistré, mais actualisation des avances impossible. Rouvrez le formulaire avant tout autre paiement."));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Paiement impossible."); }
    finally { busyRef.current = false; setBusy(false); }
  }

  return <form className="grid min-w-0 gap-3 text-sm" onSubmit={(event) => void submit(event)}>
    {loading && <p role="status">Chargement du personnel…</p>}
    <label className="grid gap-1 font-semibold">Bénéficiaire<select className="input min-w-0" value={beneficiaryId} onChange={(event) => setBeneficiaryId(event.target.value)}><option value="">Choisir un personnel</option>{personnel.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.jobTitle}</option>)}</select></label>
    <label className="grid gap-1 font-semibold">Nature<select className="input" value={kind} onChange={(event) => { setKind(event.target.value as PersonnelPayment["kind"]); setRecoveries({}); }}><option value="salary">Salaire</option><option value="bonus">Prime</option><option value="advance">Versement d'une avance</option></select></label>
    {kind !== "advance" && <div className="grid grid-cols-2 gap-2"><label className="grid gap-1 font-semibold">Mois concerné<select className="input min-w-0" value={month} onChange={(event) => setMonth(Number(event.target.value))}>{months.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select></label><label className="grid gap-1 font-semibold">Année concernée<input className="input min-w-0" type="number" min="2000" max="2200" value={periodYear} onChange={(event) => setPeriodYear(Number(event.target.value))}/></label></div>}
    <label className="grid gap-1 font-semibold">Date réelle du paiement<input className="input" type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)}/></label>
    <label className="grid gap-1 font-semibold">{kind === "advance" ? "Avance versée" : kind === "salary" ? "Salaire brut" : "Prime brute"}<MoneyInput value={gross} onChange={setGross}/></label>
    {kind !== "advance" && <>
      <section className="grid gap-2 rounded border border-slate-200 p-3"><h3 className="font-semibold">Avances récupérables : {format(recoverable)}</h3>{advances.map((advance) => <div key={advance.id} className="grid min-w-0 gap-2 border-t pt-2"><label className="flex items-start gap-2"><input type="checkbox" checked={recoveries[advance.id] !== undefined} disabled={advance.currency !== currency} onChange={(event) => setRecoveries((current) => { const next = { ...current }; if (event.target.checked) next[advance.id] = String(advance.amount - advance.recoveredAmount); else delete next[advance.id]; return next; })}/><span>{advance.reference} — {advance.paidAt} — solde {formatCurrencyMoney(advance.amount - advance.recoveredAmount, advance.currency)}{advance.currency !== currency ? " (devise incompatible)" : ""}</span></label>{recoveries[advance.id] !== undefined && <label className="grid gap-1">Montant à récupérer<MoneyInput value={recoveries[advance.id]} onChange={(value) => setRecoveries((current) => ({ ...current, [advance.id]: value }))}/></label>}</div>)}{advances.length === 0 && <p>Aucune avance récupérable.</p>}</section>
      <label className="grid gap-1 font-semibold">Autre retenue<MoneyInput value={deduction} onChange={setDeduction}/></label>
      {Number(deduction || 0) > 0 && <label className="grid gap-1 font-semibold">Motif de retenue<input className="input" value={deductionReason} onChange={(event) => setDeductionReason(event.target.value)}/></label>}
      <label className="grid gap-1 font-semibold">CNSS (saisie manuelle)<MoneyInput value={cnss} onChange={setCnss}/></label>
      <label className="grid gap-1 font-semibold">Impôt (saisie manuelle)<MoneyInput value={tax} onChange={setTax}/></label>
      <p>Total des avances récupérées : {format(recoveryTotal)}</p>
    </>}
    <label className="grid gap-1 font-semibold">Description<textarea className="input min-h-20" value={description} onChange={(event) => setDescription(event.target.value)}/></label>
    <strong>Net à payer : {format(net)}</strong>
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{error}</p>}
    {lastPayment && <div role="status" className="grid gap-2 rounded bg-green-50 p-3 text-green-800"><span>Paiement enregistré : {lastPayment.reference}</span><button className="secondary-button justify-center" type="button" onClick={() => void printPersonnelPaymentPdf(lastPayment, school)}>{lastPayment.kind === "advance" ? "Télécharger le justificatif" : "Télécharger le bulletin de paie"}</button></div>}
    <button type="submit" disabled={busy || loading || !beneficiaryId || net <= 0} className="primary-button justify-center">{busy ? "Enregistrement…" : "Enregistrer le paiement personnel"}</button>
  </form>;
}
