import { useEffect, useState } from "react";
import type { AppUser } from "../types";
import type { PayrollCashBalance } from "../services/personnelPayroll";
import { loadSectionSchoolCashBalance } from "../services/sectionSchoolCashBalance";
import { formatCurrencyMoney } from "../utils/currency";

/** School-wide accounting is read-only and is never divided between sections. */
export function SchoolCashReadOnlyBalance({ user, schoolId, yearId }: { user: AppUser; schoolId: string; yearId: string }) {
  const key = JSON.stringify([user.id, user.role, user.status, user.active, user.schoolId, user.sectionIds, schoolId, yearId]);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; balance?: PayrollCashBalance; error?: string }>({ key: "" });
  useEffect(() => {
    let active = true;
    setState({ key });
    void loadSectionSchoolCashBalance(user, schoolId, yearId).then((balance) => {
      if (active) setState({ key, balance });
    }).catch(() => {
      if (active) setState({ key, error: "Solde général indisponible. Veuillez réessayer." });
    });
    return () => { active = false; };
  }, [attempt, key, schoolId, user, yearId]);
  const balance = state.key === key ? state.balance : undefined;
  const error = state.key === key ? state.error : undefined;
  return <section className="grid gap-2 rounded border border-slate-200 bg-white p-4" aria-label="Comptabilité générale en lecture seule">
    <h2 className="font-bold text-ink">Comptabilité générale de l’établissement</h2>
    <p className="text-sm text-slate-500">Année sélectionnée · Lecture seule · Toutes les sections, sans répartition.</p>
    {balance ? <div className="grid gap-2 text-sm sm:grid-cols-3">
      <p>Encaissements : <strong>{formatCurrencyMoney(balance.receivedCents / 100, balance.currency)}</strong></p>
      <p>Décaissements : <strong>{formatCurrencyMoney(balance.spentCents / 100, balance.currency)}</strong></p>
      <p>Solde général : <strong>{formatCurrencyMoney(balance.availableCents / 100, balance.currency)}</strong></p>
    </div> : error ? <p role="alert">{error}</p> : <p role="status">Chargement du solde général…</p>}
    <button type="button" className="secondary-button justify-center" disabled={!balance && !error} onClick={() => setAttempt((value) => value + 1)}>Actualiser le solde</button>
  </section>;
}
