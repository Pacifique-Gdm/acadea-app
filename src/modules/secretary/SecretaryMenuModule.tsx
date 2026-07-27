import { useMemo, useState } from "react";
import { BarChart3, Download, HelpCircle, LogOut, Upload, UserRound } from "lucide-react";
import { AgeHomogeneityDrawer, ArchivedStudentsImportDrawer } from "../../components/students/StudentAdministrativeTools";
import { SectionTitle } from "../../components/ui";
import { sendPasswordReset } from "../../services/auth";
import { exportStudentsPdf, sortStudentsForPdfByClass } from "../../utils/studentPdf";
import { formatStudentClassName } from "../../utils/studentClasses";
import { isArchivedStudent } from "../../utils/studentUtils";
import type { AppData, AppUser, School, SchoolYear, Student } from "../../types";

type ListKind = "all" | "class" | "new" | "reenrolled" | "transferred" | "archived";

function downloadCsv(filename: string, rows: string[][]) {
  const content = rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(";")).join("\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}

export function SecretaryMenuModule({ user, data, yearData, school, year, updateData, createId, studentImportKey, onLogout }: { user: AppUser; data: AppData; yearData: Pick<AppData, "students">; school: School; year: SchoolYear; updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void; createId: (prefix: string) => string; studentImportKey: (student: Student) => string; onLogout: () => void }) {
  const [kind, setKind] = useState<ListKind>("all");
  const [className, setClassName] = useState("");
  const [queryText, setQueryText] = useState("");
  const [message, setMessage] = useState("");
  const [importDrawerOpen, setImportDrawerOpen] = useState(false);
  const [ageDrawerOpen, setAgeDrawerOpen] = useState(false);
  const classes = useMemo(() => Array.from(new Set(yearData.students.map((student) => student.className))).sort(), [yearData.students]);
  const priorMatricules = useMemo(() => new Set(data.students.filter((student) => student.schoolId === school.id && student.schoolYearId !== year.id).map((student) => student.matricule)), [data.students, school.id, year.id]);
  const visible = useMemo(() => yearData.students.filter((student) => {
    const archived = isArchivedStudent(student);
    const reenrolled = priorMatricules.has(student.matricule);
    const kindMatches = kind === "all" || kind === "class" || (kind === "archived" && archived) || (kind === "transferred" && archived && student.exitReason === "Mutation") || (kind === "new" && !archived && !reenrolled) || (kind === "reenrolled" && !archived && reenrolled);
    return kindMatches && (!className || student.className === className) && `${student.matricule} ${student.nom} ${student.postnom} ${student.prenom}`.toLowerCase().includes(queryText.toLowerCase());
  }), [className, kind, priorMatricules, queryText, yearData.students]);
  const activeCount = yearData.students.filter((student) => !isArchivedStudent(student)).length;

  return <section className="grid gap-4"><SectionTitle title="Menu" subtitle="Listes, exports, profil et fonctions secondaires." />
    {message && <p className="rounded border bg-white p-3 text-sm">{message}</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <button type="button" onClick={() => setImportDrawerOpen(true)} className="flex min-w-0 items-center gap-3 rounded border border-slate-200 bg-white p-4 text-left transition hover:border-blue-300 hover:bg-blue-50/40">
        <span className="rounded bg-blue-50 p-2 text-blue-700"><Upload className="h-5 w-5" /></span>
        <span className="font-bold text-ink">Importer les élèves d’une année archivée</span>
      </button>
      <button type="button" onClick={() => setAgeDrawerOpen(true)} className="flex min-w-0 items-center gap-3 rounded border border-slate-200 bg-white p-4 text-left transition hover:border-blue-300 hover:bg-blue-50/40">
        <span className="rounded bg-blue-50 p-2 text-blue-700"><BarChart3 className="h-5 w-5" /></span>
        <span className="font-bold text-ink">Tableau d’homogénéité d’âge</span>
      </button>
    </div>
    <div className="grid gap-3 sm:grid-cols-3"><div className="rounded border bg-white p-4"><p className="text-sm text-slate-500">Élèves actifs</p><p className="text-2xl font-bold">{activeCount}</p></div><div className="rounded border bg-white p-4"><p className="text-sm text-slate-500">Classes</p><p className="text-2xl font-bold">{classes.length}</p></div><div className="rounded border bg-white p-4"><p className="text-sm text-slate-500">Année</p><p className="text-xl font-bold">{year.name}</p></div></div>
    <div className="grid gap-2 sm:grid-cols-3"><select className="input" value={kind} onChange={(event) => setKind(event.target.value as ListKind)}><option value="all">Liste générale</option><option value="class">Liste par classe</option><option value="new">Nouvelles inscriptions</option><option value="reenrolled">Réinscriptions</option><option value="transferred">Transférés</option><option value="archived">Archivés</option></select><select className="input" value={className} onChange={(event) => setClassName(event.target.value)}><option value="">Toutes les classes</option>{classes.map((item) => <option key={item}>{item}</option>)}</select><input className="input" value={queryText} onChange={(event) => setQueryText(event.target.value)} placeholder="Rechercher un élève" /></div>
    <div className="flex flex-wrap gap-2"><button className="primary-button" type="button" onClick={() => void exportStudentsPdf(school, year, sortStudentsForPdfByClass(visible), [kind, className || "Toutes les classes"])}><Download className="h-4 w-4" /> Export PDF</button><button className="secondary-button" type="button" onClick={() => downloadCsv(`eleves-${year.name}.csv`, [["Matricule", "Nom", "Classe", "Statut"], ...visible.map((student) => [student.matricule, `${student.nom} ${student.postnom} ${student.prenom}`, formatStudentClassName(student), isArchivedStudent(student) ? "Archivé" : "Actif"])])}><Download className="h-4 w-4" /> Export Excel (CSV)</button></div>
    <div className="overflow-x-auto rounded border bg-white"><table className="min-w-[640px] w-full text-sm"><thead className="bg-slate-50 text-left"><tr><th className="p-3">Matricule</th><th>Nom</th><th>Classe</th><th>Statut</th></tr></thead><tbody>{visible.map((student) => <tr className="border-t" key={student.id}><td className="p-3 font-semibold">{student.matricule}</td><td>{student.nom} {student.postnom} {student.prenom}</td><td>{formatStudentClassName(student)}</td><td>{isArchivedStudent(student) ? "Archivé" : "Actif"}</td></tr>)}</tbody></table></div>
    <div className="grid gap-3 sm:grid-cols-2"><article className="rounded border bg-white p-4"><h3 className="flex items-center gap-2 font-bold"><UserRound className="h-4 w-4" /> Profil</h3><p className="mt-2">{user.name}</p><p className="text-sm text-slate-500">{user.email}</p><button className="secondary-button mt-3" type="button" onClick={() => void sendPasswordReset(user.email).then(() => setMessage("Un lien de changement de mot de passe a été envoyé.")).catch(() => setMessage("Envoi du lien impossible pour le moment."))}>Changer le mot de passe</button></article><article className="rounded border bg-white p-4"><h3 className="flex items-center gap-2 font-bold"><HelpCircle className="h-4 w-4" /> Aide et notifications</h3><p className="mt-2 text-sm text-slate-500">Les notifications sont accessibles depuis la cloche de l'en-tête. Pour obtenir de l'aide, contactez l'administrateur de votre école.</p><button className="secondary-button mt-3" type="button" onClick={onLogout}><LogOut className="h-4 w-4" /> Déconnexion</button></article></div>
    <ArchivedStudentsImportDrawer open={importDrawerOpen} onClose={() => setImportDrawerOpen(false)} user={user} data={data} school={school} year={year} updateData={updateData} createId={createId} studentImportKey={studentImportKey} />
    <AgeHomogeneityDrawer open={ageDrawerOpen} onClose={() => setAgeDrawerOpen(false)} user={user} data={data} school={school} year={year} />
  </section>;
}
