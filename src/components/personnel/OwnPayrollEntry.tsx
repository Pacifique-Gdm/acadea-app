import { useEffect, useState } from "react";
import { Banknote } from "lucide-react";
import { AdminDrawer } from "../ui";
import { listOwnPayroll } from "../../services/personnelPayroll";
import { printPersonnelPaymentPdf } from "../../utils/personnelPayrollPdf";
import { formatCurrencyMoney } from "../../utils/currency";
import type { AppUser, PersonnelPayment, School } from "../../types";

const allowedRoles = new Set(["school_admin", "cashier", "discipline_director", "study_director", "secretary", "teacher"]);

export function OwnPayrollEntry({ user, school }: { user: AppUser; school: School }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [payments, setPayments] = useState<PersonnelPayment[]>([]);
  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoading(true); setError("");
    void listOwnPayroll().then((items) => { if (current) setPayments(items); }).catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : "Chargement impossible."); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [open]);
  if (!allowedRoles.has(user.role) || user.schoolId !== school.id) return null;
  return <>
    <button
      type="button"
      className={user.role === "secretary"
        ? "flex min-w-0 items-center gap-3 rounded border border-slate-200 bg-white p-4 text-left transition hover:border-blue-300 hover:bg-blue-50/40"
        : user.role === "study_director"
          ? "flex min-w-0 items-center gap-3 rounded border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-600"
          : user.role === "teacher"
            ? "min-w-0 rounded border border-slate-200 bg-white p-4 text-left text-ink shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-600"
            : "min-w-0 rounded border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-mint"}
      onClick={() => setOpen(true)}
    >
      {user.role === "secretary" ? <><span className="rounded bg-blue-50 p-2 text-blue-700"><Banknote className="h-5 w-5" /></span><span className="font-bold text-ink">Salaire/Prime</span></>
        : user.role === "study_director" ? <><Banknote className="h-5 w-5 shrink-0" /><strong>Salaire/Prime</strong></>
          : user.role === "teacher" ? <><span className="flex items-center gap-3"><Banknote className="h-5 w-5 shrink-0" /><span className="font-semibold">Salaire/Prime</span></span><p className="mt-1 pl-8 text-xs text-slate-500">Mes paiements</p></>
            : <span className="flex min-w-0 items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-100 text-ink"><Banknote className="h-5 w-5" /></span><span className="min-w-0"><span className="block break-words font-bold text-ink">Salaire/Prime</span><span className="mt-1 block break-words text-sm text-slate-500">Mes paiements</span></span></span>}
    </button>
    {open && <AdminDrawer title="Salaire/Prime" closeLabel="Fermer mes salaires et primes" onClose={() => setOpen(false)}>
      {loading && <p role="status">Chargement des paiements…</p>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {!loading && !error && payments.length === 0 && <p>Aucun salaire ou prime enregistré.</p>}
      <div className="grid gap-3">{payments.map((payment) => <article key={payment.id} className="grid min-w-0 gap-2 rounded border border-slate-200 p-3 text-sm">
        <strong>{payment.kind === "salary" ? "Salaire" : "Prime"} — {String(payment.periodMonth).padStart(2, "0")}/{payment.periodYear}</strong>
        <span>Payé le {new Date(`${payment.paidAt}T12:00:00`).toLocaleDateString("fr-FR")} · {payment.reference}</span>
        <span>Brut : {formatCurrencyMoney(payment.amount, payment.currency)} · Avances récupérées : {formatCurrencyMoney(payment.recoveredAmount, payment.currency)}</span>
        <span>Retenue : {formatCurrencyMoney(payment.deduction, payment.currency)} · CNSS : {formatCurrencyMoney(payment.cnss, payment.currency)} · Impôt : {formatCurrencyMoney(payment.tax, payment.currency)}</span>
        <strong>Net payé : {formatCurrencyMoney(payment.netPaid, payment.currency)}</strong>
        <button type="button" className="secondary-button justify-center" onClick={() => void printPersonnelPaymentPdf(payment, school)}>Télécharger le bulletin PDF</button>
      </article>)}</div>
    </AdminDrawer>}
  </>;
}
