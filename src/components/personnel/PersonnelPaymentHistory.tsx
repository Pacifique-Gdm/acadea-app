import { useEffect, useState } from "react";
import { AdminDrawer } from "../ui";
import { listPersonnelPayments } from "../../services/personnelPayroll";
import { printPersonnelPaymentPdf } from "../../utils/personnelPayrollPdf";
import { formatCurrencyMoney } from "../../utils/currency";
import type { PersonnelPayment, School } from "../../types";

export function PersonnelPaymentHistory({ beneficiaryId, school, onClose }: { beneficiaryId: string; school: School; onClose: () => void }) {
  const [payments, setPayments] = useState<PersonnelPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void listPersonnelPayments(beneficiaryId).then((items) => { if (active) setPayments(items); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Historique indisponible."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [beneficiaryId]);
  return <AdminDrawer title="Paiements du personnel" closeLabel="Fermer l'historique de paie" onClose={onClose}>
    {loading && <p role="status">Chargement…</p>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {!loading && !error && payments.length === 0 && <p>Aucun paiement personnel enregistré.</p>}
    <div className="grid gap-2">{payments.map((payment) => <article key={payment.id} className="grid gap-2 rounded border border-slate-200 p-3 text-sm">
      <strong>{payment.kind === "advance" ? "Avance sur salaire" : payment.kind === "salary" ? "Salaire" : "Prime"} {payment.kind === "advance" ? "" : `${String(payment.periodMonth).padStart(2, "0")}/${payment.periodYear}`}</strong>
      <span>Payé le {payment.paidAt} · {payment.reference} · Net : {formatCurrencyMoney(payment.netPaid, payment.currency)}</span>
      <button type="button" className="secondary-button justify-center" onClick={() => void printPersonnelPaymentPdf(payment, school)}>{payment.kind === "advance" ? "Télécharger le justificatif" : "Télécharger le bulletin"}</button>
    </article>)}</div>
  </AdminDrawer>;
}
