import { useEffect, useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import type { AppUser, Coordination, School, SchoolSection, SchoolYear, Student } from "../../types";
import { coordinationPdfInstitution } from "./coordinationPdfInstitution";
import { escapePdfHtml, pdfSection, pdfTable, renderAcadPdfPreview } from "../../utils/pdf";
import { formatStudentClassName, getClassSection } from "../../utils/studentClasses";
import { isArchivedStudent } from "../../utils/studentUtils";
import { getSchoolClassChoices } from "../../utils/schoolConfig";
import { canonicalSchoolOption, normalizeSchoolOptions } from "../../utils/schoolOptions";
import type { CoordinationStudentStatus } from "../../utils/coordinationSupervision";
import { COORDINATION_STUDENT_PAGE_SIZE, loadCoordinationStudentPage, loadCoordinationStudentYears, type CoordinationStudentCursor, type CoordinationStudentFilters, type CoordinationStudentPage } from "../../services/coordinationStudentPagination";
import { CoordinationStudentRecord } from "./CoordinationStudentRecord";

type Choice = { value: string; label: string; schoolId: string; name: string };
const emptyPage: CoordinationStudentPage = { students: [], fetchedDocuments: 0, queryCount: 0 };

export function CoordinationStudents({ user, coordination, schools, selectedSchoolId, refreshToken }: { user: AppUser; coordination: Coordination; schools: School[]; selectedSchoolId: string; refreshToken: number }) {
  const [years, setYears] = useState<SchoolYear[]>([]);
  const [yearsLoading, setYearsLoading] = useState(true);
  const [yearsError, setYearsError] = useState("");
  const [selectedYearId, setSelectedYearId] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<CoordinationStudentStatus>("all");
  const [classKey, setClassKey] = useState("");
  const [optionKey, setOptionKey] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [selectedStudentScope, setSelectedStudentScope] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [cursors, setCursors] = useState<Array<CoordinationStudentCursor | undefined>>([undefined]);
  const [page, setPage] = useState(emptyPage);
  const [pageKey, setPageKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const schoolIdsKey = schools.map((school) => school.id).sort().join("|");

  useEffect(() => {
    let cancelled = false;
    setYears([]); setYearsLoading(true); setYearsError("");
    loadCoordinationStudentYears(schoolIdsKey ? schoolIdsKey.split("|") : [])
      .then((value) => { if (!cancelled) setYears(value); })
      .catch(() => { if (!cancelled) setYearsError("Impossible de charger les années scolaires."); })
      .finally(() => { if (!cancelled) setYearsLoading(false); });
    return () => { cancelled = true; };
  }, [schoolIdsKey, refreshToken]);

  const visibleSchools = useMemo(() => schools.filter((school) => !selectedSchoolId || school.id === selectedSchoolId), [schools, selectedSchoolId]);
  const allowedSections = useMemo<SchoolSection[]>(() => user.sectionIds?.length ? user.sectionIds : user.section ? [user.section] : [], [user.section, user.sectionIds]);
  const classes = useMemo<Choice[]>(() => visibleSchools.flatMap((school) => getSchoolClassChoices(school).filter((name) => !allowedSections.length || allowedSections.includes(getClassSection(name))).map((name) => ({ value: `${school.id}::${name}`, label: `${name}${selectedSchoolId ? "" : ` — ${school.name}`}`, schoolId: school.id, name }))), [allowedSections, visibleSchools, selectedSchoolId]);
  const classChoice = classes.find((choice) => choice.value === classKey);
  const options = useMemo<Choice[]>(() => allowedSections.length && !allowedSections.includes("Secondaire") ? [] : visibleSchools.filter((school) => !classChoice || school.id === classChoice.schoolId).flatMap((school) => normalizeSchoolOptions(school.schoolOptions).map((name) => ({ value: `${school.id}::${canonicalSchoolOption(name)}`, label: `${name}${selectedSchoolId ? "" : ` — ${school.name}`}`, schoolId: school.id, name: canonicalSchoolOption(name) }))), [allowedSections, classChoice, visibleSchools, selectedSchoolId]);
  const optionChoice = options.find((choice) => choice.value === optionKey);
  const filters = useMemo<CoordinationStudentFilters>(() => ({ schools, years, selectedSchoolId, selectedYearId, filterSchoolId: classChoice?.schoolId || optionChoice?.schoolId || "", search, status, className: classChoice?.name ?? "", option: optionChoice?.name ?? "", allowedSections }), [allowedSections, classChoice?.name, classChoice?.schoolId, optionChoice?.name, optionChoice?.schoolId, schools, years, selectedSchoolId, selectedYearId, search, status]);
  const filterKey = JSON.stringify({ schools: schoolIdsKey, years: years.map((year) => year.id).sort(), selectedSchoolId, selectedYearId, search, status, classKey, optionKey, allowedSections, refreshToken });
  const currentPageKey = `${filterKey}|${pageIndex}`;
  const students = pageKey === currentPageKey ? page.students : [];

  useEffect(() => { setPageIndex(0); setCursors([undefined]); setPage(emptyPage); setPageKey(""); setSelectedStudent(null); }, [filterKey]);
  useEffect(() => {
    if (yearsLoading || yearsError || pageIndex >= cursors.length) return;
    let cancelled = false;
    setLoading(true); setLoadError("");
    loadCoordinationStudentPage(filters, cursors[pageIndex])
      .then((value) => { if (!cancelled) { setPage(value); setPageKey(currentPageKey); } })
      .catch(() => { if (!cancelled) setLoadError("Impossible de charger la page des élèves."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cursors, currentPageKey, filters, pageIndex, yearsError, yearsLoading]);

  useEffect(() => { if (classKey && !classes.some((choice) => choice.value === classKey)) setClassKey(""); }, [classKey, classes]);
  useEffect(() => { if (optionKey && !options.some((choice) => choice.value === optionKey)) setOptionKey(""); }, [optionKey, options]);
  useEffect(() => { if (selectedYearId && !years.some((year) => year.id === selectedYearId && (!selectedSchoolId || year.schoolId === selectedSchoolId))) setSelectedYearId(""); }, [selectedSchoolId, selectedYearId, years]);

  async function exportPdf() {
    const contextSchool = schools.find((school) => school.id === selectedSchoolId) ?? schools[0];
    if (!contextSchool || exporting) return;
    const schoolName = (schoolId: string) => schools.find((school) => school.id === schoolId)?.name ?? schoolId;
    setExporting(true); setExportError("");
    try {
      const exportStudents: Student[] = [];
      let cursor: CoordinationStudentCursor | undefined;
      do {
        const result = await loadCoordinationStudentPage(filters, cursor);
        exportStudents.push(...result.students);
        cursor = result.nextCursor;
      } while (cursor);
      await renderAcadPdfPreview({
        filename: `coordination-eleves-${selectedSchoolId || "toutes"}.pdf`, title: "Élèves — Coordination", school: coordinationPdfInstitution(coordination, contextSchool),
        subtitle: `École : ${selectedSchoolId ? contextSchool.name : "Toutes les écoles"} | Année : ${selectedYearId || "Toutes"} | Recherche : ${search || "Toutes"} | Statut : ${status === "all" ? "Tous" : status === "active" ? "Actifs" : "Archivés"} | Classe : ${classChoice?.label ?? "Toutes les classes"} | Option : ${optionChoice?.label ?? "Toutes les options"}`,
        sections: [pdfSection("Élèves", pdfTable([
          { header: "Matricule", render: (student) => escapePdfHtml(student.matricule || "—") },
          { header: "Élève", render: (student) => escapePdfHtml(`${student.nom} ${student.postnom} ${student.prenom}`.trim()) },
          { header: "École", render: (student) => escapePdfHtml(schoolName(student.schoolId)) },
          { header: "Classe", render: (student) => escapePdfHtml(formatStudentClassName(student)) },
        ], exportStudents, "Aucun élève dans le périmètre sélectionné."))],
      });
    } catch { setExportError("Impossible d’exporter les élèves."); }
    finally { setExporting(false); }
  }

  if (selectedStudent && selectedStudentScope === filterKey) return <CoordinationStudentRecord student={selectedStudent} user={user} schools={schools} years={years} onBack={() => setSelectedStudent(null)}/>;
  return <section className="grid min-w-0 gap-4">
    <div><h2 className="text-lg font-bold">Élèves</h2><p className="text-sm text-slate-600">Consultation en lecture seule · page {pageIndex + 1} · {students.length} élève(s) affiché(s).</p></div>
    <div className="grid w-full min-w-0 grid-cols-1 items-stretch gap-2 sm:grid-cols-2 xl:grid-cols-[repeat(5,minmax(0,1fr))_auto]">
      <label className="flex min-w-0 items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2"><Search className="h-4 w-4 shrink-0 text-slate-400"/><input className="min-w-0 flex-1 outline-none" placeholder="Rechercher" value={search} onChange={(event) => setSearch(event.target.value)}/></label>
      <select aria-label="Année scolaire" className="input min-w-0 w-full" value={selectedYearId} onChange={(event) => setSelectedYearId(event.target.value)}><option value="">Toutes les années</option>{years.filter((year) => !selectedSchoolId || year.schoolId === selectedSchoolId).map((year) => <option key={year.id} value={year.id}>{year.name}{selectedSchoolId ? "" : ` — ${schools.find((school) => school.id === year.schoolId)?.name ?? year.schoolId}`}</option>)}</select>
      <select aria-label="Statut des élèves" className="input min-w-0 w-full" value={status} onChange={(event) => setStatus(event.target.value as CoordinationStudentStatus)}><option value="all">Tous</option><option value="active">Actifs</option><option value="archived">Archivés</option></select>
      <select aria-label="Classe" className="input min-w-0 w-full" value={classKey} onChange={(event) => { setClassKey(event.target.value); setOptionKey(""); }}><option value="">Toutes les classes</option>{classes.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select>
      <select aria-label="Option" className="input min-w-0 w-full" value={optionKey} onChange={(event) => setOptionKey(event.target.value)}><option value="">Toutes les options</option>{options.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select>
      <button type="button" className="pdf-export-button min-w-0 w-full xl:w-auto" disabled={!students.length || exporting} onClick={() => void exportPdf()}><Download className="h-4 w-4"/> {exporting ? "Export…" : "Exporter PDF"}</button>
    </div>
    {(yearsLoading || loading) && <p role="status" className="rounded bg-blue-50 p-3 text-sm text-blue-700">Chargement des élèves…</p>}
    {(yearsError || loadError || exportError) && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{yearsError || loadError || exportError}</p>}
    {!yearsLoading && !loading && !yearsError && !loadError && <div className="max-w-full overflow-x-auto rounded border border-slate-200 bg-white"><table className="w-full min-w-[780px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Matricule</th><th className="p-3">Nom complet</th><th className="p-3">École</th><th className="p-3">Statut</th><th className="p-3">Sexe</th><th className="p-3">Classe</th></tr></thead><tbody>{students.map((student) => <tr key={student.id} className="border-t"><td className="p-3 font-semibold">{student.matricule}</td><td className="p-3"><button type="button" className="text-left font-semibold text-blue-700 hover:underline" onClick={() => { setSelectedStudent(student); setSelectedStudentScope(filterKey); }}>{student.nom} {student.postnom} {student.prenom}</button></td><td className="p-3">{schools.find((school) => school.id === student.schoolId)?.name ?? student.schoolId}</td><td className="p-3">{isArchivedStudent(student) ? "Archivé" : "Actif"}</td><td className="p-3">{student.sexe}</td><td className="p-3">{formatStudentClassName(student)}</td></tr>)}</tbody></table>{students.length === 0 && <p className="p-5 text-sm text-slate-500">Aucun élève dans le périmètre sélectionné.</p>}</div>}
    <nav aria-label="Pagination des élèves" className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>Page {pageIndex + 1} · {COORDINATION_STUDENT_PAGE_SIZE} élèves maximum par page</span><div className="flex gap-2"><button type="button" className="rounded border px-3 py-2 disabled:opacity-50" disabled={pageIndex === 0 || loading} onClick={() => setPageIndex((value) => value - 1)}>Précédente</button><button type="button" className="rounded border px-3 py-2 disabled:opacity-50" disabled={!page.nextCursor || pageKey !== currentPageKey || loading} onClick={() => { if (!page.nextCursor) return; setCursors((value) => [...value.slice(0, pageIndex + 1), page.nextCursor]); setPageIndex((value) => value + 1); }}>Suivante</button></div></nav>
  </section>;
}
