import { useEffect, useState, useSyncExternalStore } from "react";
import { ErrorNotice } from "../../components/ui";
import { readStaffChildrenRefresh, subscribeStaffChildrenRefresh } from "../../services/staffChildren";
import { cachedPrefectStaff, loadPrefectStaff, prefectStaffNeedsLoad, type PrefectStaff, type PrefectStaffAbsence } from "./prefectStaff";

const formatDate = (value: string) => /^\d{4}-\d{2}-\d{2}/.test(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}` : value;
const absenceLabel = (absence: PrefectStaffAbsence) => absence.requestType === "TIME_RANGE"
  ? `${formatDate(absence.date)} (${absence.startTime ?? ""}–${absence.endTime ?? ""})` : `${formatDate(absence.date)} (journée)`;

// Lot P3 : partie « Mes sections » ajoutée en haut du drawer « Personnels enseignants », pour le Préfet seulement.
// Lecture seule. Présence = absences approuvées (il n'existe pas de pointage des enseignants).
export function PrefectStaffContent({ uid, schoolId, schoolYearId }: { uid: string; schoolId: string; schoolYearId: string }) {
  const headerRefresh = useSyncExternalStore(subscribeStaffChildrenRefresh, readStaffChildrenRefresh);
  const [staff, setStaff] = useState<PrefectStaff | undefined>(() => cachedPrefectStaff(uid, schoolId, schoolYearId));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const cached = cachedPrefectStaff(uid, schoolId, schoolYearId);
    if (cached && !prefectStaffNeedsLoad(uid, schoolId, schoolYearId, headerRefresh)) { setStaff(cached); return undefined; }
    let active = true;
    setLoading(true);
    setError(null);
    loadPrefectStaff(uid, schoolId, schoolYearId, { headerRefresh })
      .then((value) => { if (active) setStaff(value); })
      .catch((reason: unknown) => { if (active) setError(reason); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [uid, schoolId, schoolYearId, headerRefresh, retry]);

  const absentToday = staff?.teachers.filter((teacher) => teacher.absentToday).length ?? 0;
  return <section aria-label="Mes sections : cours, charge et absences" className="mb-4 grid gap-3 rounded border border-slate-200 bg-slate-50 p-3">
    <div>
      <h3 className="text-sm font-bold text-ink">Mes sections : cours, charge et absences</h3>
      <p className="text-xs text-slate-500">Lecture seule · présence = absences approuvées (pas de pointage des enseignants)</p>
    </div>
    <ErrorNotice error={error} fallback="Personnel de mes sections indisponible." onRetry={() => setRetry((value) => value + 1)} />
    {!staff && loading && <p className="text-sm text-slate-500">Chargement du personnel de mes sections…</p>}
    {staff && staff.teachers.length === 0 && <p className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-600">Aucun enseignant dans vos sections.</p>}
    {staff && staff.teachers.length > 0 && <>
      <p className="text-sm text-slate-700">{staff.teachers.length} enseignant{staff.teachers.length > 1 ? "s" : ""} · {absentToday} absent{absentToday > 1 ? "s" : ""} aujourd'hui</p>
      <ul className="grid gap-2">{staff.teachers.map((teacher) => <li key={teacher.id} className="grid gap-1 rounded border border-slate-200 bg-white p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="min-w-0 break-words text-ink">{teacher.teacherName}</strong>
          <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-800">{teacher.weeklyPeriods} période{teacher.weeklyPeriods > 1 ? "s" : ""}/semaine</span>
          {teacher.absentToday
            ? <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800">Absent aujourd'hui</span>
            : <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-bold text-green-800">Présent aujourd'hui</span>}
        </div>
        <p className="break-words text-slate-700">{teacher.courses.length ? teacher.courses.map((course) => `${course.subjectName} · ${course.className} (${course.weeklyPeriods})`).join(" ; ") : "Aucun cours dans vos sections"}</p>
        {teacher.upcomingAbsenceCount > 0 && <p className="text-xs text-slate-500">Absences approuvées à venir : {teacher.upcomingAbsences.map(absenceLabel).join(", ")}{teacher.upcomingAbsenceCount > teacher.upcomingAbsences.length ? ` … (${teacher.upcomingAbsenceCount} au total)` : ""}</p>}
      </li>)}</ul>
    </>}
  </section>;
}
