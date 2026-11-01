import { useEffect, useState } from "react";
import type { AppUser, School } from "../../types";
import { loadSectionSchoolRecords, type SectionPersonnel } from "../../services/sectionSchoolRecords";
import { personnelRoleLabels } from "../../services/personnel";
import { PersonnelPaymentHistory } from "../../components/personnel/PersonnelPaymentHistory";

export function SectionPersonnelReadOnly({ user, school, schoolYearId }: { user: AppUser; school: School; schoolYearId: string }) {
  const [result, setResult] = useState<{ key: string; items: SectionPersonnel[]; error?: string }>();
  const [selected, setSelected] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const key = JSON.stringify([user.id, user.role, user.status, user.active, user.sectionIds, school.id, schoolYearId, refresh]);
  useEffect(() => {
    const controller = new AbortController();
    setSelected(undefined);
    void Promise.all([
      loadSectionSchoolRecords("personnel", user, school.id, schoolYearId, controller.signal),
      loadSectionSchoolRecords("servicePersonnel", user, school.id, schoolYearId, controller.signal),
    ]).then((pages) => { if (!controller.signal.aborted) setResult({ key, items: pages.flat().sort((a, b) => a.name.localeCompare(b.name, "fr")) }); })
      .catch(() => { if (!controller.signal.aborted) setResult({ key, items: [], error: "Consultation du personnel indisponible. Veuillez réessayer." }); });
    return () => controller.abort();
  }, [key, school.id, schoolYearId, user]);
  const current = result?.key === key ? result : undefined;
  return <div className="grid min-w-0 gap-3">
    <p className="text-sm text-slate-600">Personnel et paie de l’établissement entier — consultation uniquement.</p>
    <button className="secondary-button" type="button" onClick={() => setRefresh((value) => value + 1)}>Actualiser</button>
    {!current && <p role="status">Chargement…</p>}
    {current?.error && <p role="alert">{current.error}</p>}
    {current && !current.error && !current.items.length && <p>Aucun personnel enregistré.</p>}
    {current?.items.map((item) => <article className="grid min-w-0 gap-2 rounded border border-slate-200 p-3 text-sm" key={item.id}>
      <strong>{item.name}</strong>
      <span>{item.role ? personnelRoleLabels[item.role as keyof typeof personnelRoleLabels] ?? item.role : item.jobTitle} · {item.status === "inactive" || item.active === false ? "Archivé / inactif" : "Actif"}</span>
      <button className="secondary-button" type="button" onClick={() => setSelected(item.id)}>Consulter la paie</button>
    </article>)}
    {selected && current?.items.some((item) => item.id === selected) && <PersonnelPaymentHistory key={`${key}:${selected}`} beneficiaryId={selected} school={school} onClose={() => setSelected(undefined)} />}
  </div>;
}
