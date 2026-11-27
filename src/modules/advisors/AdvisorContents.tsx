// Lots 10 et 11 : écrans des conseillers. Tout est en LECTURE SEULE, sauf les fiches de visite
// (Conseiller pédagogique). Aucune donnée d'argent n'est demandée au serveur ni affichée.
import { useMemo, useState } from "react";
import type { AppUser, School, SchoolYear } from "../../types";
import { ErrorNotice } from "../../components/ui";
import { useSchoolCalendar } from "../studies/useSchoolCalendar";
import { filterAdvisorStudents, useAdvisorData, type AdvisorGradeClass, type AdvisorOverview, type AdvisorStudent } from "./advisorService";

type Scope = { uid: string; schoolId: string; schoolYearId: string };
const card = "rounded border border-slate-200 bg-white p-3 shadow-sm";
export const formatDay = (value?: string) => value && /^\d{4}-\d{2}-\d{2}/.test(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : value ?? "";

export function sectionsNote(sections: string[] | undefined) {
  return sections && sections.length ? `Vos sections : ${sections.join(", ")}` : "Toute l'école";
}

export function AdvisorTeachersContent({ overview, loading, error, onRetry }: { overview?: AdvisorOverview; loading: boolean; error: unknown; onRetry: () => void }) {
  return <section className="grid gap-3">
    <div><h1 className="text-2xl font-bold text-ink">Enseignants</h1><p className="text-sm text-slate-600">Affectations en lecture seule · {sectionsNote(overview?.sections)}</p></div>
    <ErrorNotice error={error} fallback="Enseignants indisponibles." onRetry={onRetry} />
    {!overview && loading && <p className="text-sm text-slate-500">Chargement des enseignants…</p>}
    {overview && overview.teachers.length === 0 && <p className={card}>Aucun enseignant dans votre périmètre.</p>}
    {overview?.teachers.map((teacher) => <article key={teacher.id} className={card}>
      <p className="font-semibold text-ink">{teacher.teacherName}</p>
      <p className="text-xs text-slate-500">{teacher.courses.length} cours · {teacher.weeklyPeriods} période(s) par semaine</p>
      {teacher.courses.length > 0 ? <ul className="mt-2 grid gap-1 text-sm">{teacher.courses.map((course) => <li key={`${course.classId}-${course.subjectId}`}>{course.className} · {course.subjectName} · {course.weeklyPeriods} p/sem.</li>)}</ul> : <p className="mt-1 text-sm text-slate-500">Sans affectation.</p>}
    </article>)}
  </section>;
}

export function AdvisorStudentsContent({ scope }: { scope: Scope }) {
  const { value, loading, error, retry } = useAdvisorData<{ sections: string[]; students: AdvisorStudent[] }>("advisor-students", scope);
  const [search, setSearch] = useState("");
  const shown = useMemo(() => filterAdvisorStudents(value?.students ?? [], search), [value, search]);
  return <div className="grid gap-3">
    <p className="text-sm text-slate-600">Lecture seule, sans aucune information d'argent · {sectionsNote(value?.sections)}</p>
    <input className="input" placeholder="Rechercher un élève (nom, matricule, classe)" aria-label="Rechercher un élève" value={search} onChange={(event) => setSearch(event.target.value)} />
    <ErrorNotice error={error} fallback="Élèves indisponibles." onRetry={retry} />
    {!value && loading && <p className="text-sm text-slate-500">Chargement des élèves…</p>}
    {value && <p className="text-xs text-slate-500">{shown.length} élève(s)</p>}
    {shown.slice(0, 300).map((student) => <article key={student.id} className={card}>
      <p className="font-semibold text-ink">{student.name}</p>
      <p className="text-sm text-slate-600">{[student.className, student.section, student.matricule && `Matricule ${student.matricule}`, student.gender].filter(Boolean).join(" · ")}</p>
    </article>)}
    {shown.length > 300 && <p className="text-xs text-slate-500">Seuls les 300 premiers élèves sont affichés : précisez la recherche.</p>}
  </div>;
}

export function AdvisorGradesContent({ scope }: { scope: Scope }) {
  const { value, loading, error, retry } = useAdvisorData<{ sections: string[]; classes: AdvisorGradeClass[] }>("advisor-grades", scope);
  return <div className="grid gap-3">
    <p className="text-sm text-slate-600">Cotes en lecture seule (moyenne de la classe par période) · {sectionsNote(value?.sections)}</p>
    <ErrorNotice error={error} fallback="Cotes indisponibles." onRetry={retry} />
    {!value && loading && <p className="text-sm text-slate-500">Chargement des cotes…</p>}
    {value && value.classes.length === 0 && <p className={card}>Aucune cote complète pour le moment.</p>}
    {value?.classes.map((item) => <article key={item.classId} className={card}>
      <p className="font-semibold text-ink">{item.className} <span className="text-xs font-normal text-slate-500">· {item.section} · {item.students} élève(s)</span></p>
      {item.slots.length === 0 ? <p className="text-sm text-slate-500">Aucune période complète.</p> : <ul className="mt-1 grid gap-1 text-sm">{item.slots.map((slot) => <li key={slot.slot}>{slot.label} · moyenne {slot.average ?? "—"} % · {slot.evaluated} évalué(s)</li>)}</ul>}
    </article>)}
  </div>;
}

/** Calendrier scolaire en lecture seule (aucune modification possible). */
export function AdvisorCalendarContent({ user, school, year }: { user: AppUser; school: School; year: SchoolYear }) {
  const { calendar, loading, error, retry } = useSchoolCalendar(user, school.id, year.id);
  const events = calendar?.events ?? [];
  return <div className="grid gap-2">
    <p className="text-sm text-slate-600">Lecture seule.</p>
    <ErrorNotice error={error} onRetry={retry} />
    {loading && <p className="text-sm text-slate-500">Chargement du calendrier…</p>}
    {!loading && !error && events.length === 0 && <p className={card}>Aucun événement enregistré.</p>}
    {events.map((event) => <article key={event.id} className={card}><p className="font-semibold">{event.title}</p><p className="text-sm text-slate-600">{formatDay(event.startsAt)} — {formatDay(event.endsAt)}{event.suspendsCourses === true ? " · cours suspendus" : ""}</p></article>)}
  </div>;
}
