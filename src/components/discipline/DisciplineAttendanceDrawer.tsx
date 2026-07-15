import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Download, Plus, RotateCcw, Search } from "lucide-react";
import type { AttendanceRecord, AttendanceStatus, School, SchoolYear, Student } from "../../types";
import { pdfInfoGrid, pdfSection, pdfTable, renderAcadPdfPreview } from "../../utils/pdf";

type ManualAttendanceInput = {
  studentId: string;
  attendanceDate: string;
  status: AttendanceStatus;
  manualReason: string;
};

type AttendanceGroup = {
  key: string;
  className: string;
  option: string;
  students: Student[];
};

type DisciplineAttendanceDrawerProps = {
  students: Student[];
  attendance: AttendanceRecord[];
  school: School;
  year: SchoolYear;
  onSaveManualAttendance: (input: ManualAttendanceInput) => Promise<void>;
};

const weekDayLabels = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
const manualReasons = ["panne du terminal", "coupure d'électricité", "doigt blessé", "empreinte non reconnue", "élève non enrôlé", "autre"];
const statusLabels: Record<AttendanceStatus, string> = {
  present: "Présent",
  absent: "Absent",
  late: "Retard",
  excused: "Excusé",
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
  return student.className || "Classe non renseignée";
}

function studentOption(student: Student) {
  return student.option || "—";
}

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase("fr");
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
    .sort((first, second) => `${first.className} ${first.option}`.localeCompare(`${second.className} ${second.option}`, "fr"));
}

export function DisciplineAttendanceDrawer({ students, attendance, school, year, onSaveManualAttendance }: DisciplineAttendanceDrawerProps) {
  const [weekStart, setWeekStart] = useState(() => formatDateKey(startOfWeek(new Date())));
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedOption, setSelectedOption] = useState("");
  const [search, setSearch] = useState("");
  const [manualStudentId, setManualStudentId] = useState("");
  const [manualDate, setManualDate] = useState(() => formatDateKey(new Date()));
  const [manualStatus, setManualStatus] = useState<AttendanceStatus>("present");
  const [manualReason, setManualReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const weekDates = useMemo(() => {
    const start = parseLocalDate(weekStart);
    return Array.from({ length: 6 }, (_, index) => addDays(start, index));
  }, [weekStart]);
  const weekDateKeys = useMemo(() => weekDates.map(formatDateKey), [weekDates]);

  const classes = useMemo(() => {
    return Array.from(new Set(students.map(studentClassName).filter(Boolean))).sort((first, second) => first.localeCompare(second, "fr"));
  }, [students]);

  const options = useMemo(() => {
    const source = selectedClass ? students.filter((student) => studentClassName(student) === selectedClass) : students;
    return Array.from(new Set(source.map((student) => student.option).filter((option): option is string => Boolean(option)))).sort((first, second) => first.localeCompare(second, "fr"));
  }, [selectedClass, students]);

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
      .filter((student) => !selectedClass || studentClassName(student) === selectedClass)
      .filter((student) => !selectedOption || student.option === selectedOption)
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
  }, [search, selectedClass, selectedOption, students]);

  const groupedStudents = useMemo(() => groupStudents(filteredStudents), [filteredStudents]);
  const selectedManualStudent = students.find((student) => student.id === manualStudentId);
  const periodLabel = `${weekDates[0]?.toLocaleDateString("fr-FR") ?? ""} - ${weekDates[5]?.toLocaleDateString("fr-FR") ?? ""}`;

  async function saveManualAttendance() {
    setError("");
    if (!manualStudentId || !manualDate || !manualReason) {
      setError("Sélectionnez un élève, une date et un motif.");
      return;
    }
    setSaving(true);
    try {
      await onSaveManualAttendance({
        studentId: manualStudentId,
        attendanceDate: manualDate,
        status: manualStatus,
        manualReason,
      });
      setManualReason("");
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
              { header: "Classe", render: (student) => studentClassName(student) },
              { header: "Option", render: (student) => studentOption(student) },
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
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
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
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_auto]">
          <label className="relative min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full rounded border border-slate-200 bg-white py-3 pl-10 pr-3 text-sm outline-none transition focus:border-mint"
              placeholder="Rechercher nom, matricule ou classe"
            />
          </label>
          <select value={selectedClass} onChange={(event) => setSelectedClass(event.target.value)} className="input-field">
            <option value="">Toutes les classes</option>
            {classes.map((className) => (
              <option key={className} value={className}>{className}</option>
            ))}
          </select>
          <select value={selectedOption} onChange={(event) => setSelectedOption(event.target.value)} className="input-field">
            <option value="">Toutes les options</option>
            {options.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
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
        <div className="grid gap-2 lg:grid-cols-[1.4fr_0.8fr_0.8fr_1fr_auto]">
          <select value={manualStudentId} onChange={(event) => setManualStudentId(event.target.value)} className="input-field">
            <option value="">Sélectionner un élève</option>
            {students
              .slice()
              .sort((first, second) => studentFullName(first).localeCompare(studentFullName(second), "fr"))
              .map((student) => (
                <option key={student.id} value={student.id}>
                  {studentFullName(student)} - {studentClassName(student)}
                </option>
              ))}
          </select>
          <input value={manualDate} onChange={(event) => setManualDate(event.target.value)} className="input-field" type="date" />
          <select value={manualStatus} onChange={(event) => setManualStatus(event.target.value as AttendanceStatus)} className="input-field">
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select value={manualReason} onChange={(event) => setManualReason(event.target.value)} className="input-field">
            <option value="">Motif obligatoire</option>
            {manualReasons.map((reason) => (
              <option key={reason} value={reason}>{reason}</option>
            ))}
          </select>
          <button onClick={saveManualAttendance} disabled={saving || !manualStudentId || !manualDate || !manualReason} className="primary-button justify-center disabled:cursor-not-allowed disabled:opacity-50" type="button">
            <Plus className="h-4 w-4" /> Enregistrer
          </button>
        </div>
        {selectedManualStudent && <p className="text-sm font-semibold text-slate-500">Élève sélectionné : {studentFullName(selectedManualStudent)}</p>}
        {error && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
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
                      <th key={formatDateKey(date)} className="px-3 py-3">
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
                          <td key={`${student.id}-${dateKey}`} className="px-3 py-3">
                            {record ? (
                              <span className="inline-flex rounded bg-mint/10 px-2 py-1 text-xs font-bold text-mint">
                                {statusLabels[record.status]}
                              </span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                            {record?.source === "manual" && <span className="mt-1 block text-[11px] font-semibold text-slate-400">Manuel</span>}
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
