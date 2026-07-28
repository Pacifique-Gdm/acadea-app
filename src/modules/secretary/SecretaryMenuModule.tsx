import { useEffect, useState } from "react";
import { BarChart3, HeartPulse, LogOut, Upload } from "lucide-react";
import { AgeHomogeneityDrawer, ArchivedStudentsImportDrawer } from "../../components/students/StudentAdministrativeTools";
import { SectionTitle } from "../../components/ui";
import { subscribeToStudentMedicalRecords } from "../../services/studentMedicalRecords";
import type { AppData, AppUser, School, SchoolYear, Student } from "../../types";
import { SecretaryMedicalRecordsDrawer, SecretaryStatisticsDrawer } from "./SecretaryMedicalTools";
import type { StudentMedicalRecord } from "./secretaryTypes";

export function SecretaryMenuModule({ user, data, yearData, school, year, updateData, createId, studentImportKey, onLogout }: { user: AppUser; data: AppData; yearData: Pick<AppData, "students">; school: School; year: SchoolYear; updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void; createId: (prefix: string) => string; studentImportKey: (student: Student) => string; onLogout: () => void }) {
  const [importDrawerOpen, setImportDrawerOpen] = useState(false);
  const [ageDrawerOpen, setAgeDrawerOpen] = useState(false);
  const [statisticsDrawerOpen, setStatisticsDrawerOpen] = useState(false);
  const [medicalDrawerOpen, setMedicalDrawerOpen] = useState(false);
  const [medicalRecords, setMedicalRecords] = useState<StudentMedicalRecord[]>([]);
  const [medicalError, setMedicalError] = useState("");

  useEffect(() => {
    if (!statisticsDrawerOpen && !medicalDrawerOpen) return undefined;
    return subscribeToStudentMedicalRecords({ user, schoolId: school.id, schoolYearId: year.id, onData: (records) => { setMedicalRecords(records); setMedicalError(""); }, onError: () => setMedicalError("Impossible d'actualiser les fiches médicales pour le moment.") });
  }, [medicalDrawerOpen, school.id, statisticsDrawerOpen, user, year.id]);

  return <section className="grid gap-4"><SectionTitle title="Menu" subtitle="Fonctions administratives secondaires." />
    <div className="grid gap-3">
      <button type="button" onClick={() => setImportDrawerOpen(true)} className="flex min-w-0 items-center gap-3 rounded border border-slate-200 bg-white p-4 text-left transition hover:border-blue-300 hover:bg-blue-50/40">
        <span className="rounded bg-blue-50 p-2 text-blue-700"><Upload className="h-5 w-5" /></span>
        <span className="font-bold text-ink">Importer les élèves d’une année archivée</span>
      </button>
      <button type="button" onClick={() => setAgeDrawerOpen(true)} className="flex min-w-0 items-center gap-3 rounded border border-slate-200 bg-white p-4 text-left transition hover:border-blue-300 hover:bg-blue-50/40">
        <span className="rounded bg-blue-50 p-2 text-blue-700"><BarChart3 className="h-5 w-5" /></span>
        <span className="font-bold text-ink">Tableau d’homogénéité d’âge</span>
      </button>
      <button type="button" onClick={() => setStatisticsDrawerOpen(true)} className="flex min-w-0 items-center gap-3 rounded border border-slate-200 bg-white p-4 text-left transition hover:border-blue-300 hover:bg-blue-50/40">
        <span className="rounded bg-blue-50 p-2 text-blue-700"><BarChart3 className="h-5 w-5" /></span><span className="font-bold text-ink">Statistiques</span>
      </button>
      <button type="button" onClick={() => setMedicalDrawerOpen(true)} className="flex min-w-0 items-center gap-3 rounded border border-slate-200 bg-white p-4 text-left transition hover:border-blue-300 hover:bg-blue-50/40">
        <span className="rounded bg-blue-50 p-2 text-blue-700"><HeartPulse className="h-5 w-5" /></span><span className="font-bold text-ink">Fiches médicales</span>
      </button>
      <button onClick={onLogout} className="inline-flex w-full items-center justify-center gap-2 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 transition hover:bg-red-100" type="button">
        <LogOut className="h-4 w-4" /> Déconnexion
      </button>
    </div>
    {medicalError && <p className="rounded border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">{medicalError}</p>}
    <ArchivedStudentsImportDrawer open={importDrawerOpen} onClose={() => setImportDrawerOpen(false)} user={user} data={data} school={school} year={year} updateData={updateData} createId={createId} studentImportKey={studentImportKey} />
    <AgeHomogeneityDrawer open={ageDrawerOpen} onClose={() => setAgeDrawerOpen(false)} user={user} data={data} school={school} year={year} />
    <SecretaryStatisticsDrawer open={statisticsDrawerOpen} onClose={() => setStatisticsDrawerOpen(false)} students={yearData.students} records={medicalRecords} />
    <SecretaryMedicalRecordsDrawer open={medicalDrawerOpen} onClose={() => setMedicalDrawerOpen(false)} user={user} students={yearData.students} records={medicalRecords} schoolId={school.id} schoolYearId={year.id} />
  </section>;
}
