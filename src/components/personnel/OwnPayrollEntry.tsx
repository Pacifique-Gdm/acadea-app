import { useEffect, useState } from "react";
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
    <button type="button" className="min-w-0 rounded border border-slate-200 bg-white p-4 text-left font-semibold text-ink shadow-sm transition hover:bg-slate-50" onClick={() => setOpen(true)}>Salaire/Prime</button>
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
