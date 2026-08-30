import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { AdminDrawer, Metric } from "../ui";
import { getSchoolSections, schoolSectionLabels } from "../../utils/schoolConfig";
import { canonicalOperationalClasses, studentBelongsToOperationalClass, subscribeToSchoolClasses } from "../../services/schoolSubclasses";
import { getClassSection, getStudentSection } from "../../utils/studentClasses";
import { exportAgeHomogeneityPdf } from "../../utils/studentPdf";
import { isArchivedStudent } from "../../utils/studentUtils";
import type { AppData, AppUser, School, SchoolSection, SchoolYear, Student } from "../../types";

type SharedToolProps = {
  open: boolean;
  onClose: () => void;
  user: AppUser;
  data: AppData;
  school: School;
  year: SchoolYear;
};

export { ArchivedStudentsImportDrawer } from "./ArchivedStudentsImportDrawer";

export function AgeHomogeneityDrawer({ open, onClose, user, data, school, year, allowedSections, studentSource, classSource }: Omit<SharedToolProps, "data"> & { data?: AppData; allowedSections?: SchoolSection[]; studentSource?: Student[]; classSource?: import("../../types").SchoolClassRecord[] }) {
  const [section, setSection] = useState<"all" | SchoolSection>("all");
  const [className, setClassName] = useState("");
  const [archiveStatus, setArchiveStatus] = useState<"all" | "active" | "archived">("all");
  const [realtimeClasses, setRealtimeClasses] = useState<import("../../types").SchoolClassRecord[]>(classSource ?? []);
  useEffect(() => {
    if (classSource) { setRealtimeClasses(classSource); return undefined; }
    if (!open) return undefined;
    return subscribeToSchoolClasses(school.id, year.id, setRealtimeClasses, () => setRealtimeClasses([]));
  }, [classSource, open, school.id, year.id]);
  const sections = getSchoolSections(school).filter((item) => !allowedSections?.length || allowedSections.includes(item));
  const scopedStudents = useMemo(() => (studentSource ?? data?.students ?? []).filter((student) => (
    student.schoolId === school.id
    && student.schoolYearId === year.id
    && (!allowedSections?.length || allowedSections.includes(getStudentSection(student)))
    && (section === "all" || getClassSection(student.className) === section)
    && (archiveStatus === "all" || (archiveStatus === "archived" ? isArchivedStudent(student) : !isArchivedStudent(student)))
  )), [allowedSections, archiveStatus, data?.students, school.id, section, studentSource, year.id]);
  const classes = useMemo(() => {
    return canonicalOperationalClasses(realtimeClasses, studentSource ?? data?.students ?? [], school.id, year.id, allowedSections)
      .filter((item) => section === "all" || getClassSection(item.name as import("../../types").SchoolClass) === section);
  }, [allowedSections, data?.students, realtimeClasses, school.id, section, studentSource, year.id]);
  const students = useMemo(() => scopedStudents.filter((student) => (
    !className || Boolean(classes.find((item) => item.id === className && studentBelongsToOperationalClass(student, item)))
  )), [className, classes, scopedStudents]);
  const canView = (user.role === "secretary" || user.role === "study_director") && user.status === "active" && user.schoolId === school.id;

  if (!open) return null;
  return (
    <AdminDrawer title="Tableau d’homogénéité d’âge" onClose={onClose} closeLabel="Fermer le tableau d’homogénéité d’âge">
      <div className="grid min-w-0 gap-4">
        {!canView && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">Votre compte ne permet pas de consulter ce tableau.</p>}
        <div className="grid min-w-0 grid-cols-3 gap-2">
          <select value={archiveStatus} onChange={(event) => setArchiveStatus(event.target.value as typeof archiveStatus)} className="input" aria-label="Statut des élèves">
            <option value="all">Tous les statuts</option><option value="active">Actifs</option><option value="archived">Archivés</option>
          </select>
          <select value={section} onChange={(event) => { setSection(event.target.value as typeof section); setClassName(""); }} className="input" aria-label="Section">
            <option value="all">Toutes les sections</option>{sections.map((item) => <option key={item} value={item}>{schoolSectionLabels[item]}</option>)}
          </select>
          <select value={className} onChange={(event) => setClassName(event.target.value)} className="input min-w-0" aria-label="Classe">
            <option value="">Toutes les classes</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <Metric label="Élèves analysés" value={String(students.length)} />
        {students.length === 0 && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucun élève ne correspond aux filtres sélectionnés.</p>}
        <button type="button" disabled={!canView || students.length === 0} onClick={() => void exportAgeHomogeneityPdf(school, year, students, {
          sectionLabel: section === "all" ? "Toutes les sections" : schoolSectionLabels[section],
          classLabel: classes.find((item) => item.id === className)?.name ?? "Toutes les classes",
          statusLabel: archiveStatus === "all" ? "Tous les statuts" : archiveStatus === "active" ? "Actifs" : "Archivés",
        })} className="primary-button justify-center disabled:cursor-not-allowed disabled:opacity-50">
          <Download className="h-4 w-4" /> Imprimer / exporter le tableau
        </button>
      </div>
    </AdminDrawer>
  );
}
