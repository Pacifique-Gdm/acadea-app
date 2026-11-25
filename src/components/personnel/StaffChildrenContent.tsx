// Lot 3 : onglet (ou tiroir) « Enfants » du personnel. Même présentation que l'onglet « Enfants » du parent :
// frais attendus après la décision de l'administrateur, montant payé, solde, détail par frais et reçus.
import { useCallback, useEffect, useState } from "react";
import { Baby, Download } from "lucide-react";
import { AdminDrawer, BlockSkeleton, Metric } from "../ui";
import { ErrorNotice } from "../ui/ErrorNotice";
import { StudentPhoto } from "../students/StudentPhoto";
import { loadStaffChildren, staffChildSupportLabel, type StaffChildrenResult } from "../../services/staffChildren";
import { getStudentFeeSummaries } from "../../utils/studentFeeSummary";
import { formatCurrencyMoney } from "../../utils/currency";
import { sumMoney } from "../../utils/money";
import { formatStudentClassName } from "../../utils/studentClasses";
import { generateReceiptPdf } from "../../utils/pdf";
import { userFacingError } from "../../utils/userFacingError";
import type { School } from "../../types";

export const STAFF_NO_CHILDREN_MESSAGE = "Aucun enfant à votre charge n'est enregistré dans cet établissement.";

const progressBarTone = (percent: number) => percent >= 100 ? "bg-mint" : percent >= 75 ? "bg-lime-400" : percent >= 50 ? "bg-amber-400" : "bg-red-500";

export function StaffChildrenContent({ school }: { school: School }) {
  const [data, setData] = useState<StaffChildrenResult>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyPaymentId, setBusyPaymentId] = useState("");
  const load = useCallback(() => {
    setLoading(true); setError("");
    loadStaffChildren().then(setData).catch((reason) => setError(userFacingError(reason, "Chargement de vos enfants impossible."))).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  return <section className="grid min-w-0 gap-4" data-staff-children>
    <div className="min-w-0 rounded border border-slate-200 bg-white p-4">
      <h1 className="text-2xl font-bold text-ink">Enfants</h1>
      <p className="break-words text-sm text-slate-500">Enfants à votre charge inscrits dans cet établissement, selon la décision de l'administration.</p>
    </div>
    {loading && <BlockSkeleton className="h-32" label="Chargement de vos enfants" />}
    <ErrorNotice error={error} onRetry={load} />
    {!loading && !error && data && data.children.length === 0 && <p role="status" className="rounded border border-slate-200 bg-white p-6 text-center text-sm font-semibold text-slate-700">{STAFF_NO_CHILDREN_MESSAGE}</p>}
    {!loading && data && data.children.map(({ student, decision, payments }) => {
      const currency = data.currency;
      const money = (value: number) => formatCurrencyMoney(value, currency);
      const summaries = getStudentFeeSummaries(student, data.feeTypes, payments);
      const totals = summaries.reduce((sum, item) => ({ expected: sumMoney([sum.expected, item.expected]), paid: sumMoney([sum.paid, item.paid]), remaining: sumMoney([sum.remaining, item.remaining]) }), { expected: 0, paid: 0, remaining: 0 });
      const progress = totals.expected > 0 ? Math.min(100, Math.round((totals.paid / totals.expected) * 100)) : 100;
      const sorted = [...payments].sort((a, b) => String(b.createdAt ?? b.paidAt).localeCompare(String(a.createdAt ?? a.paidAt)));
      return <article key={student.id} className="min-w-0 rounded border border-slate-200 bg-white p-4" data-staff-child={student.id}>
        <div className="flex min-w-0 flex-col gap-4 md:flex-row">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded bg-slate-100 text-xl font-bold text-ink">
            <StudentPhoto student={student} className="h-full w-full object-cover" fallback={student.prenom?.slice(0, 1) || student.nom?.slice(0, 1) || "?"} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="break-words text-xl font-bold text-ink">{student.nom} {student.postnom} {student.prenom}</p>
                <p className="break-words text-sm text-slate-500">{formatStudentClassName(student)}</p>
              </div>
              <span className="shrink-0 rounded bg-mint/10 px-2 py-1 text-xs font-semibold text-mint">{progress}% payé</span>
            </div>
            <p className="mt-2 inline-block rounded bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-800">{staffChildSupportLabel(decision)}</p>
            <div className="mt-4 h-3 overflow-hidden rounded bg-slate-100"><div className={`h-full rounded transition-colors ${progressBarTone(progress)}`} style={{ width: `${progress}%` }} /></div>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <Metric label="Total frais" value={money(totals.expected)} />
              <Metric label="Total payé" value={money(totals.paid)} />
              <Metric label="Solde" value={money(totals.remaining)} />
            </div>
            <div className="mt-4 rounded border border-slate-100 bg-slate-50 p-3">
              <p className="mb-3 text-sm font-semibold text-ink">Progression par type de frais</p>
              <div className="grid gap-3">
                {summaries.length === 0 && <p className="text-sm text-slate-500">Aucun frais défini pour cette classe.</p>}
                {summaries.map((summary) => <div key={summary.feeTypeId} className="min-w-0 rounded bg-white p-3 shadow-sm">
                  <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <p className="break-words text-sm font-bold text-ink">{summary.feeName}</p>
                    <p className="break-words text-xs font-semibold text-slate-500">{money(summary.paid)} / {money(summary.expected)}</p>
                  </div>
                  <div className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
                    <span>Attendu : <strong>{money(summary.expected)}</strong></span>
                    <span>Payé : <strong>{money(summary.paid)}</strong></span>
                    <span>Solde : <strong>{money(summary.remaining)}</strong></span>
                  </div>
                </div>)}
              </div>
            </div>
            <div className="mt-4 grid gap-2">
              <p className="text-sm font-semibold text-ink">Historique des paiements</p>
              {sorted.length === 0 && <p className="text-sm text-slate-500">Aucun paiement enregistré.</p>}
              {sorted.map((payment) => {
                const fee = data.feeTypes.find((item) => item.id === payment.feeTypeId);
                return <div key={payment.id} className="flex min-w-0 flex-col gap-2 rounded bg-slate-50 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0"><span className="font-semibold text-ink">{formatCurrencyMoney(payment.amount, payment.currency ?? currency)}</span><span className="break-words text-slate-500"> | {fee?.name ?? "Frais"} | {payment.paidAt}</span></div>
                  <button type="button" disabled={!fee || busyPaymentId === payment.id} aria-busy={busyPaymentId === payment.id} className="inline-flex w-full items-center justify-center gap-2 rounded bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto" title="Télécharger le reçu PDF"
                    onClick={() => { if (!fee) return; setBusyPaymentId(payment.id); void generateReceiptPdf(payment, student, fee, school).finally(() => setBusyPaymentId("")); }}>
                    <Download className="h-4 w-4" /> PDF
                  </button>
                </div>;
              })}
            </div>
          </div>
        </div>
      </article>;
    })}
  </section>;
}

/** Lot 3 : bouton du Menu (modules qui ont déjà 5 onglets) qui ouvre le même contenu dans un tiroir. */
export function StaffChildrenEntry({ school }: { school: School }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" data-staff-children-entry className="flex items-center gap-3 rounded border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-600" onClick={() => setOpen(true)}>
      <Baby className="h-5 w-5 shrink-0" /><span className="min-w-0"><strong className="block">Enfants</strong><span className="block text-sm text-slate-500">Enfants à votre charge dans cet établissement</span></span>
    </button>
    {open && <AdminDrawer title="Enfants" closeLabel="Fermer Enfants" onClose={() => setOpen(false)}><StaffChildrenContent school={school} /></AdminDrawer>}
  </>;
}
