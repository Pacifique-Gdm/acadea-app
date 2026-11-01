import { useEffect, useState } from "react";
import type { AppUser, School, SchoolYear } from "../../types";
import { loadSectionFinancialReport } from "../../services/sectionFinancialReport";
import { ReportsModule } from "../reports/ReportsModule";
import { SchoolCashReadOnlyBalance } from "../../components/SchoolCashReadOnlyBalance";

export function SectionFinancialReport({ user, school, year }: { user: AppUser; school: School; year: SchoolYear }) {
  const [refresh, setRefresh] = useState(0);
  const key = JSON.stringify([user.id, user.role, user.status, user.active, user.sectionIds, school.id, year.id, refresh]);
  const [state, setState] = useState<{ key: string; data?: Awaited<ReturnType<typeof loadSectionFinancialReport>>; error?: string }>();
  useEffect(() => {
    let active = true;
    void loadSectionFinancialReport(user, school.id, year.id).then((data) => { if (active) setState({ key, data }); })
      .catch(() => { if (active) setState({ key, error: "Rapport indisponible. Veuillez réessayer." }); });
    return () => { active = false; };
  }, [key, school.id, user, year.id]);
  const current = state?.key === key ? state : undefined;
  return <div className="grid min-w-0 gap-3">
    <p className="text-sm text-slate-600">Paiements scolaires de vos sections ; dépenses et autres recettes globales, en lecture seule. Aucun solde artificiel de section n’est calculé.</p>
    <button type="button" className="secondary-button" onClick={() => setRefresh((value) => value + 1)}>Actualiser</button>
    {!current && <p role="status">Chargement…</p>}
    {current?.error && <p role="alert">{current.error}</p>}
    {current?.data && <ReportsModule key={key} yearData={current.data} school={school} year={year} allowedSections={user.sectionIds ?? []} />}
    <SchoolCashReadOnlyBalance user={user} schoolId={school.id} yearId={year.id} />
  </div>;
}
