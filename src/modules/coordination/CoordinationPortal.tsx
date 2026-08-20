import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, limit, onSnapshot, query, startAfter, where, type Firestore, type QueryDocumentSnapshot } from "@firebase/firestore";
import { Building2, GraduationCap, LayoutDashboard, LogOut, Menu, MessageSquare } from "lucide-react";
import { db } from "../../firebase";
import type { AppUser, Coordination, CoordinationSchool, School } from "../../types";
import { AccessDenied } from "../../components/auth/AccessDenied";
import { escapePdfHtml, pdfInfoGrid, pdfSection, pdfTable, renderAcadPdfPreview } from "../../utils/pdf";
import { CoordinationMessage } from "./CoordinationMessage";
import { CoordinationMenu } from "./CoordinationMenu";

type CoordinationTab = "dashboard" | "students" | "messages" | "menu";
type CoordinationStudent = { id: string; firstName?: string; lastName?: string; nom?: string; postnom?: string; prenom?: string; schoolId?: string; className?: string };

export function CoordinationPortal({ user, onLogout }: { user: AppUser; onLogout: () => void }) {
  const [tab, setTab] = useState<CoordinationTab>("dashboard");
  const [coordination, setCoordination] = useState<Coordination | null>(null);
  const [relations, setRelations] = useState<CoordinationSchool[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState("");
  const [students, setStudents] = useState<CoordinationStudent[]>([]);
  const [studentSearch, setStudentSearch] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (user.role !== "coordination_admin" || !user.coordinationId || !db) return undefined;
    const database = db as unknown as Firestore;
    const coordinationId = user.coordinationId;
    const stopCoordination = onSnapshot(doc(database, "coordinations", coordinationId), (snapshot) => {
      if (!snapshot.exists() || snapshot.data().status !== "active") { setError("Cette Coordination est inactive ou introuvable."); setCoordination(null); return; }
      setCoordination({ id: snapshot.id, ...snapshot.data() } as Coordination); setError("");
    }, () => setError("Impossible de charger la Coordination."));
    const stopRelations = onSnapshot(query(collection(database, "coordinationSchools"), where("coordinationId", "==", coordinationId), where("active", "==", true)), async (snapshot) => {
      const nextRelations = snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as CoordinationSchool));
      setRelations(nextRelations);
      try {
        const loaded = await Promise.all(nextRelations.map((relation) => getDoc(doc(database, "schools", relation.schoolId))));
        setSchools(loaded.filter((item) => item.exists()).map((item) => ({ id: item.id, ...item.data() } as School)));
        setSelectedSchoolId((current) => current && !nextRelations.some((item) => item.schoolId === current) ? "" : current);
      } catch { setError("Impossible de charger les écoles rattachées."); }
    }, () => setError("Impossible de charger les écoles rattachées."));
    return () => { stopCoordination(); stopRelations(); };
  }, [user.coordinationId, user.role]);

  const activeSchools = useMemo(() => schools.filter((school) => relations.some((relation) => relation.schoolId === school.id)), [relations, schools]);
  const scopedSchools = useMemo(() => selectedSchoolId ? activeSchools.filter((school) => school.id === selectedSchoolId) : activeSchools, [activeSchools, selectedSchoolId]);
  const visibleStudents = useMemo(() => students.filter((student) => `${student.firstName ?? student.prenom ?? ""} ${student.lastName ?? student.nom ?? ""} ${student.postnom ?? ""} ${student.className ?? ""}`.toLowerCase().includes(studentSearch.toLowerCase().trim())), [students, studentSearch]);

  useEffect(() => {
    if (!db || tab !== "students" || scopedSchools.length === 0) { if (tab === "students") setStudents([]); return undefined; }
    const database = db as unknown as Firestore;
    let cancelled = false;
    void (async () => {
      try {
        const next: CoordinationStudent[] = []; const ids = scopedSchools.map((school) => school.id);
        for (let index = 0; index < ids.length; index += 30) {
          let cursor: QueryDocumentSnapshot | undefined;
          do {
            const snapshot = await getDocs(query(collection(database, "students"), where("schoolId", "in", ids.slice(index, index + 30)), ...(cursor ? [startAfter(cursor)] : []), limit(500)));
            snapshot.docs.forEach((item) => next.push({ id: item.id, ...item.data() } as CoordinationStudent));
            cursor = snapshot.docs.at(-1);
            if (snapshot.docs.length < 500) break;
          } while (cursor);
        }
        if (!cancelled) setStudents(next);
      } catch { if (!cancelled) setError("Impossible de charger les élèves de la Coordination."); }
    })();
    return () => { cancelled = true; };
  }, [scopedSchools, tab]);

  async function exportStudentsPdf() {
    const school = scopedSchools[0] ?? activeSchools[0]; if (!school) return;
    await renderAcadPdfPreview({ filename: `coordination-eleves-${selectedSchoolId || "toutes"}.pdf`, title: "Élèves — Coordination", school, subtitle: selectedSchoolId ? school.name : "Toutes les écoles", sections: [pdfSection("Élèves", pdfTable([
      { header: "Élève", render: (item) => escapePdfHtml([item.prenom ?? item.firstName, item.nom ?? item.lastName, item.postnom].filter(Boolean).join(" ") || item.id) },
      { header: "École", render: (item) => escapePdfHtml(activeSchools.find((entry) => entry.id === item.schoolId)?.name || item.schoolId || "—") },
      { header: "Classe", render: (item) => escapePdfHtml(item.className || "—") },
    ], visibleStudents, "Aucun élève dans le périmètre sélectionné."))] });
  }

  async function exportDashboardPdf() {
    const school = scopedSchools[0] ?? activeSchools[0]; if (!school || !coordination) return;
    await renderAcadPdfPreview({ filename: `coordination-dashboard-${selectedSchoolId || "toutes"}.pdf`, title: "Dashboard — Coordination", school, subtitle: selectedSchoolId ? school.name : "Toutes les écoles", sections: [pdfSection("Synthèse", pdfInfoGrid([
      { label: "Coordination", value: coordination.name },
      { label: "Écoles visibles", value: String(scopedSchools.length) },
      { label: "Statut", value: coordination.status === "active" ? "Active" : "Indisponible" },
      { label: "Périmètre", value: "Lecture seule" },
    ]))] });
  }

  if (user.role !== "coordination_admin" || !user.coordinationId) return <AccessDenied onLogout={onLogout} />;
  const tabs = [["dashboard", "Dashboard", LayoutDashboard], ["students", "Élèves", GraduationCap], ["messages", "Message", MessageSquare], ["menu", "Menu", Menu]] as const;

  return <main className="min-h-screen bg-[#F5F7FB] pb-24 text-ink">
    <header className="border-b border-slate-200 bg-white px-4 py-4 shadow-sm"><div className="mx-auto flex max-w-6xl items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><Building2 className="h-6 w-6 shrink-0 text-blue-700"/><div className="min-w-0"><h1 className="truncate text-lg font-bold">{coordination?.name ?? "Coordination"}</h1><p className="text-xs text-slate-500">Supervision multi-écoles · lecture sécurisée</p></div></div><button type="button" onClick={onLogout} className="inline-flex items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"><LogOut className="h-4 w-4"/>Déconnexion</button></div></header>
    <section className="mx-auto grid max-w-6xl gap-4 px-4 py-5">
      <div className="rounded border border-blue-100 bg-blue-50 p-4 text-sm"><b>École</b><select className="input mt-2 w-full" aria-label="Filtrer par école" value={selectedSchoolId} onChange={(event) => setSelectedSchoolId(event.target.value)}><option value="">Toutes les écoles ({activeSchools.length})</option>{activeSchools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select></div>
      {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {tab === "dashboard" && <section className="grid gap-4"><div className="flex justify-end"><button type="button" className="pdf-export-button" disabled={!coordination || !activeSchools.length} onClick={() => void exportDashboardPdf()}>Exporter PDF</button></div><div className="grid gap-4 sm:grid-cols-3"><article className="rounded border bg-white p-4 shadow-sm"><p className="text-sm text-slate-500">Écoles dans le périmètre</p><strong className="text-3xl">{scopedSchools.length}</strong></article><article className="rounded border bg-white p-4 shadow-sm"><p className="text-sm text-slate-500">Statut Coordination</p><strong>{coordination?.status === "active" ? "Active" : "Indisponible"}</strong></article><article className="rounded border bg-white p-4 shadow-sm"><p className="text-sm text-slate-500">Périmètre</p><strong>Lecture seule</strong></article></div></section>}
      {tab === "students" && <section className="rounded border bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-lg font-bold">Élèves</h2><p className="text-sm text-slate-600">Consultation en lecture seule · {visibleStudents.length} résultat(s).</p></div><button type="button" className="pdf-export-button" disabled={!visibleStudents.length || !activeSchools.length} onClick={() => void exportStudentsPdf()}>Exporter PDF</button></div><input className="input mt-3" placeholder="Rechercher un élève ou une classe" value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)}/><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="p-2">Élève</th><th className="p-2">École</th><th className="p-2">Classe</th></tr></thead><tbody>{visibleStudents.map((student) => <tr key={student.id} className="border-b"><td className="p-2">{[student.prenom ?? student.firstName, student.nom ?? student.lastName, student.postnom].filter(Boolean).join(" ") || student.id}</td><td className="p-2">{activeSchools.find((school) => school.id === student.schoolId)?.name || student.schoolId || "—"}</td><td className="p-2">{student.className || "—"}</td></tr>)}</tbody></table>{!visibleStudents.length && <p className="p-4 text-sm text-slate-500">Aucun élève dans le périmètre sélectionné.</p>}</div></section>}
      {tab === "messages" && <CoordinationMessage schools={activeSchools} schoolId={selectedSchoolId}/>}
      {tab === "menu" && coordination && <CoordinationMenu coordination={coordination} schools={activeSchools} selectedSchoolId={selectedSchoolId}/>}
    </section>
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white px-2 pb-3 pt-2 shadow-lg"><div className="mx-auto grid max-w-lg grid-cols-4 gap-1">{tabs.map(([id, label, Icon]) => <button key={id} type="button" onClick={() => setTab(id)} className={`flex min-w-0 flex-col items-center gap-1 rounded px-1 py-2 text-xs font-semibold ${tab === id ? "bg-blue-50 text-blue-700" : "text-slate-500"}`}><Icon className="h-5 w-5"/><span className="truncate">{label}</span></button>)}</div></nav>
  </main>;
}
