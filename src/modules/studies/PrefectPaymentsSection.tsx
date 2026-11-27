import { useEffect, useState, useSyncExternalStore } from "react";
import { ErrorNotice } from "../../components/ui";
import { readStaffChildrenRefresh, subscribeStaffChildrenRefresh } from "../../services/staffChildren";
import { cachedPrefectPayments, loadPrefectPayments, prefectPaymentsNeedsLoad, type PrefectPayments } from "./prefectPayments";

// Lot P4 : « Situation des paiements », sur le Dashboard du Préfet d'études seulement.
// Seulement des pourcentages par classe : aucun montant, aucun nom d'élève.
export function PrefectPaymentsSection({ uid, schoolId, schoolYearId }: { uid: string; schoolId: string; schoolYearId: string }) {
  const headerRefresh = useSyncExternalStore(subscribeStaffChildrenRefresh, readStaffChildrenRefresh);
  const [payments, setPayments] = useState<PrefectPayments | undefined>(() => cachedPrefectPayments(uid, schoolId, schoolYearId));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const cached = cachedPrefectPayments(uid, schoolId, schoolYearId);
    if (cached && !prefectPaymentsNeedsLoad(uid, schoolId, schoolYearId, headerRefresh)) { setPayments(cached); return undefined; }
    let active = true;
    setLoading(true);
    setError(null);
    loadPrefectPayments(uid, schoolId, schoolYearId, { headerRefresh })
      .then((value) => { if (active) setPayments(value); })
      .catch((reason: unknown) => { if (active) setError(reason); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [uid, schoolId, schoolYearId, headerRefresh, retry]);

  return <section aria-label="Situation des paiements" className="grid gap-3 rounded border border-slate-200 bg-white p-4 shadow-sm">
    <div>
      <h2 className="text-base font-bold text-ink">Situation des paiements</h2>
      {payments && payments.overall.settledRate !== null && <p className="text-sm text-slate-600">{payments.overall.settledRate} % des élèves soldés dans mes sections</p>}
    </div>
    <ErrorNotice error={error} fallback="Situation des paiements indisponible." onRetry={() => setRetry((value) => value + 1)} />
    {!payments && loading && <p className="text-sm text-slate-500">Chargement de la situation des paiements…</p>}
    {payments && payments.classes.length === 0 && <p className="text-sm text-slate-600">Aucun élève dans vos sections.</p>}
    {payments && payments.classes.length > 0 && <ul className="grid gap-2">{payments.classes.map((row) => <li key={row.className} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-2 text-xs sm:grid-cols-[minmax(0,10rem)_1fr_auto]">
      <span className="truncate font-semibold text-ink" title={row.className}>{row.className}</span>
      <span className="flex h-2.5 overflow-hidden rounded-full bg-red-100" role="img" aria-label={`${row.className} : ${row.settledRate ?? 0} % soldé, ${row.remainingRate ?? 0} % reste à payer`}>
        <i className="block h-full bg-emerald-600" style={{ width: `${row.settledRate ?? 0}%` }} />
      </span>
      <span className="whitespace-nowrap text-slate-700">{row.settledRate === null ? "—" : `${row.settledRate} % soldé`}</span>
    </li>)}</ul>}
    {payments && payments.overall.unknown > 0 && <p className="text-xs text-amber-700">{payments.overall.unknown} élève{payments.overall.unknown > 1 ? "s" : ""} non calculé{payments.overall.unknown > 1 ? "s" : ""} (ni soldé, ni reste à payer).</p>}
    <p className="text-xs text-slate-500">Vert : soldé · Rouge : reste à payer. Aucun montant affiché.</p>
  </section>;
}
