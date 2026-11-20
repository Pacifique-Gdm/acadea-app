import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Search, X } from "lucide-react";
import { MoneyInput } from "../ui";
import { createFormerStudentPaymentTransaction, listFormerStudents, type FormerStudentDebts } from "../../services/financialTransactions";
import { formatCurrencyMoney } from "../../utils/currency";
import { toMoneyMinor } from "../../utils/money";
import { generateReceiptPdf } from "../../utils/pdf";
import type { Payment, School, SchoolYear, Student } from "../../types";
import { formerStudentsRefreshKey, searchFormerStudentsLocally, visibleFormerStudents } from "../../utils/formerStudents";
import { userFacingError } from "../../utils/userFacingError";
import { ErrorNotice } from "../ui/ErrorNotice";
import { useLoadRetry } from "../../hooks/useLoadRetry";

/** Lot 21/22 — « Paiement anciens élèves » : seuls les élèves archivés ayant une
 * dette (année en cours ou années passées) apparaissent ; contrôle final côté serveur. */
export function FormerStudentPaymentForm({ school, year, students, payments, onRecorded }: {
  school: School; year: SchoolYear; students: Student[]; payments: Payment[]; onRecorded: (payment: Payment) => void;
}) {
  const [list, setList] = useState<FormerStudentDebts[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [debtKey, setDebtKey] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [errorLoad, setErrorLoad] = useState("");
  const errorLoadRetry = useLoadRetry(Boolean(errorLoad), () => setErrorLoad(""));
  const [busy, setBusy] = useState(false);
  const [recorded, setRecorded] = useState<{ payment: Payment; student: FormerStudentDebts } | null>(null);
  const [reload, setReload] = useState(0);
  const attempt = useRef<{ signature: string; id: string } | null>(null);
  const submitting = useRef(false);
  const refreshKey = formerStudentsRefreshKey(students, payments);

  useEffect(() => {
    let active = true;
    // Relecture discrète (pas plus d'une fois par seconde) : uniquement la liste des anciens élèves.
    const timer = window.setTimeout(() => {
      void listFormerStudents({ schoolYearId: year.id })
        .then((next) => { if (active) { setList(next); setErrorLoad(""); } })
        .catch((cause) => { if (active) setErrorLoad(userFacingError(cause, "Liste des anciens élèves indisponible.")); })
        .finally(() => { if (active) setLoading(false); });
    }, reload === 0 && list.length === 0 ? 0 : 800);
    return () => { active = false; window.clearTimeout(timer); };
    // La liste est relue quand l'année, les archivages ou les paiements concernés changent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year.id, refreshKey, reload, errorLoadRetry.token]);

  const visible = useMemo(() => visibleFormerStudents(list, students), [list, students]);
  const selected = visible.find((item) => item.id === selectedId);
  const results = selected ? [] : searchFormerStudentsLocally(visible, query);
  const debts = selected?.debts.filter((item) => item.remaining > 0) ?? [];
  const debt = debts.find((item) => `${item.schoolYearId}:${item.feeTypeId}` === debtKey) ?? debts[0];

  function choose(student: FormerStudentDebts) {
    setSelectedId(student.id); setQuery(`${student.name} | ${student.matricule}`);
    setDebtKey(student.debts[0] ? `${student.debts[0].schoolYearId}:${student.debts[0].feeTypeId}` : ""); setAmount(""); setError(""); setRecorded(null);
  }

  function clear() {
    if (submitting.current) return;
    setSelectedId(""); setQuery(""); setDebtKey(""); setAmount(""); setError("");
  }

  async function submit() {
    if (submitting.current || !selected || !debt) return;
    setError("");
    const numericAmount = Number(amount.replace(",", "."));
    try {
      if (!Number.isFinite(numericAmount) || toMoneyMinor(numericAmount) <= 0) throw new Error("Saisissez un montant strictement positif.");
      if (toMoneyMinor(numericAmount) > toMoneyMinor(debt.remaining)) throw new Error("Le montant saisi dépasse la dette restante pour ce frais.");
      const payload = { schoolYearId: year.id, formerStudentId: selected.id, feeTypeId: debt.feeTypeId, ...(debt.schoolYearId !== year.id ? { debtSchoolYearId: debt.schoolYearId } : {}), amount: numericAmount, ...(note.trim() ? { note: note.trim() } : {}) };
      const signature = JSON.stringify(payload);
      const requestId = attempt.current?.signature === signature ? attempt.current.id : crypto.randomUUID();
      attempt.current = { signature, id: requestId };
      submitting.current = true; setBusy(true);
      const payment = await createFormerStudentPaymentTransaction({ ...payload, clientRequestId: requestId });
      attempt.current = null;
      setRecorded({ payment, student: selected });
      setAmount(""); setNote("");
      onRecorded(payment);
      setReload((value) => value + 1);
    } catch (cause) {
      setError(userFacingError(cause, "Enregistrement impossible."));
    } finally { submitting.current = false; setBusy(false); }
  }

  function receipt(entry: { payment: Payment; student: FormerStudentDebts }) {
    const [nom = "", ...rest] = entry.student.name.split(" ");
    const student = { id: entry.student.id, matricule: entry.student.matricule, nom, postnom: "", prenom: rest.join(" "), className: entry.student.className } as unknown as Student;
    void generateReceiptPdf(entry.payment, student, { name: entry.payment.feeName ?? "Frais" }, school);
  }

  return <div className="grid min-w-0 gap-3" aria-label="Paiement anciens élèves">
    <div className="grid min-w-0 gap-2">
      <label className="flex min-w-0 items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-slate-400" />
        <input aria-label="Rechercher un ancien élève" value={query} disabled={busy} onChange={(event) => { setQuery(event.target.value); setSelectedId(""); setRecorded(null); }} className="min-w-0 flex-1 outline-none" placeholder="Rechercher par nom, postnom, prénom ou matricule" />
      </label>
      {!selected && query.trim() === "" && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">{loading ? "Chargement des anciens élèves…" : "Saisissez un nom ou un matricule pour afficher les anciens élèves."}</p>}
      {!selected && query.trim() !== "" && results.length === 0 && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">{loading ? "Chargement des anciens élèves…" : "Aucun ancien élève avec une dette trouvé."}</p>}
      {results.length > 0 && <div className="max-h-64 space-y-2 overflow-y-auto pr-1 scrollbar-thin">{results.map((student) => <button key={student.id} type="button" onClick={() => choose(student)} className="w-full rounded border border-slate-100 bg-slate-50 p-3 text-left text-sm transition hover:border-slate-200">
        <p className="break-words font-semibold text-ink">{student.name}</p>
        <p className="text-xs text-slate-500">{student.matricule} | {student.className}</p>
        <p className="text-xs font-semibold text-amber-700">Dette : {(["USD", "CDF"] as const).filter((currency) => student.totals[currency] > 0).map((currency) => formatCurrencyMoney(student.totals[currency], currency)).join(" + ")}</p>
      </button>)}</div>}
      {selected && <div className="flex min-w-0 items-center gap-2 rounded bg-mint/10 py-1.5 pl-3 pr-1.5 text-sm font-semibold text-mint">
        <span className="min-w-0 flex-1 break-words">Ancien élève sélectionné : {selected.name}</span>
        <button type="button" aria-label="Effacer l’ancien élève sélectionné" title="Effacer l’ancien élève sélectionné" onClick={clear} disabled={busy} className="flex h-9 w-9 shrink-0 items-center justify-center rounded hover:bg-mint/10 disabled:opacity-50"><X className="h-4 w-4" aria-hidden="true" /></button>
      </div>}
    </div>
    {selected && debt && <div className="grid gap-2 text-sm">
      <ul className="grid gap-1">{debts.map((item) => <li key={`${item.schoolYearId}:${item.feeTypeId}`}>{item.yearName} · {item.feeName} : attendu {formatCurrencyMoney(item.expected, item.currency)}, payé {formatCurrencyMoney(item.paid, item.currency)}, reste <strong>{formatCurrencyMoney(item.remaining, item.currency)}</strong></li>)}</ul>
      <select aria-label="Dette à payer" className="input" value={`${debt.schoolYearId}:${debt.feeTypeId}`} disabled={busy} onChange={(event) => { setDebtKey(event.target.value); setError(""); }}>
        {debts.map((item) => <option key={`${item.schoolYearId}:${item.feeTypeId}`} value={`${item.schoolYearId}:${item.feeTypeId}`}>{item.feeName} — {item.yearName} — Reste : {formatCurrencyMoney(item.remaining, item.currency)}</option>)}
      </select>
      <MoneyInput value={amount} onChange={setAmount} max={debt.remaining} disabled={busy} className="input" />
      <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">Description
        <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} className="input min-h-16" />
      </label>
      <button type="button" className="primary-button w-full justify-center" disabled={busy || !amount} onClick={() => void submit()}>{busy ? "Enregistrement…" : "Enregistrer"}</button>
    </div>}
    {recorded && <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-mint/30 bg-mint/10 p-3 text-sm font-semibold text-mint">
      <span>Paiement enregistré : reçu {recorded.payment.receiptNumber}</span>
      <button type="button" className="secondary-button" onClick={() => receipt(recorded)}><Download className="h-4 w-4" /> Reçu PDF</button>
    </div>}
    <ErrorNotice error={errorLoad} onRetry={errorLoadRetry.retry} /><ErrorNotice error={error} onRetry={() => void submit()} />
  </div>;
}
