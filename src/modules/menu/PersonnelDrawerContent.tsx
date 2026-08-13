import { useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, ChevronDown, Printer, Pencil } from "lucide-react";
import { AdminDrawer, Field, MultiSelectDropdown } from "../../components/ui";
import { archivePersonnel, isArchivedPersonnel, personnelRoleLabels, reactivatePersonnel, subscribeToSchoolPersonnel, updatePersonnel } from "../../services/personnel";
import type { AppUser, School, SchoolSection } from "../../types";
import { isValidProvisioningPhone } from "../../utils/schoolAccountCredentials";
import { getSchoolSections, schoolSectionLabels } from "../../utils/schoolConfig";
import { userSectionIds } from "../../utils/userSections";
import { printPersonnelProfilePdf } from "../../utils/personnelPdf";

export function PersonnelDrawerContent({ user, school }: { user: AppUser; school: School }) {
  const [personnel, setPersonnel] = useState<AppUser[]>([]);
  const [view, setView] = useState<"active" | "archived">("active");
  const [selected, setSelected] = useState<AppUser>();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState<"archive" | "reactivate">();
  const [actionsOpen, setActionsOpen] = useState(false);
  const [name, setName] = useState(""), [phone, setPhone] = useState(""), [email, setEmail] = useState("");
  const [sections, setSections] = useState<SchoolSection[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [success, setSuccess] = useState("");
  const sectionOptions = getSchoolSections(school).map((section) => ({ value: section, label: schoolSectionLabels[section] }));

  useEffect(() => subscribeToSchoolPersonnel({ user, schoolId: school.id, onData: (items) => { setPersonnel(items); setSelected((current) => current ? items.find((item) => item.id === current.id) : undefined); setLoading(false); setError(""); }, onError: () => { setLoading(false); setError("Impossible d’actualiser les personnels."); } }), [school.id, user]);
  const visible = useMemo(() => personnel.filter((item) => view === "archived" ? isArchivedPersonnel(item) : !isArchivedPersonnel(item)).sort((left, right) => left.name.localeCompare(right.name, "fr")), [personnel, view]);

  function openEdit(item: AppUser) { setSelected(item); setName(item.name); setPhone(item.phone ?? ""); setEmail(item.email); setSections(userSectionIds(item)); setError(""); setSuccess(""); setEditing(true); }
  async function saveEdit() {
    if (!selected || busy) return;
    if (!name.trim() || !email.trim() || !isValidProvisioningPhone(phone)) return setError("Nom, téléphone valide et e-mail sont requis.");
    setBusy(true); setError("");
    try { await updatePersonnel({ schoolId: school.id, personnelId: selected.id, name: name.trim(), phone: phone.trim(), email: email.trim(), section: sections[0] ?? null, sectionIds: sections }); setEditing(false); setSuccess("Personnel modifié avec succès."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Modification impossible."); }
    finally { setBusy(false); }
  }
  async function changeStatus() {
    if (!selected || !confirming || busy) return;
    setBusy(true); setError("");
    try { if (confirming === "archive") await archivePersonnel({ schoolId: school.id, personnelId: selected.id }); else await reactivatePersonnel({ schoolId: school.id, personnelId: selected.id }); setConfirming(undefined); setSelected(undefined); setSuccess(confirming === "archive" ? "Personnel archivé avec succès." : "Personnel réactivé avec succès."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Changement de statut impossible."); }
    finally { setBusy(false); }
  }

  return <div className="grid gap-4">
    <div className="grid grid-cols-2 gap-2" role="group" aria-label="Filtrer les personnels"><button type="button" className={view === "active" ? "primary-button justify-center" : "secondary-button justify-center"} onClick={() => setView("active")}>Actifs</button><button type="button" className={view === "archived" ? "primary-button justify-center" : "secondary-button justify-center"} onClick={() => setView("archived")}>Archivés</button></div>
    {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}{success && <p role="status" className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">{success}</p>}
    {loading ? <p className="py-8 text-center text-sm text-slate-500">Chargement des personnels…</p> : <div className="grid gap-2">{visible.map((item) => <article key={item.id} className="grid gap-2 rounded border border-slate-200 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="min-w-0"><button type="button" className="break-words text-left font-semibold text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600" onClick={() => { setSelected(item); setSuccess(""); setError(""); }}>{item.name}</button><p className="text-sm text-slate-600">{personnelRoleLabels[item.role as keyof typeof personnelRoleLabels]}</p><p className="break-all text-xs text-slate-500">{item.phone || "Non renseigné"} · {item.email}</p></div><span className={`w-fit rounded-full px-2 py-1 text-xs font-semibold ${isArchivedPersonnel(item) ? "bg-slate-200 text-slate-700" : "bg-green-100 text-green-800"}`}>{isArchivedPersonnel(item) ? "Archivé" : "Actif"}</span></article>)}{visible.length === 0 && <p className="rounded bg-slate-50 p-6 text-center text-sm text-slate-500">Aucun personnel {view === "active" ? "actif" : "archivé"}.</p>}</div>}
    {selected && <AdminDrawer title={`Personnel — ${selected.name}`} closeLabel="Fermer la fiche Personnel" onClose={() => !busy && setSelected(undefined)}>
      <div className="grid grid-cols-2 gap-2"><div className="relative min-w-0"><button type="button" className="secondary-button w-full justify-center" aria-haspopup="menu" aria-expanded={actionsOpen} disabled={busy || selected.role === "school_admin"} onClick={() => setActionsOpen((current) => !current)}>Actions <ChevronDown className="h-4 w-4"/></button>{actionsOpen && selected.role !== "school_admin" && <div role="menu" className="absolute left-0 right-0 top-full z-50 mt-1 grid rounded border border-slate-200 bg-white p-1 shadow-lg"><button role="menuitem" type="button" className="flex min-h-10 items-center gap-2 rounded px-3 text-left text-sm hover:bg-slate-50" onClick={() => { setActionsOpen(false); openEdit(selected); }}><Pencil className="h-4 w-4"/> Modifier</button>{isArchivedPersonnel(selected) ? <button role="menuitem" type="button" className="flex min-h-10 items-center gap-2 rounded px-3 text-left text-sm hover:bg-slate-50" onClick={() => { setActionsOpen(false); setConfirming("reactivate"); }}><ArchiveRestore className="h-4 w-4"/> Réactiver</button> : <button role="menuitem" type="button" className="flex min-h-10 items-center gap-2 rounded px-3 text-left text-sm text-red-700 hover:bg-red-50" onClick={() => { setActionsOpen(false); setConfirming("archive"); }}><Archive className="h-4 w-4"/> Archiver</button>}</div>}</div><button type="button" className="primary-button w-full justify-center" disabled={busy} onClick={() => void printPersonnelProfilePdf(school, selected)}><Printer className="h-4 w-4"/> Imprimer</button></div>
      <dl className="grid gap-3 rounded bg-slate-50 p-4 text-sm"><div><dt className="font-semibold">Identité</dt><dd>{selected.name}</dd></div><div><dt className="font-semibold">Fonction</dt><dd>{personnelRoleLabels[selected.role as keyof typeof personnelRoleLabels]}</dd></div><div><dt className="font-semibold">Sections</dt><dd>{userSectionIds(selected).map((section) => schoolSectionLabels[section]).join(", ") || "Non renseignées"}</dd></div><div><dt className="font-semibold">Téléphone</dt><dd>{selected.phone || "Non renseigné"}</dd></div><div><dt className="font-semibold">E-mail</dt><dd className="break-all">{selected.email}</dd></div><div><dt className="font-semibold">Statut</dt><dd>{isArchivedPersonnel(selected) ? "Archivé" : "Actif"}</dd></div><div><dt className="font-semibold">École</dt><dd>{school.name}</dd></div><div><dt className="font-semibold">Date de création</dt><dd>{selected.createdAt ? new Date(selected.createdAt).toLocaleDateString("fr-FR") : "Non renseigné"}</dd></div></dl>
    </AdminDrawer>}
    {editing && selected && <AdminDrawer title="Modifier le personnel" closeLabel="Fermer la modification" onClose={() => !busy && setEditing(false)}><Field label="Nom complet" value={name} onChange={setName}/><Field label="Téléphone" value={phone} onChange={setPhone}/><Field label="Email" value={email} onChange={setEmail}/><MultiSelectDropdown label="Sections" options={sectionOptions} values={sections} onChange={(values) => setSections(values as SchoolSection[])} placeholder="Non renseignées (compatibilité historique)" />{error && <p role="alert" className="text-sm text-red-700">{error}</p>}<div className="grid grid-cols-2 gap-2"><button type="button" className="secondary-button justify-center" disabled={busy} onClick={() => setEditing(false)}>Annuler</button><button type="button" className="primary-button justify-center" disabled={busy} onClick={() => void saveEdit()}>{busy ? "Enregistrement…" : "Enregistrer"}</button></div></AdminDrawer>}
    {confirming && selected && <AdminDrawer title={confirming === "archive" ? "Archiver ce personnel ?" : "Réactiver ce personnel ?"} closeLabel="Fermer la confirmation" onClose={() => !busy && setConfirming(undefined)}><p>{confirming === "archive" ? "Ce compte ne pourra plus accéder à Acadéa, mais son historique sera conservé." : "Ce compte pourra de nouveau accéder à Acadéa avec ses identifiants existants."}</p><div className="grid grid-cols-2 gap-2"><button type="button" className="secondary-button justify-center" disabled={busy} onClick={() => setConfirming(undefined)}>Annuler</button><button type="button" className={confirming === "archive" ? "rounded bg-red-700 px-4 py-2 font-semibold text-white disabled:opacity-50" : "primary-button justify-center"} disabled={busy} onClick={() => void changeStatus()}>{busy ? "Traitement…" : confirming === "archive" ? "Archiver" : "Réactiver"}</button></div></AdminDrawer>}
  </div>;
}
