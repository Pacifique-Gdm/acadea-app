import { useMemo, useState } from "react";
import type { Student } from "../../types";
import { formatStudentClassName, getStudentSection } from "../../utils/studentClasses";
import { schoolSectionLabels } from "../../utils/schoolConfig";
import type { useStudyData } from "./useStudyData";

const fullName = (student: Student) => `${student.nom} ${student.postnom} ${student.prenom}`.replace(/\s+/g, " ").trim();

export function StudyStudentsModule({ data }: { data: ReturnType<typeof useStudyData> }) {
  const [search, setSearch] = useState(""), [section, setSection] = useState("");
  const sections = [...new Set(data.students.map(getStudentSection))];
  const rows = useMemo(() => data.students.filter((student) => (!section || getStudentSection(student) === section) && `${student.matricule} ${fullName(student)} ${student.className}`.toLowerCase().includes(search.trim().toLowerCase())), [data.students, search, section]);
  return <section className="grid gap-4"><div><h1 className="text-2xl font-bold text-ink">Élèves</h1><p className="text-sm text-slate-600">Consultation en lecture seule des élèves de vos sections.</p></div><div className="grid gap-2 sm:grid-cols-2"><input className="input" aria-label="Rechercher un élève" placeholder="Matricule, nom ou classe" value={search} onChange={(event) => setSearch(event.target.value)} /><select className="input" aria-label="Filtrer par section" value={section} onChange={(event) => setSection(event.target.value)}><option value="">Toutes mes sections</option>{sections.map((item) => <option key={item} value={item}>{schoolSectionLabels[item]}</option>)}</select></div><div className="overflow-x-auto rounded border border-slate-200 bg-white shadow-sm"><table className="min-w-[680px] w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-3">Matricule</th><th className="px-3 py-3">Nom complet</th><th className="px-3 py-3">Sexe</th><th className="px-3 py-3">Classe</th><th className="px-3 py-3">Statut</th></tr></thead><tbody>{rows.map((student) => <tr key={student.id} className="border-t border-slate-100"><td className="px-3 py-3">{student.matricule}</td><td className="px-3 py-3 font-semibold">{fullName(student)}</td><td className="px-3 py-3">{student.sexe}</td><td className="px-3 py-3">{formatStudentClassName(student)}</td><td className="px-3 py-3">{student.status ?? "ACTIVE"}</td></tr>)}{rows.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">Aucun élève trouvé.</td></tr>}</tbody></table></div></section>;
}
