import { useEffect, useState } from "react";
import { BarChart3, BookOpen, Fingerprint, HeartPulse, LogOut, Radio, Upload, UsersRound } from "lucide-react";
import { ParentsDirectoryDrawer } from "../../components/parents/ParentsDirectoryDrawer";
import { ParentDrawerBackButton, ParentFormEditor } from "../../components/parents/ParentFormEditor";
import { AgeHomogeneityDrawer, ArchivedStudentsImportDrawer } from "../../components/students/StudentAdministrativeTools";
import { AdminDrawer, SectionTitle } from "../../components/ui";
import { ValvesDrawerContent } from "../../components/valves/ValvesDrawerContent";
import { subscribeToStudentMedicalRecords } from "../../services/studentMedicalRecords";
import { deleteParentAccount } from "../../services/provisioning";
import { refreshErrorMessage } from "../../utils/refreshErrors";
import type { AppData, AppUser, School, SchoolYear, Student } from "../../types";
import { BiometricStudentsPage } from "../biometrics/BiometricStudentsPage";
import { SecretaryMedicalRecordsDrawer, SecretaryStatisticsDrawer } from "./SecretaryMedicalTools";
import type { StudentMedicalRecord } from "./secretaryTypes";

type SecretaryBiometricView = "menu" | "fingerprints" | "cards";

type SecretaryMenuModuleProps = {
  user: AppUser;
  data: AppData;
  yearData: Pick<AppData, "students" | "parents" | "valves">;
  school: School;
  year: SchoolYear;
  updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void;
  createId: (prefix: string) => string;
  studentImportKey: (student: Student) => string;
  onLogout: () => void;
  valvesUploadsEnabled: boolean;
  maxValveDocumentBytes: number;
  initialBiometricView?: SecretaryBiometricView;
  onBiometricViewChange?: (view: SecretaryBiometricView | null) => void;
};

const menuButtonClass = "flex min-w-0 items-center gap-3 rounded border border-slate-200 bg-white p-4 text-left transition hover:border-blue-300 hover:bg-blue-50/40";
const menuIconClass = "rounded bg-blue-50 p-2 text-blue-700";

export function SecretaryMenuModule({ user, data, yearData, school, year, updateData, createId, studentImportKey, onLogout, valvesUploadsEnabled, maxValveDocumentBytes, initialBiometricView, onBiometricViewChange }: SecretaryMenuModuleProps) {
  const [importDrawerOpen, setImportDrawerOpen] = useState(false);
  const [ageDrawerOpen, setAgeDrawerOpen] = useState(false);
  const [statisticsDrawerOpen, setStatisticsDrawerOpen] = useState(false);
  const [medicalDrawerOpen, setMedicalDrawerOpen] = useState(false);
  const [valvesDrawerOpen, setValvesDrawerOpen] = useState(false);
  const [parentsDrawerOpen, setParentsDrawerOpen] = useState(false);
  const [parentFormRequest, setParentFormRequest] = useState<{ parentId?: string; requestId: number } | null>(null);
  const [parentDeleteOpen, setParentDeleteOpen] = useState(false);
  const [parentDeleteId, setParentDeleteId] = useState("");
  const [parentDeleteConfirmation, setParentDeleteConfirmation] = useState("");
  const [parentDeleteError, setParentDeleteError] = useState("");
  const [parentDeleteBusy, setParentDeleteBusy] = useState(false);
  const [biometricView, setBiometricView] = useState<SecretaryBiometricView | null>(initialBiometricView ?? null);
  const [medicalRecords, setMedicalRecords] = useState<StudentMedicalRecord[]>([]);
  const [medicalError, setMedicalError] = useState("");

  useEffect(() => {
    if (!statisticsDrawerOpen && !medicalDrawerOpen) return undefined;
    return subscribeToStudentMedicalRecords({ user, schoolId: school.id, schoolYearId: year.id, onData: (records) => { setMedicalRecords(records); setMedicalError(""); }, onError: (error) => setMedicalError(refreshErrorMessage(error)) });
  }, [medicalDrawerOpen, school.id, statisticsDrawerOpen, user, year.id]);

  useEffect(() => setBiometricView(initialBiometricView ?? null), [initialBiometricView]);

  function openBiometricView(view: SecretaryBiometricView) {
    setBiometricView(view);
    onBiometricViewChange?.(view);
  }

  function closeBiometricView() {
    setBiometricView(null);
    onBiometricViewChange?.(null);
  }

  function openParentForm(parentId?: string) { setParentsDrawerOpen(false); setParentFormRequest({ parentId, requestId: Date.now() }); }
  function openParentDelete() { setParentsDrawerOpen(false); setParentDeleteId(""); setParentDeleteConfirmation(""); setParentDeleteError(""); setParentDeleteOpen(true); }
  async function confirmParentDelete() {
    const parent = yearData.parents.find((item) => item.id === parentDeleteId && item.schoolId === school.id);
    if (!parent) { setParentDeleteError("Veuillez sélectionner un parent de cette école."); return; }
    if (parentDeleteConfirmation !== "SUPPRIMER LE PARENT") { setParentDeleteError("Veuillez saisir exactement SUPPRIMER LE PARENT."); return; }
    setParentDeleteBusy(true); setParentDeleteError("");
    try {
      await deleteParentAccount({ schoolId: school.id, parentId: parent.id, confirmation: parentDeleteConfirmation });
      updateData({ parents: data.parents.filter((item) => item.id !== parent.id), users: data.users.filter((item) => item.parentId !== parent.id && item.id !== parent.userId), students: data.students.map((student) => student.parentId === parent.id ? { ...student, parentId: undefined } : student) }, { persist: false });
      setParentDeleteOpen(false);
    } catch (error) { setParentDeleteError(error instanceof Error ? error.message : "Suppression du parent impossible."); }
    finally { setParentDeleteBusy(false); }
  }

  return <section className="grid gap-4"><SectionTitle title="Menu" subtitle="Fonctions administratives secondaires." />
    <div className="grid gap-3">
      <button type="button" onClick={() => setValvesDrawerOpen(true)} className={menuButtonClass}><span className={menuIconClass}><BookOpen className="h-5 w-5" /></span><span className="font-bold text-ink">Valves</span></button>
      <button type="button" onClick={() => setMedicalDrawerOpen(true)} className={menuButtonClass}><span className={menuIconClass}><HeartPulse className="h-5 w-5" /></span><span className="font-bold text-ink">Fiches médicales</span></button>
      <button type="button" onClick={() => openBiometricView("menu")} className={menuButtonClass}><span className={menuIconClass}><Fingerprint className="h-5 w-5" /></span><span className="font-bold text-ink">Empreintes et Cartes</span></button>
      <button type="button" onClick={() => setParentsDrawerOpen(true)} className={menuButtonClass}><span className={menuIconClass}><UsersRound className="h-5 w-5" /></span><span className="font-bold text-ink">Parents / Tuteurs</span></button>
      <button type="button" onClick={() => setAgeDrawerOpen(true)} className={menuButtonClass}><span className={menuIconClass}><BarChart3 className="h-5 w-5" /></span><span className="font-bold text-ink">Tableau d’homogénéité d’âge</span></button>
      <button type="button" onClick={() => setStatisticsDrawerOpen(true)} className={menuButtonClass}><span className={menuIconClass}><BarChart3 className="h-5 w-5" /></span><span className="font-bold text-ink">Statistiques</span></button>
      <button type="button" onClick={() => setImportDrawerOpen(true)} className={menuButtonClass}><span className={menuIconClass}><Upload className="h-5 w-5" /></span><span className="font-bold text-ink">Importer les élèves d’une année archivée</span></button>
      <button onClick={onLogout} className="inline-flex w-full items-center justify-center gap-2 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 transition hover:bg-red-100" type="button"><LogOut className="h-4 w-4" /> Déconnexion</button>
    </div>
    {medicalError && <p className="rounded border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">{medicalError}</p>}
    <ArchivedStudentsImportDrawer open={importDrawerOpen} onClose={() => setImportDrawerOpen(false)} user={user} data={data} school={school} year={year} updateData={updateData} createId={createId} studentImportKey={studentImportKey} />
    <AgeHomogeneityDrawer open={ageDrawerOpen} onClose={() => setAgeDrawerOpen(false)} user={user} data={data} school={school} year={year} />
    <SecretaryStatisticsDrawer open={statisticsDrawerOpen} onClose={() => setStatisticsDrawerOpen(false)} students={yearData.students} records={medicalRecords} school={school} year={year} />
    <SecretaryMedicalRecordsDrawer open={medicalDrawerOpen} onClose={() => setMedicalDrawerOpen(false)} user={user} students={yearData.students} records={medicalRecords} school={school} year={year} />
    {valvesDrawerOpen && <AdminDrawer title="Valves" onClose={() => setValvesDrawerOpen(false)} closeLabel="Fermer les Valves"><ValvesDrawerContent user={user} data={data} yearData={yearData} school={school} year={year} updateData={updateData} canManage={user.role === "secretary" && user.status !== "inactive" && user.schoolId === school.id} valvesUploadsEnabled={valvesUploadsEnabled} createId={createId} maxValveDocumentBytes={maxValveDocumentBytes} /></AdminDrawer>}
    {parentsDrawerOpen && <AdminDrawer title="Parents / Tuteurs" onClose={() => setParentsDrawerOpen(false)} closeLabel="Fermer Parents / Tuteurs"><ParentsDirectoryDrawer parents={yearData.parents} students={yearData.students} school={school} year={year} schoolId={school.id} schoolYearId={year.id} onCreateParent={() => openParentForm()} onEditParent={(parent) => openParentForm(parent.id)} onDeleteParent={openParentDelete} /></AdminDrawer>}
    {parentFormRequest && <AdminDrawer title={parentFormRequest.parentId ? "Modifier le parent" : "Créer un parent"} onClose={() => setParentFormRequest(null)} closeLabel="Fermer le formulaire parent"><ParentFormEditor data={data} yearData={yearData} school={school} year={year} updateData={updateData} initialParentId={parentFormRequest.parentId} requestId={parentFormRequest.requestId} onBack={() => { setParentFormRequest(null); setParentsDrawerOpen(true); }} showBackButton createId={createId} /></AdminDrawer>}
    {parentDeleteOpen && <AdminDrawer title="Supprimer un parent" onClose={() => !parentDeleteBusy && setParentDeleteOpen(false)} closeLabel="Fermer la suppression du parent"><div className="grid gap-4"><ParentDrawerBackButton onBack={() => { if (!parentDeleteBusy) { setParentDeleteOpen(false); setParentsDrawerOpen(true); } }} /><label className="grid gap-1 text-sm font-semibold">Parent<select className="input" value={parentDeleteId} disabled={parentDeleteBusy} onChange={(event) => setParentDeleteId(event.target.value)}><option value="">Sélectionner</option>{yearData.parents.filter((parent) => parent.schoolId === school.id && parent.schoolYearId === year.id).map((parent) => <option key={parent.id} value={parent.id}>{parent.fullName}</option>)}</select></label><label className="grid gap-1 text-sm font-semibold">Confirmation<input className="input" value={parentDeleteConfirmation} disabled={parentDeleteBusy} placeholder="SUPPRIMER LE PARENT" onChange={(event) => setParentDeleteConfirmation(event.target.value)} /></label>{parentDeleteError && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{parentDeleteError}</p>}<div className="grid grid-cols-2 gap-2"><button type="button" className="secondary-button justify-center" disabled={parentDeleteBusy} onClick={() => setParentDeleteOpen(false)}>Annuler</button><button type="button" className="rounded bg-red-700 px-4 py-2 font-semibold text-white disabled:opacity-50" disabled={parentDeleteBusy || !parentDeleteId || parentDeleteConfirmation !== "SUPPRIMER LE PARENT"} onClick={() => void confirmParentDelete()}>{parentDeleteBusy ? "Suppression…" : "Supprimer"}</button></div></div></AdminDrawer>}
    {biometricView && <AdminDrawer title="Empreintes et Cartes" onClose={closeBiometricView} closeLabel="Fermer Empreintes et Cartes">
      {biometricView === "menu" ? <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={() => openBiometricView("fingerprints")} className="secondary-button justify-center"><Fingerprint className="h-4 w-4" /> Empreintes</button>
        <button type="button" onClick={() => openBiometricView("cards")} className="secondary-button justify-center"><Radio className="h-4 w-4" /> Cartes</button>
      </div> : <BiometricStudentsPage mode={biometricView} students={yearData.students} loading={false} error="" onBack={() => openBiometricView("menu")} />}
    </AdminDrawer>}
  </section>;
}
