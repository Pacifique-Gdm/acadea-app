import { useCallback, useEffect, useRef, useState } from "react";
import { createOwnPayrollCache } from "../../components/personnel/ownPayrollCache";
import { AdminDrawer } from "../../components/ui/AdminDrawer";
import type { School, SchoolYear } from "../../types";
import { userFacingError } from "../../utils/userFacingError";
import { gradingSlotLabels, type EditableGradingSlot } from "../teacher/teacherGrading";
import { listParentPublishedGrades, readParentPublishedGrade, type PublishedChild, type PublishedIndividualResult } from "../teacher/gradePublicationService";
import { ErrorNotice } from "../../components/ui/ErrorNotice";

const percent = new Intl.NumberFormat("fr", { maximumFractionDigits: 2 });
// Lot 26b : le serveur des cotes peut mettre ~4 s à se réveiller ; la liste est préparée dès l'affichage du Menu.
const loadPublishedChildren = createOwnPayrollCache((key: string) => { const [schoolId, yearId] = key.split("|"); return listParentPublishedGrades(schoolId, yearId); });
export function prefetchParentPublishedGrades(schoolId: string, yearId: string) { void loadPublishedChildren(`${schoolId}|${yearId}`).catch(() => undefined); }

export function ParentPublishedGradesDrawer({ school, year, onClose, initialStudentId, initialSlot }: {
  school: School; year: SchoolYear; onClose: () => void; initialStudentId?: string; initialSlot?: EditableGradingSlot;
}) {
  const [children, setChildren] = useState<PublishedChild[]>([]);
  const [selected, setSelected] = useState<PublishedIndividualResult>();
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const firstLoad = useRef(true);
  const refresh = useCallback(async () => {
    try { setChildren((await loadPublishedChildren(`${school.id}|${year.id}`, !firstLoad.current)).children); setError(""); }
    catch (cause) { setError(userFacingError(cause, "Chargement impossible.")); }
    finally { setLoading(false); firstLoad.current = false; }
  }, [school.id, year.id]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [refresh]);
  const open = useCallback(async (studentId: string, slot: EditableGradingSlot) => {
    setSelected(undefined); setReading(true); setError("");
    try { setSelected((await readParentPublishedGrade(school.id, year.id, studentId, slot)).result); }
    catch (cause) { setError(userFacingError(cause, "Cotes indisponibles.")); }
    finally { setReading(false); }
  }, [school.id, year.id]);
  useEffect(() => {
    if (initialStudentId && initialSlot && !loading) void open(initialStudentId, initialSlot);
  }, [initialStudentId, initialSlot, loading, open]);

  return <AdminDrawer title="Côtes de mes enfants" closeLabel="Fermer les cotes de mes enfants" onClose={onClose}>
    {selected && <button type="button" className="secondary-button mb-3 w-full justify-center" onClick={() => setSelected(undefined)}>Retour aux enfants</button>}
    <ErrorNotice className="mb-3" error={error} onRetry={() => void refresh()} />
    {(loading || reading) && <p role="status">Chargement…</p>}
    {!loading && !selected && !reading && children.length === 0 && !error && <p className="rounded bg-slate-50 p-4 text-sm text-slate-700">Aucune fiche de cotes disponible.<br /><br />Les fiches consolidées de vos enfants apparaîtront ici dès leur publication par la direction des études.</p>}
    {!selected && <div className="grid gap-3">{children.map((child) => <article key={child.studentId} className="grid gap-2 rounded border bg-white p-4">
      <h3 className="font-bold">{child.studentName}</h3><p className="text-sm text-slate-600">{child.className} · {year.name}</p>
      <p className="text-sm">{child.publications.map((item) => gradingSlotLabels[item.slot]).join(" · ")}</p>
      <div className="grid gap-2">{child.publications.map((item) => <button key={item.slot} type="button" className="primary-button w-full justify-center" onClick={() => void open(child.studentId, item.slot)}>Consulter les cotes — {gradingSlotLabels[item.slot]}</button>)}</div>
    </article>)}</div>}
    {selected && <section className="grid gap-3">
      <div><h3 className="text-lg font-bold">{selected.studentName}</h3><p className="text-sm text-slate-600">{selected.className} · {selected.yearName} · {gradingSlotLabels[selected.slot]}</p></div>
      <div className="overflow-x-auto rounded border bg-white" role="region" aria-label="Cotes publiées de l'enfant" tabIndex={0}><table className="min-w-full text-sm"><thead><tr><th className="p-2 text-left">Cours</th><th className="p-2 text-left">Cote publiée</th></tr></thead><tbody>{selected.result.courses.map((course) => <tr key={`${course.classId}:${course.subjectId}`} className="border-t"><th className="p-2 text-left">{course.name}</th><td className="p-2">{course.status === "absent" ? "Absent" : course.score === null ? "—" : `${course.score} / ${course.maximum ?? "—"}`}</td></tr>)}</tbody></table></div>
      <p className="rounded bg-blue-50 p-3 font-semibold">{percent.format(selected.result.percentage)} % / {selected.result.rank}{selected.result.rank === 1 ? "er" : "ème"}</p>
    </section>}
  </AdminDrawer>;
}
