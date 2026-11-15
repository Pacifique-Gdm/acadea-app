import { useRef, useState } from "react";
import { Download, Search } from "lucide-react";
import { MoneyInput } from "../ui";
import { createFormerStudentPaymentTransaction, loadFormerStudentDebts, searchFormerStudents, type FormerStudentDebts } from "../../services/financialTransactions";
import { formatCurrencyMoney } from "../../utils/currency";
import { toMoneyMinor } from "../../utils/money";
import { generateReceiptPdf } from "../../utils/pdf";
import type { Payment, School, SchoolYear, Student } from "../../types";

/** Lot 21 — « Paiement anciens élèves » : seuls les élèves archivés ayant une
 * dette d'une année passée apparaissent. L'argent entre dans la caisse de
 * l'année active ; la dette de l'ancienne année diminue (contrôle serveur). */
export function FormerStudentPaymentForm({ school, year, onRecorded }: { school: School; year: SchoolYear; onRecorded: (payment: Payment) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FormerStudentDebts[]>();
  const [selected, setSelected] = useState<FormerStudentDebts>();
  const [debtKey, setDebtKey] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recorded, setRecorded] = useState<{ payment: Payment; student: FormerStudentDebts } | null>(null);
  const attempt = useRef<{ signature: string; id: string } | null>(null);
  const submitting = useRef(false);
  const debt = selected?.debts.find((item) => `${item.schoolYearId}:${item.feeTypeId}` === debtKey);

  async function search() {
    setError(""); setSelected(undefined); setRecorded(null);
    if (query.trim().length < 2) { setError("Saisissez au moins 2 caractères."); return; }
    setBusy(true);
    try { setResults(await searchFormerStudents({ schoolYearId: year.id, query: query.trim() })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Recherche impossible."); }
    finally { setBusy(false); }
  }

  function choose(student: FormerStudentDebts) {
    setSelected(student); setDebtKey(student.debts[0] ? `${student.debts[0].schoolYearId}:${student.debts[0].feeTypeId}` : ""); setAmount(""); setError(""); setRecorded(null);
  }

  async function submit() {
    if (submitting.current || !selected || !debt) return;
    setError("");
    const numericAmount = Number(amount.replace(",", "."));
    try {
      if (!Number.isFinite(numericAmount) || toMoneyMinor(numericAmount) <= 0) throw new Error("Saisissez un montant strictement positif.");
      if (toMoneyMinor(numericAmount) > toMoneyMinor(debt.remaining)) throw new Error("Le montant saisi dépasse la dette restante pour ce frais.");
      const payload = { schoolYearId: year.id, formerStudentId: selected.id, feeTypeId: debt.feeTypeId, debtSchoolYearId: debt.schoolYearId, amount: numericAmount, ...(note.trim() ? { note: note.trim() } : {}) };
      const signature = JSON.stringify(payload);
      const requestId = attempt.current?.signature === signature ? attempt.current.id : crypto.randomUUID();
      attempt.current = { signature, id: requestId };
      submitting.current = true; setBusy(true);
      const payment = await createFormerStudentPaymentTransaction({ ...payload, clientRequestId: requestId });
      attempt.current = null;
      setRecorded({ payment, student: selected });
      setAmount(""); setNote("");
      onRecorded(payment);
      const refreshed = await loadFormerStudentDebts({ schoolYearId: year.id, formerStudentId: selected.id }).catch(() => undefined);
      if (refreshed) { setSelected(refreshed); setDebtKey(refreshed.debts[0] ? `${refreshed.debts[0].schoolYearId}:${refreshed.debts[0].feeTypeId}` : ""); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enregistrement impossible.");
    } finally { submitting.current = false; setBusy(false); }
  }

  function receipt(entry: { payment: Payment; student: FormerStudentDebts }) {
    const [nom = "", ...rest] = entry.student.name.split(" ");
    const student = { id: entry.student.id, matricule: entry.student.matricule, nom, postnom: "", prenom: rest.join(" "), className: entry.student.className } as unknown as Student;
    void generateReceiptPdf(entry.payment, student, { name: entry.payment.feeName ?? "Frais" }, school);
  }

  return <div className="grid min-w-0 gap-3" aria-label="Paiement anciens élèves">
    <p className="rounded border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">Seuls les élèves archivés (partis de l'école) qui ont encore une dette apparaissent. L'argent entre dans la caisse de {year.name}.</p>
    <div className="flex min-w-0 gap-2">
      <label className="flex min-w-0 flex-1 items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-slate-400" />
        <input aria-label="Rechercher un ancien élève" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void search(); }} className="min-w-0 flex-1 outline-none" placeholder="Nom, postnom, prénom ou matricule" />
      </label>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void search()}>Rechercher</button>
    </div>
    {results && !selected && (results.length === 0
      ? <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucun ancien élève avec une dette ne correspond.</p>
      : <div className="grid max-h-64 gap-2 overflow-y-auto">{results.map((student) => <button key={student.id} type="button" onClick={() => choose(student)} className="rounded border border-slate-100 bg-slate-50 p-3 text-left text-sm">
        <p className="break-words font-semibold">{student.name}</p>
        <p className="text-xs text-slate-500">{student.matricule} | {student.className}{student.exitReason ? ` | ${student.exitReason}` : ""}</p>
        <p className="text-xs font-semibold text-amber-700">Dette : {(["USD", "CDF"] as const).filter((currency) => student.totals[currency] > 0).map((currency) => formatCurrencyMoney(student.totals[currency], currency)).join(" + ")}</p>
      </button>)}</div>)}
    {selected && <div className="grid gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">Ancien élève : {selected.name} ({selected.matricule})</p><button type="button" className="text-xs underline" onClick={() => setSelected(undefined)} disabled={busy}>Changer</button></div>
      {selected.debts.length === 0 ? <p>Toutes les dettes de cet élève sont soldées.</p> : <>
        <p className="font-semibold">Dette frais par frais et année par année :</p>
        <ul className="grid gap-1">{selected.debts.map((item) => <li key={`${item.schoolYearId}:${item.feeTypeId}`}>{item.yearName} · {item.feeName} : attendu {formatCurrencyMoney(item.expected, item.currency)}, payé {formatCurrencyMoney(item.paid, item.currency)}, reste <strong>{formatCurrencyMoney(item.remaining, item.currency)}</strong></li>)}</ul>
        <label className="grid gap-1 font-semibold">Frais à payer
          <select aria-label="Dette à payer" className="input" value={debtKey} disabled={busy} onChange={(event) => { setDebtKey(event.target.value); setError(""); }}>
            {selected.debts.map((item) => <option key={`${item.schoolYearId}:${item.feeTypeId}`} value={`${item.schoolYearId}:${item.feeTypeId}`}>{item.feeName} — {item.yearName} — Reste : {formatCurrencyMoney(item.remaining, item.currency)}</option>)}
          </select>
        </label>
        {debt && <MoneyInput value={amount} onChange={setAmount} max={debt.remaining} disabled={busy} className="input" />}
        <label className="grid gap-1 font-semibold">Description
          <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} className="input min-h-16" placeholder="Facultatif" />
        </label>
        <button type="button" className="primary-button justify-center" disabled={busy || !debt || !amount} onClick={() => void submit()}>{busy ? "Enregistrement…" : "Enregistrer le paiement"}</button>
      </>}
    </div>}
    {recorded && <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-mint/30 bg-mint/10 p-3 text-sm font-semibold text-mint">
      <span>Paiement enregistré : reçu {recorded.payment.receiptNumber}</span>
      <button type="button" className="secondary-button" onClick={() => receipt(recorded)}><Download className="h-4 w-4" /> Reçu PDF</button>
    </div>}
    {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
  </div>;
}
