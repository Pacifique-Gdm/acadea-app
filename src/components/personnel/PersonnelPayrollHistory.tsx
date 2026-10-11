import { useEffect, useRef, useState } from "react";
import { listPayrollHistoryPage, type PayrollHistoryCursor, type PayrollHistoryEntry } from "../../services/personnelPayroll";
import { formatCurrencyMoney } from "../../utils/currency";
import type { School } from "../../types";

export function PersonnelPayrollHistory({ schoolId = "", schools = [], refreshToken = 0 }: { schoolId?: string; schools?: School[]; refreshToken?: number }) {
  const [payments, setPayments] = useState<PayrollHistoryEntry[]>([]);
  const [cursor, setCursor] = useState<PayrollHistoryCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);

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
    {payments.map((payment) => <article key={payment.id} className="grid min-w-0 gap-1 rounded border border-slate-200 p-3 text-sm">
      <strong>{payment.kind === "salary" ? "Salaire" : "Prime"} — {payment.beneficiaryName || "Bénéficiaire non renseigné"}</strong>
      <span>École : {schools.find((school) => school.id === payment.schoolId)?.name ?? payment.schoolId}</span>
      <span>Net payé : {typeof payment.netPaid === "number" ? formatCurrencyMoney(payment.netPaid, payment.currency) : "Non renseigné"} · Date : {payment.paidAt || "Non renseignée"}</span>
      <span>Période : {payment.periodMonth && payment.periodYear ? `${String(payment.periodMonth).padStart(2, "0")}/${payment.periodYear}` : "Non renseignée"} · Référence : {payment.reference || "Non renseignée"}</span>
    </article>)}
    {cursor && <button type="button" className="secondary-button w-full justify-center" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Chargement…" : "Charger plus"}</button>}
  </div>;
}
