import { Download, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import type { DisciplineSanction, Student } from "../../types";

type DisciplineStatusProps = {
  sanctions: DisciplineSanction[];
  students: Student[];
  onNewSanction: () => void;
  onOpenStudent: (studentId: string) => void;
  onExportPdf: (sanctions: DisciplineSanction[]) => void;
};

function statusLabel(status: DisciplineSanction["status"]) {
  return status === "completed" ? "Purgée" : "Sanction en cours";
}

function sanctionDateKey(sanction: DisciplineSanction) {
  return sanction.createdAt || sanction.startDate || "";
}

export function DisciplineStatus({ sanctions, students, onNewSanction, onOpenStudent, onExportPdf }: DisciplineStatusProps) {
  const [status, setStatus] = useState<"all" | DisciplineSanction["status"]>("all");
  const [className, setClassName] = useState("all");
  const [search, setSearch] = useState("");
  const studentsById = useMemo(() => new Map(students.map((student) => [student.id, student])), [students]);
  const normalizedSearch = search.trim().toLowerCase();
  const classChoices = useMemo(() => Array.from(new Set(sanctions.map((sanction) => sanction.className).filter(Boolean))).sort((a, b) => a.localeCompare(b, "fr")), [sanctions]);
  const { sanctionedStudents, filteredSanctions } = useMemo(() => {
    const filteredSanctions = sanctions.filter((sanction) => {
      const student = studentsById.get(sanction.studentId);
      const fullName = `${student?.nom ?? ""} ${student?.postnom ?? ""} ${student?.prenom ?? ""}`.replace(/\s+/g, " ").trim();
      const searchText = [
        sanction.studentName,
        student?.nom,
        student?.postnom,
        student?.prenom,
        fullName,
        student?.matricule,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesSearch = !normalizedSearch || searchText.includes(normalizedSearch);
      const matchesStatus = status === "all" || sanction.status === status;
      const matchesClass = className === "all" || sanction.className === className;
      return matchesSearch && matchesStatus && matchesClass;
    });
    const groups = new Map<string, DisciplineSanction[]>();
    filteredSanctions.forEach((sanction) => {
      const current = groups.get(sanction.studentId) ?? [];
      current.push(sanction);
      groups.set(sanction.studentId, current);
    });

    const sanctionedStudents = Array.from(groups.entries())
      .map(([studentId, studentSanctions]) => {
        const sortedSanctions = [...studentSanctions].sort((first, second) => sanctionDateKey(second).localeCompare(sanctionDateKey(first)));
        const latestSanction = sortedSanctions[0];
        const student = studentsById.get(studentId);
        const fullName = `${student?.nom ?? ""} ${student?.postnom ?? ""} ${student?.prenom ?? ""}`.replace(/\s+/g, " ").trim();
        const studentName = latestSanction?.studentName ?? fullName ?? "Élève";
        const searchText = [
          studentName,
          student?.nom,
          student?.postnom,
          student?.prenom,
          fullName,
          student?.matricule,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        const hasActive = studentSanctions.some((sanction) => sanction.status === "active");
        const hasCompleted = studentSanctions.some((sanction) => sanction.status === "completed");
        return {
          studentId,
          studentName,
          className: latestSanction?.className ?? "",
          latestDate: latestSanction ? sanctionDateKey(latestSanction) : "",
          hasActive,
          hasCompleted,
          status: hasActive ? "active" as const : "completed" as const,
          sanctionsCount: studentSanctions.length,
          searchText,
        };
      })
      .sort((first, second) => second.latestDate.localeCompare(first.latestDate) || first.studentName.localeCompare(second.studentName, "fr"));

    return { sanctionedStudents, filteredSanctions };
  }, [className, normalizedSearch, sanctions, status, studentsById]);

  return (
    <section className="grid min-w-0 gap-3">
      <div className="grid min-w-0 gap-3 rounded border border-slate-200 bg-white p-4 shadow-sm">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase text-mint">Statut</p>
          <h1 className="break-words text-xl font-bold text-ink">Discipline</h1>
          <p className="mt-1 break-words text-sm text-slate-500">Élèves sanctionnés et suivi disciplinaire.</p>
        </div>
        <div className="grid min-w-0 gap-2 lg:grid-cols-[auto_minmax(12rem,1fr)_12rem_12rem_auto] lg:items-center">
          <button onClick={onNewSanction} className="primary-button w-full justify-center lg:w-auto" type="button">
            <Plus className="h-4 w-4" /> Nouvelle sanction
          </button>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="input"
            placeholder="Rechercher nom ou matricule"
          />
          <select value={status} onChange={(event) => setStatus(event.target.value as "all" | DisciplineSanction["status"])} className="input">
            <option value="all">Tous</option>
            <option value="active">Sanction en cours</option>
            <option value="completed">Purgée</option>
          </select>
          <select value={className} onChange={(event) => setClassName(event.target.value)} className="input">
            <option value="all">Toutes les classes</option>
            {classChoices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
          </select>
          <button onClick={() => onExportPdf(filteredSanctions)} className="primary-button w-full justify-center lg:w-auto" type="button">
            <Download className="h-4 w-4" /> Export PDF
          </button>
        </div>
      </div>

      <div className="grid min-w-0 gap-3">
        {sanctionedStudents.length === 0 && (
          <p className="rounded border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-500">Aucun élève ne correspond aux filtres.</p>
        )}
        {sanctionedStudents.map((student) => (
          <article key={student.studentId} className="min-w-0 rounded border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <button onClick={() => onOpenStudent(student.studentId)} className="break-words text-left font-bold text-ink transition hover:text-mint" type="button">
                  {student.studentName}
                </button>
                <p className="mt-1 break-words text-sm font-semibold text-slate-500">{student.className}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-2 py-1 text-xs font-bold ${student.status === "completed" ? "bg-mint/10 text-mint" : "bg-amber-100 text-amber-700"}`}>
                  {statusLabel(student.status)}
                </span>
                <span className="rounded bg-slate-50 px-2 py-1 text-xs font-bold text-slate-600">
                  {student.sanctionsCount} sanction(s)
                </span>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
