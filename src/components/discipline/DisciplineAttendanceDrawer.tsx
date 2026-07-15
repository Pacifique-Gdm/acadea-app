import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Download, Plus, RotateCcw, Search } from "lucide-react";
import type { AttendanceRecord, AttendanceStatus, School, SchoolSection, SchoolYear, Student } from "../../types";
import { pdfInfoGrid, pdfSection, pdfTable, renderAcadPdfPreview } from "../../utils/pdf";

type ManualAttendanceInput = {
  studentId: string;
  attendanceDate: string;
  status: AttendanceStatus;
  manualReason: string;
};

type ManualAttendanceSaveResult = {
  created: number;
  existing: number;
  failed: number;
};

type AttendanceGroup = {
  key: string;
  className: string;
  option: string;
  students: Student[];
};

type AttendanceSectionFilter = "all" | SchoolSection;

type DisciplineAttendanceDrawerProps = {
  students: Student[];
  attendance: AttendanceRecord[];
  school: School;
  year: SchoolYear;
  onSaveManualAttendance: (input: ManualAttendanceInput[]) => Promise<ManualAttendanceSaveResult>;
};

const weekDayLabels = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
const manualReasons = ["panne du terminal", "coupure d'électricité", "doigt blessé", "empreinte non reconnue", "élève non enrôlé", "autre"];
const statusLabels: Record<AttendanceStatus, string> = {
  present: "Présent",
  absent: "Absent",
  late: "Retard",
  excused: "Excusé",
};
const sectionLabels: Record<AttendanceSectionFilter, string> = {
  all: "Toutes les sections",
  maternelle: "Maternelle",
  primaire: "Primaire",
  secondaire: "Secondaire",
};

function parseLocalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function startOfWeek(date: Date) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const mondayOffset = (next.getDay() + 6) % 7;
  next.setDate(next.getDate() - mondayOffset);
  return next;
}

function studentFullName(student: Student) {
  return [student.nom, student.postnom, student.prenom].filter(Boolean).join(" ").trim();
}

function studentClassName(student: Student) {
  return String(student.className || "Classe non renseignée");
}

function classSection(className: string): SchoolSection {
  if (className.includes("Maternelle")) return "maternelle";
  if (className.includes("Humanité")) return "secondaire";
  return "primaire";
}

function studentOption(student: Student) {
  return student.option || "—";
}

function normalizeEducationLevel(level: string) {
  const normalized = level.trim().toLocaleLowerCase("fr");
  if (normalized === "maternelle") return "maternelle";
  if (normalized === "primaire") return "primaire";
  if (normalized === "secondaire") return "secondaire";
  if (normalized === "mixte") return "all";
  return "";
}

function configuredSchoolSections(school: School): SchoolSection[] {
  const levels = (school.educationLevels ?? []).map(normalizeEducationLevel).filter((level): level is AttendanceSectionFilter => Boolean(level));
  const uniqueLevels = Array.from(new Set(levels));
  if (uniqueLevels.includes("all")) return ["maternelle", "primaire", "secondaire"] satisfies SchoolSection[];
  if (uniqueLevels.length > 0) return uniqueLevels.filter((level): level is SchoolSection => level !== "all");
  const schoolType = normalizeEducationLevel(school.schoolType ?? "");
  if (schoolType === "all") return ["maternelle", "primaire", "secondaire"] satisfies SchoolSection[];
  return schoolType ? [schoolType] : ([] as SchoolSection[]);
}

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase("fr");
}

function normalizeClassSortValue(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr");
}

function classSortRank(className: string) {
  const normalized = normalizeClassSortValue(className);
  const ordinalMatch = normalized.match(/(\d+)/);
  const ordinal = ordinalMatch ? Number(ordinalMatch[1]) : 99;
  if (normalized.includes("maternelle")) {
    const maternelleLevel = normalized.includes("petite") ? 1 : normalized.includes("moyenne") ? 2 : normalized.includes("grande") ? 3 : ordinal;
    return { section: 0, level: maternelleLevel };
  }
  if (ordinal === 7) return { section: 2, level: 7 };
  if (ordinal === 8) return { section: 3, level: 8 };
  if (normalized.includes("humanite") || normalized.includes("secondaire")) return { section: 4, level: ordinal };
  if (ordinal >= 1 && ordinal <= 6) return { section: 1, level: ordinal };
  return { section: 5, level: ordinal };
}

function compareClassNames(first: string, second: string) {
  const firstRank = classSortRank(first);
  const secondRank = classSortRank(second);
  if (firstRank.section !== secondRank.section) return firstRank.section - secondRank.section;
  if (firstRank.level !== secondRank.level) return firstRank.level - secondRank.level;
  return first.localeCompare(second, "fr", { numeric: true, sensitivity: "base" });
}

function compareAttendanceGroups(first: AttendanceGroup, second: AttendanceGroup) {
  const classOrder = compareClassNames(first.className, second.className);
  if (classOrder !== 0) return classOrder;
  return first.option.localeCompare(second.option, "fr", { numeric: true, sensitivity: "base" });
}

function groupStudents(students: Student[]) {
  const groups = new Map<string, AttendanceGroup>();
  students.forEach((student) => {
    const className = studentClassName(student);
    const option = studentOption(student);
    const key = `${className}__${option}`;
    const existing = groups.get(key);
    if (existing) {
      existing.students.push(student);
      return;
    }
    groups.set(key, { key, className, option, students: [student] });
  });
  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      students: [...group.students].sort((first, second) => studentFullName(first).localeCompare(studentFullName(second), "fr")),
    }))
    .sort(compareAttendanceGroups);
}

export function DisciplineAttendanceDrawer({ students, attendance, school, year, onSaveManualAttendance }: DisciplineAttendanceDrawerProps) {
  const [weekStart, setWeekStart] = useState(() => formatDateKey(startOfWeek(new Date())));
  const [selectedSection, setSelectedSection] = useState<AttendanceSectionFilter>("all");
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedOption, setSelectedOption] = useState("");
  const [search, setSearch] = useState("");
  const [manualStudentIds, setManualStudentIds] = useState<string[]>([]);
  const [manualStudentSearch, setManualStudentSearch] = useState("");
  const [manualDate, setManualDate] = useState(() => formatDateKey(new Date()));
  const [manualStatus, setManualStatus] = useState<AttendanceStatus>("present");
  const [manualReason, setManualReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const todayKey = formatDateKey(new Date());

  const weekDates = useMemo(() => {
    const start = parseLocalDate(weekStart);
    return Array.from({ length: 6 }, (_, index) => addDays(start, index));
  }, [weekStart]);
  const weekDateKeys = useMemo(() => weekDates.map(formatDateKey), [weekDates]);

  const sectionChoices = useMemo(() => configuredSchoolSections(school), [school]);

  const classes = useMemo(() => {
    return Array.from(
      new Set(
        students
          .map(studentClassName)
          .filter((className) => selectedSection === "all" || classSection(className) === selectedSection),
      ),
    ).sort(compareClassNames);
  }, [selectedSection, students]);

  const options = useMemo(() => {
    const source = students
      .filter((student) => selectedSection === "all" || classSection(studentClassName(student)) === selectedSection)
      .filter((student) => !selectedClass || studentClassName(student) === selectedClass);
    return Array.from(new Set(source.map((student) => student.option).filter((option): option is string => Boolean(option)))).sort((first, second) => first.localeCompare(second, "fr"));
  }, [selectedClass, selectedSection, students]);
  const showOptionFilter =
    (selectedSection === "all" || selectedSection === "secondaire") &&
    (!selectedClass || classSection(selectedClass) === "secondaire");

  const attendanceByStudentDate = useMemo(() => {
    const records = new Map<string, AttendanceRecord>();
    attendance.forEach((record) => {
      records.set(`${record.studentId}__${record.attendanceDate}`, record);
    });
    return records;
  }, [attendance]);

  const filteredStudents = useMemo(() => {
    const normalizedSearch = normalizeSearch(search);
    return students
      .filter((student) => selectedSection === "all" || classSection(studentClassName(student)) === selectedSection)
      .filter((student) => !selectedClass || studentClassName(student) === selectedClass)
      .filter((student) => !showOptionFilter || !selectedOption || student.option === selectedOption)
      .filter((student) => {
        if (!normalizedSearch) return true;
        const haystack = [
          student.nom,
          student.postnom,
          student.prenom,
          studentFullName(student),
          student.matricule,
          studentClassName(student),
          student.option,
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("fr");
        return haystack.includes(normalizedSearch);
      })
      .sort((first, second) => studentFullName(first).localeCompare(studentFullName(second), "fr"));
  }, [search, selectedClass, selectedOption, selectedSection, showOptionFilter, students]);

  const groupedStudents = useMemo(() => groupStudents(filteredStudents), [filteredStudents]);
  const hasManualStudentSearch = normalizeSearch(manualStudentSearch).length > 0;
  const manualStudentResults = useMemo(() => {
    const normalizedSearch = normalizeSearch(manualStudentSearch);
    if (!normalizedSearch) return [];
    return students
      .filter((student) => selectedSection === "all" || classSection(studentClassName(student)) === selectedSection)
      .filter((student) => !selectedClass || studentClassName(student) === selectedClass)
      .filter((student) => !showOptionFilter || !selectedOption || student.option === selectedOption)
      .filter((student) => {
        if (!normalizedSearch) return true;
        const haystack = [
          student.nom,
          student.postnom,
          student.prenom,
          studentFullName(student),
          student.matricule,
          studentClassName(student),
          student.option,
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("fr");
        return haystack.includes(normalizedSearch);
      })
      .sort((first, second) => studentFullName(first).localeCompare(studentFullName(second), "fr"));
  }, [manualStudentSearch, selectedClass, selectedOption, selectedSection, showOptionFilter, students]);
  const selectedManualStudents = useMemo(
    () => manualStudentIds.map((studentId) => students.find((student) => student.id === studentId)).filter((student): student is Student => Boolean(student)),
    [manualStudentIds, students],
  );
  const periodLabel = `${weekDates[0]?.toLocaleDateString("fr-FR") ?? ""} - ${weekDates[5]?.toLocaleDateString("fr-FR") ?? ""}`;

  useEffect(() => {
    if (selectedClass && !classes.includes(selectedClass)) {
      setSelectedClass("");
    }
  }, [classes, selectedClass]);

  useEffect(() => {
    if (!showOptionFilter && selectedOption) {
      setSelectedOption("");
    }
  }, [selectedOption, showOptionFilter]);

  useEffect(() => {
    if (!success) return undefined;
    const timer = window.setTimeout(() => setSuccess(""), 4000);
    return () => window.clearTimeout(timer);
  }, [success]);

  function toggleManualStudent(studentId: string) {
    setManualStudentIds((current) =>
      current.includes(studentId) ? current.filter((item) => item !== studentId) : [...current, studentId],
    );
  }

  async function saveManualAttendance() {
    setError("");
    setSuccess("");
    if (manualStudentIds.length === 0 || !manualDate || !manualReason) {
      setError("Sélectionnez au moins un élève, une date et un motif.");
      return;
    }
    if (manualDate > todayKey) {
      setError("Impossible d'enregistrer une présence pour une date future.");
      return;
    }
    setSaving(true);
    try {
      const result = await onSaveManualAttendance(
        manualStudentIds.map((studentId) => ({
          studentId,
          attendanceDate: manualDate,
          status: manualStatus,
          manualReason,
        })),
      );
      if (result.created === 0 && result.existing === 0 && result.failed > 0) {
        setError(`${result.failed} présence(s) n'ont pas pu être enregistrée(s).`);
        return;
      }
      setManualStudentIds([]);
      setManualStudentSearch("");
      setManualDate(todayKey);
      setManualStatus("present");
      setManualReason("");
      const summaryParts = [];
      if (result.created > 0) summaryParts.push(`${result.created} présence(s) enregistrée(s) avec succès`);
      if (result.existing > 0) summaryParts.push(`${result.existing} présence(s) déjà enregistrée(s)`);
      if (result.failed > 0) summaryParts.push(`${result.failed} échec(s)`);
      setSuccess(summaryParts.length > 0 ? `${summaryParts.join(". ")}.` : "Présence enregistrée avec succès.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Impossible d'enregistrer la présence manuelle.");
    } finally {
      setSaving(false);
    }
  }

  async function exportAttendancePdf() {
    const sections = groupedStudents.map((group, index) =>
      pdfSection(
        `${group.className}${group.option !== "—" ? ` - ${group.option}` : ""}`,
        [
          pdfInfoGrid([
            { label: "Classe", value: group.className },
            { label: "Option", value: group.option },
            { label: "Période", value: periodLabel },
          ]),
          pdfTable(
            [
              { header: "N°", render: (_student, studentIndex) => studentIndex + 1, align: "center" },
              { header: "Nom et postnom", render: (student) => studentFullName(student) },
              ...weekDateKeys.map((dateKey, dayIndex) => ({
                header: `${weekDayLabels[dayIndex]} ${weekDates[dayIndex].toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}`,
                render: (student: Student) => {
                  const record = attendanceByStudentDate.get(`${student.id}__${dateKey}`);
                  return record ? statusLabels[record.status] : "—";
                },
              })),
            ],
            group.students,
            "Aucun élève pour cette sélection.",
          ),
        ].join(""),
        { pageBreakBefore: index > 0 },
      ),
    );

    await renderAcadPdfPreview({
      filename: `presence-${year.name}-${weekStart}.pdf`,
      title: "Fiche hebdomadaire de présence",
      school,
      year,
      subtitle: `Période : ${periodLabel}`,
      sections: sections.length > 0 ? sections : [pdfSection("Présence des élèves", "Aucun élève pour cette sélection.")],
    });
  }

  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid gap-3 rounded border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-500">Semaine</p>
            <h2 className="break-words text-lg font-bold text-ink">{periodLabel}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setWeekStart(formatDateKey(addDays(parseLocalDate(weekStart), -7)))} className="secondary-button" type="button">
              <ChevronLeft className="h-4 w-4" /> Précédente
            </button>
            <button onClick={() => setWeekStart(formatDateKey(startOfWeek(new Date())))} className="secondary-button" type="button">
              <RotateCcw className="h-4 w-4" /> Semaine actuelle
            </button>
            <button onClick={() => setWeekStart(formatDateKey(addDays(parseLocalDate(weekStart), 7)))} className="secondary-button" type="button">
              Suivante <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(220px,0.9fr)_minmax(150px,0.65fr)_minmax(150px,0.65fr)_minmax(190px,0.85fr)_auto]">
          <label className="relative min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="input pl-10"
              placeholder="Rechercher nom, matricule ou classe"
            />
          </label>
          <select
            value={selectedSection}
            onChange={(event) => {
              setSelectedSection(event.target.value as AttendanceSectionFilter);
              setSelectedClass("");
              setSelectedOption("");
            }}
            className="input"
            aria-label="Section"
          >
            <option value="all">{sectionLabels.all}</option>
            {sectionChoices.map((section) => (
              <option key={section} value={section}>{sectionLabels[section]}</option>
            ))}
          </select>
          <select value={selectedClass} onChange={(event) => setSelectedClass(event.target.value)} className="input" aria-label="Classe">
            <option value="">Toutes les classes</option>
            {classes.map((className) => (
              <option key={className} value={className}>{className}</option>
            ))}
          </select>
          {showOptionFilter && (
            <select value={selectedOption} onChange={(event) => setSelectedOption(event.target.value)} className="input" aria-label="Option">
              <option value="">Toutes les options</option>
              {options.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          )}
          {!showOptionFilter && <div className="hidden xl:block" aria-hidden="true" />}
          <button onClick={exportAttendancePdf} className="primary-button justify-center" type="button">
            <Download className="h-4 w-4" /> Exporter PDF
          </button>
        </div>
      </div>

      <section className="grid gap-3 rounded border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-mint" />
          <h2 className="font-bold text-ink">Présence manuelle exceptionnelle</h2>
        </div>
        <div className="grid gap-3">
          <div className="grid gap-2 xl:grid-cols-[minmax(220px,0.9fr)_minmax(150px,0.65fr)_minmax(150px,0.65fr)_minmax(190px,0.85fr)_auto]">
            <label className="relative min-w-0">
              <span className="sr-only">La recherche affiche les résultats disponibles pour la sélection manuelle.</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={manualStudentSearch}
                onChange={(event) => setManualStudentSearch(event.target.value)}
                className="input pl-10"
                placeholder="Rechercher un élève"
              />
            </label>
            <input value={manualDate} onChange={(event) => setManualDate(event.target.value)} className="input" max={todayKey} type="date" aria-label="Date" />
            <select value={manualStatus} onChange={(event) => setManualStatus(event.target.value as AttendanceStatus)} className="input" aria-label="Statut">
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <select value={manualReason} onChange={(event) => setManualReason(event.target.value)} className="input" required aria-label="Motif">
              <option value="" disabled hidden>Motif</option>
              {manualReasons.map((reason) => (
                <option key={reason} value={reason}>{reason}</option>
              ))}
            </select>
            <button onClick={saveManualAttendance} disabled={saving || manualStudentIds.length === 0 || !manualDate || !manualReason} className="primary-button justify-center self-end disabled:cursor-not-allowed disabled:opacity-50" type="button">
              <Plus className="h-4 w-4" /> Enregistrer
            </button>
          </div>
          {hasManualStudentSearch && (
            <div className="max-h-64 overflow-y-auto rounded border border-slate-200 bg-slate-50 p-2">
              {manualStudentResults.map((student) => {
                const checked = manualStudentIds.includes(student.id);
                return (
                  <label key={student.id} className={`mb-2 flex cursor-pointer items-start gap-3 rounded bg-white p-3 text-sm transition last:mb-0 ${checked ? "ring-2 ring-mint/40" : "hover:bg-slate-100"}`}>
                    <input
                      checked={checked}
                      onChange={() => toggleManualStudent(student.id)}
                      className="mt-1 h-4 w-4 shrink-0 accent-mint"
                      type="checkbox"
                    />
                    <span className="min-w-0">
                      <span className="block break-words font-bold text-ink">{studentFullName(student)}</span>
                      <span className="block break-words text-xs font-semibold text-slate-500">
                        {student.matricule || "Matricule non renseigné"} · {studentClassName(student)}{student.option ? ` · ${student.option}` : ""}
                      </span>
                    </span>
                  </label>
                );
              })}
              {manualStudentResults.length === 0 && <p className="rounded bg-white p-3 text-sm font-semibold text-slate-500">Aucun élève trouvé.</p>}
            </div>
          )}
          {selectedManualStudents.length > 0 && (
            <div className="flex flex-wrap gap-2 rounded bg-mint/10 p-3">
              {selectedManualStudents.map((student) => (
                <span key={student.id} className="inline-flex max-w-full items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-bold text-mint">
                  <span className="min-w-0 truncate">{studentFullName(student)}</span>
                  <button onClick={() => toggleManualStudent(student.id)} className="rounded-full p-0.5 transition hover:bg-mint/10" type="button" aria-label={`Retirer ${studentFullName(student)}`}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        {error && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
        {success && <p className="rounded border border-mint/30 bg-mint/10 p-3 text-sm font-semibold text-mint">{success}</p>}
        <p className="text-xs font-semibold text-slate-500">Source enregistrée : manuel. Aucune empreinte biométrique brute n'est stockée.</p>
      </section>

      <section className="grid min-w-0 gap-4">
        {groupedStudents.length === 0 && (
          <p className="rounded border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-500">Aucun élève ne correspond à cette sélection.</p>
        )}
        {groupedStudents.map((group) => (
          <article key={group.key} className="min-w-0 overflow-hidden rounded border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-4">
              <h2 className="break-words font-bold text-ink">{group.className}{group.option !== "—" ? ` - ${group.option}` : ""}</h2>
              <p className="mt-1 text-sm font-semibold text-slate-500">{group.students.length} élève(s)</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[980px] w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-3">N°</th>
                    <th className="px-3 py-3">Nom et postnom</th>
                    <th className="px-3 py-3">Classe</th>
                    <th className="px-3 py-3">Option</th>
                    {weekDates.map((date, index) => (
                      <th key={formatDateKey(date)} className="px-3 py-3 text-center">
                        {weekDayLabels[index]}
                        <span className="block font-semibold normal-case text-slate-400">{date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {group.students.map((student, index) => (
                    <tr key={student.id} className="align-top">
                      <td className="px-3 py-3 font-semibold text-slate-500">{index + 1}</td>
                      <td className="px-3 py-3 font-semibold text-ink">
                        {studentFullName(student)}
                        <span className="block text-xs font-semibold text-slate-400">{student.matricule || "Matricule non renseigné"}</span>
                      </td>
                      <td className="px-3 py-3 text-slate-600">{studentClassName(student)}</td>
                      <td className="px-3 py-3 text-slate-600">{studentOption(student)}</td>
                      {weekDateKeys.map((dateKey) => {
                        const record = attendanceByStudentDate.get(`${student.id}__${dateKey}`);
                        return (
                          <td key={`${student.id}-${dateKey}`} className="px-3 py-3 text-center align-middle">
                            <div className="flex min-h-10 flex-col items-center justify-center">
                              {record ? (
                                <span className="inline-flex items-center justify-center rounded bg-mint/10 px-2 py-1 text-center text-xs font-bold text-mint">
                                  {statusLabels[record.status]}
                                </span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                              {record?.source === "manual" && <span className="mt-1 block text-center text-[11px] font-semibold text-slate-400">Manuel</span>}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
