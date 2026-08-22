import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Archive, ArchiveRestore, ChevronDown, Pencil, Printer } from "lucide-react";
import { AdminDrawer, Field, MultiSelectDropdown } from "../../components/ui";
import {
  archivePersonnel, isArchivedPersonnel, personnelDisplayName, personnelIdentity, personnelRoleLabels,
  reactivatePersonnel, subscribeToPersonnelProfile, subscribeToSchoolPersonnel, updatePersonnel,
} from "../../services/personnel";
import { deletePersonnelPhoto, uploadPersonnelPhoto } from "../../services/personnelPhotoStorage";
import type { AppUser, PersonnelProfile, School, SchoolSection } from "../../types";
import { useAutoDismissMessage, ERROR_MESSAGE_DURATION_MS, SUCCESS_MESSAGE_DURATION_MS } from "../../hooks/useAutoDismissMessage";
import { useDismissibleDropdown } from "../../hooks/useDismissibleDropdown";
import { isValidProvisioningPhone } from "../../utils/schoolAccountCredentials";
import { getSchoolSections, schoolSectionLabels } from "../../utils/schoolConfig";
import { userSectionIds } from "../../utils/userSections";
import { printPersonnelListPdf, printPersonnelProfilePdf } from "../../utils/personnelPdf";
import { PersonnelProfileReadOnly } from "../../components/personnel/PersonnelProfileReadOnly";

type ProfileForm = Partial<Omit<PersonnelProfile, "id" | "schoolId" | "personnelId" | "matricule" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy">>;

const dateShown = (value: unknown) => {
  if (!value) return "Non renseigné";
  const timestamp = value as { toDate?: () => Date; toMillis?: () => number };
  const date = typeof timestamp.toDate === "function" ? timestamp.toDate() : typeof timestamp.toMillis === "function" ? new Date(timestamp.toMillis()) : new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? "Non renseigné" : date.toLocaleDateString("fr-FR");
};

function EditSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="grid min-w-0 gap-3 rounded border border-slate-200 bg-slate-50 p-3 sm:p-4"><h3 className="font-bold text-ink">{title}</h3>{children}</section>;
}

function NativeField({ label, type = "text", value, onChange, readOnly = false }: { label: string; type?: string; value: string; onChange?: (value: string) => void; readOnly?: boolean }) {
  return <label className="grid min-w-0 gap-1 text-sm font-semibold">{label}<input className="input min-w-0" type={type} value={value} readOnly={readOnly} onChange={(event) => onChange?.(event.target.value)} /></label>;
}

export function PersonnelDrawerContent({ user, school }: { user: AppUser; school: School }) {
  const [personnel, setPersonnel] = useState<AppUser[]>([]);
  const [view, setView] = useState<"active" | "archived">("active");
  const [selected, setSelected] = useState<AppUser>();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState<"archive" | "reactivate">();
  const [actionsOpen, setActionsOpen] = useState(false), [statusOpen, setStatusOpen] = useState(false);
  const statusDropdownRef = useDismissibleDropdown(() => setStatusOpen(false));
  const actionsDropdownRef = useDismissibleDropdown<HTMLButtonElement>(() => setActionsOpen(false));
  const [phone, setPhone] = useState(""), [email, setEmail] = useState("");
  const [sections, setSections] = useState<SchoolSection[]>([]);
  const [profile, setProfile] = useState<PersonnelProfile>();
  const [profileReady, setProfileReady] = useState(false);
  const [profileForm, setProfileForm] = useState<ProfileForm>({});
  const [photoFile, setPhotoFile] = useState<File>();
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [success, setSuccess] = useState("");
  const schoolSections = getSchoolSections(school);
  const sectionOptions = schoolSections.map((section) => ({ value: section, label: schoolSectionLabels[section] }));

  useAutoDismissMessage(error, () => setError(""), ERROR_MESSAGE_DURATION_MS);
  useAutoDismissMessage(success, () => setSuccess(""), SUCCESS_MESSAGE_DURATION_MS);

  useEffect(() => subscribeToSchoolPersonnel({
    user, schoolId: school.id,
    onData: (items) => { setPersonnel(items); setSelected((current) => current ? items.find((item) => item.id === current.id) : undefined); setLoading(false); setError(""); },
    onError: () => { setLoading(false); setError("Impossible d’actualiser les personnels."); },
  }), [school.id, user]);
  const selectedId = selected?.id;
  useEffect(() => {
    if (!selectedId) {
      setProfile(undefined);
      setProfileReady(false);
      return undefined;
    }
    setProfileReady(false);
    return subscribeToPersonnelProfile({
      user,
      schoolId: school.id,
      personnelId: selectedId,
      onData: (nextProfile) => { setProfile(nextProfile); setProfileReady(true); },
      onError: () => { setProfileReady(true); setError("Impossible d’actualiser la fiche administrative."); },
    });
  }, [school.id, selectedId, user]);

  const visible = useMemo(() => personnel.filter((item) => view === "archived" ? isArchivedPersonnel(item) : !isArchivedPersonnel(item)).sort((left, right) => left.name.localeCompare(right.name, "fr")), [personnel, view]);

  function clearFeedback() { setError(""); setSuccess(""); }
  function closeSelected() { if (busy) return; setSelected(undefined); setEditing(false); setConfirming(undefined); clearFeedback(); }
  function closeEdit() { if (busy) return; setEditing(false); setPhotoFile(undefined); setError(""); }
  function openEdit(item: AppUser) {
    const identity = personnelIdentity(item, profile);
    setSelected(item);
    setPhone(item.phone ?? "");
    setEmail(item.email);
    setSections(userSectionIds(item));
    setProfileForm({ ...profile, ...identity, jobTitle: profile?.jobTitle ?? personnelRoleLabels[item.role as keyof typeof personnelRoleLabels] ?? item.role });
    setPhotoFile(undefined);
    clearFeedback();
    setEditing(true);
  }

  async function saveEdit() {
    if (!selected || busy) return;
    const displayName = personnelDisplayName({ lastName: profileForm.lastName ?? "", middleName: profileForm.middleName ?? "", firstName: profileForm.firstName ?? "" });
    if (!displayName || !email.trim() || !isValidProvisioningPhone(phone)) return setError("Nom, téléphone valide et e-mail sont requis.");
    setBusy(true); setError("");
    let uploaded: { photoPath?: string; photoUrl?: string } = {};
    try {
      uploaded = photoFile ? await uploadPersonnelPhoto({ schoolId: school.id, personnelId: selected.id, file: photoFile }) : {};
      await updatePersonnel({ schoolId: school.id, personnelId: selected.id, name: displayName, phone: phone.trim(), email: email.trim(), section: sections[0] ?? null, sectionIds: sections, profile: { ...profileForm, ...uploaded } });
      if (uploaded.photoPath && profile?.photoPath !== uploaded.photoPath) await deletePersonnelPhoto(profile?.photoPath);
      setEditing(false); setSuccess("Personnel modifié avec succès.");
    } catch (cause) {
      if (uploaded.photoPath) await deletePersonnelPhoto(uploaded.photoPath);
      setError(cause instanceof Error ? cause.message : "Modification impossible.");
    } finally { setBusy(false); }
  }

  async function changeStatus() {
    if (!selected || !confirming || busy) return;
    setBusy(true); setError("");
    try {
      if (confirming === "archive") await archivePersonnel({ schoolId: school.id, personnelId: selected.id }); else await reactivatePersonnel({ schoolId: school.id, personnelId: selected.id });
      setConfirming(undefined); setSelected(undefined); setSuccess(confirming === "archive" ? "Personnel archivé avec succès." : "Personnel réactivé avec succès.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Changement de statut impossible."); }
    finally { setBusy(false); }
  }

  return <div className="grid gap-4">
    <div className="grid min-w-0 grid-cols-2 gap-2"><div ref={statusDropdownRef} className="relative min-w-0"><button type="button" className="secondary-button w-full justify-center" aria-haspopup="listbox" aria-expanded={statusOpen} onClick={() => setStatusOpen((current) => !current)}>Statut : {view === "active" ? "Actifs" : "Archivés"} <ChevronDown className="h-4 w-4"/></button>{statusOpen && <div role="listbox" aria-label="Filtrer les personnels" className="absolute left-0 right-0 top-full z-50 mt-1 grid rounded border border-slate-200 bg-white p-1 shadow-lg"><button role="option" aria-selected={view === "active"} type="button" className="min-h-10 rounded px-3 text-left hover:bg-slate-50" onClick={() => { setView("active"); setStatusOpen(false); }}>Actifs</button><button role="option" aria-selected={view === "archived"} type="button" className="min-h-10 rounded px-3 text-left hover:bg-slate-50" onClick={() => { setView("archived"); setStatusOpen(false); }}>Archivés</button></div>}</div><button type="button" className="primary-button w-full justify-center" disabled={loading || visible.length === 0} onClick={() => void printPersonnelListPdf(school, visible, view)}><Printer className="h-4 w-4"/> Imprimer</button></div>
    {error && <p role="alert" aria-live="assertive" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}{success && <p role="status" aria-live="polite" className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">{success}</p>}
    {loading ? <p className="py-8 text-center text-sm text-slate-500">Chargement des personnels…</p> : <div className="grid gap-2">{visible.map((item) => <article key={item.id} className="grid gap-2 rounded border border-slate-200 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="min-w-0"><button type="button" className="break-words text-left font-semibold text-blue-700 hover:underline focus-visible:ring-2 focus-visible:ring-blue-600" onClick={() => { setSelected(item); setProfile(undefined); clearFeedback(); }}>{item.name}</button><p className="text-sm text-slate-600">{personnelRoleLabels[item.role as keyof typeof personnelRoleLabels]}</p><p className="break-all text-xs text-slate-500">{item.phone || "Non renseigné"} · {item.email}</p></div><span className={`w-fit rounded-full px-2 py-1 text-xs font-semibold ${isArchivedPersonnel(item) ? "bg-slate-200 text-slate-700" : "bg-green-100 text-green-800"}`}>{isArchivedPersonnel(item) ? "Archivé" : "Actif"}</span></article>)}{visible.length === 0 && <p className="rounded bg-slate-50 p-6 text-center text-sm text-slate-500">Aucun personnel {view === "active" ? "actif" : "archivé"}.</p>}</div>}

    {selected && <AdminDrawer title={`Personnel — ${selected.name}`} closeLabel="Fermer la fiche Personnel" onClose={closeSelected}>
      <div className="grid grid-cols-2 gap-2"><div className="relative min-w-0"><button ref={actionsDropdownRef} type="button" className="secondary-button w-full justify-center" aria-haspopup="menu" aria-expanded={actionsOpen} disabled={busy || !profileReady || selected.role === "school_admin"} onClick={() => setActionsOpen((current) => !current)}>Actions <ChevronDown className="h-4 w-4"/></button>{actionsOpen && selected.role !== "school_admin" && <div role="menu" className="absolute left-0 right-0 top-full z-50 mt-1 grid rounded border border-slate-200 bg-white p-1 shadow-lg"><button role="menuitem" type="button" className="flex min-h-10 items-center gap-2 rounded px-3 text-left text-sm hover:bg-slate-50" onClick={() => { setActionsOpen(false); openEdit(selected); }}><Pencil className="h-4 w-4"/> Modifier</button>{isArchivedPersonnel(selected) ? <button role="menuitem" type="button" className="flex min-h-10 items-center gap-2 rounded px-3 text-left text-sm hover:bg-slate-50" onClick={() => { setActionsOpen(false); setConfirming("reactivate"); }}><ArchiveRestore className="h-4 w-4"/> Réactiver</button> : <button role="menuitem" type="button" className="flex min-h-10 items-center gap-2 rounded px-3 text-left text-sm text-red-700 hover:bg-red-50" onClick={() => { setActionsOpen(false); setConfirming("archive"); }}><Archive className="h-4 w-4"/> Archiver</button>}</div>}</div><button type="button" className="primary-button w-full justify-center" disabled={busy || !profileReady} onClick={() => void printPersonnelProfilePdf(school, selected, profile)}><Printer className="h-4 w-4"/> Imprimer</button></div>
      {!profileReady && <p role="status" className="py-4 text-center text-sm text-slate-500">Chargement de la fiche administrative…</p>}
      {profileReady && (
        <PersonnelProfileReadOnly personnel={selected} profile={profile}/>
      )}
    </AdminDrawer>}

    {editing && selected && <AdminDrawer title="Modifier le personnel" closeLabel="Fermer la modification" onClose={closeEdit}>
      <div className="grid min-w-0 gap-4">
        <EditSection title="1. IDENTIFICATION">
          {profile?.photoUrl && <img src={profile.photoUrl} alt={`Photo actuelle de ${selected.name}`} className="mx-auto h-32 w-28 rounded border object-contain"/>}
          <label className="grid min-w-0 gap-1 text-sm font-semibold">Photo<input className="input min-w-0" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPhotoFile(event.target.files?.[0])}/></label>
          <NativeField label="Matricule (automatique — lecture seule)" value={profile?.matricule || "Attribué automatiquement à l’enregistrement"} readOnly/>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2"><Field label="Nom" value={profileForm.lastName ?? ""} onChange={(lastName) => setProfileForm((current) => ({ ...current, lastName }))}/><Field label="Postnom" value={profileForm.middleName ?? ""} onChange={(middleName) => setProfileForm((current) => ({ ...current, middleName }))}/><Field label="Prénom" value={profileForm.firstName ?? ""} onChange={(firstName) => setProfileForm((current) => ({ ...current, firstName }))}/><label className="grid gap-1 text-sm font-semibold">Sexe<select className="input" value={profileForm.gender ?? ""} onChange={(event) => setProfileForm((current) => ({ ...current, gender: event.target.value as PersonnelProfile["gender"] || undefined }))}><option value="">Non renseigné</option><option value="F">Féminin</option><option value="M">Masculin</option><option value="Autre">Autre</option></select></label><NativeField label="Date de naissance" type="date" value={profileForm.birthDate ?? ""} onChange={(birthDate) => setProfileForm((current) => ({ ...current, birthDate }))}/><Field label="Lieu de naissance" value={profileForm.birthPlace ?? ""} onChange={(birthPlace) => setProfileForm((current) => ({ ...current, birthPlace }))}/></div>
        </EditSection>
        <EditSection title="2. COORDONNÉES"><div className="grid min-w-0 gap-3 sm:grid-cols-2"><Field label="Téléphone" value={phone} onChange={setPhone}/><Field label="E-mail" value={email} onChange={setEmail}/><div className="sm:col-span-2"><Field label="Adresse" value={profileForm.address ?? ""} onChange={(address) => setProfileForm((current) => ({ ...current, address }))}/></div></div></EditSection>
        <EditSection title="3. SITUATION PROFESSIONNELLE"><div className="grid min-w-0 gap-3 sm:grid-cols-2"><Field label="Fonction" value={profileForm.jobTitle ?? ""} onChange={(jobTitle) => setProfileForm((current) => ({ ...current, jobTitle }))}/><NativeField label="Date d’engagement" type="date" value={profileForm.engagementDate ?? ""} onChange={(engagementDate) => setProfileForm((current) => ({ ...current, engagementDate }))}/><Field label="Type de contrat" value={profileForm.contractType ?? ""} onChange={(contractType) => setProfileForm((current) => ({ ...current, contractType }))}/><NativeField label="Statut" value={isArchivedPersonnel(selected) ? "Archivé" : "Actif"} readOnly/></div><MultiSelectDropdown label="Sections" options={sectionOptions} values={sections} onChange={(values) => setSections(values as SchoolSection[])} placeholder={schoolSections.length ? "Non renseignée" : "Aucune section disponible"} /></EditSection>
        <EditSection title="4. FORMATION ET QUALIFICATIONS"><div className="grid min-w-0 gap-3 sm:grid-cols-2"><Field label="Niveau d’études" value={profileForm.educationLevel ?? ""} onChange={(educationLevel) => setProfileForm((current) => ({ ...current, educationLevel }))}/><Field label="Diplôme" value={profileForm.diploma ?? ""} onChange={(diploma) => setProfileForm((current) => ({ ...current, diploma }))}/><Field label="Spécialité" value={profileForm.specialty ?? ""} onChange={(specialty) => setProfileForm((current) => ({ ...current, specialty }))}/><Field label="Établissement de formation" value={profileForm.trainingInstitution ?? ""} onChange={(trainingInstitution) => setProfileForm((current) => ({ ...current, trainingInstitution }))}/><NativeField label="Année d’obtention" type="number" value={profileForm.graduationYear?.toString() ?? ""} onChange={(graduationYear) => setProfileForm((current) => ({ ...current, graduationYear: graduationYear ? Number(graduationYear) : undefined }))}/></div></EditSection>
        <EditSection title="5. INFORMATIONS COMPLÉMENTAIRES"><div className="grid min-w-0 gap-3 sm:grid-cols-2"><Field label="Personne à contacter" value={profileForm.emergencyContactName ?? ""} onChange={(emergencyContactName) => setProfileForm((current) => ({ ...current, emergencyContactName }))}/><Field label="Lien avec la personne" value={profileForm.emergencyContactRelationship ?? ""} onChange={(emergencyContactRelationship) => setProfileForm((current) => ({ ...current, emergencyContactRelationship }))}/><Field label="Téléphone de la personne à contacter" value={profileForm.emergencyContactPhone ?? ""} onChange={(emergencyContactPhone) => setProfileForm((current) => ({ ...current, emergencyContactPhone }))}/></div></EditSection>
        <EditSection title="6. OBSERVATIONS"><label className="grid min-w-0 gap-1 text-sm font-semibold">Observations<textarea className="input min-h-32 min-w-0 resize-y" value={profileForm.observations ?? ""} onChange={(event) => setProfileForm((current) => ({ ...current, observations: event.target.value }))}/></label></EditSection>
        <EditSection title="7. INFORMATIONS SYSTÈME — LECTURE SEULE"><NativeField label="Date d’établissement de la fiche" value={dateShown(selected.createdAt)} readOnly/></EditSection>
        {error && <p role="alert" aria-live="assertive" className="text-sm text-red-700">{error}</p>}
        <div className="grid grid-cols-2 gap-2"><button type="button" className="secondary-button justify-center" disabled={busy} onClick={closeEdit}>Annuler</button><button type="button" className="primary-button justify-center" disabled={busy} onClick={() => void saveEdit()}>{busy ? "Enregistrement…" : "Enregistrer"}</button></div>
      </div>
    </AdminDrawer>}

    {confirming && selected && <AdminDrawer title={confirming === "archive" ? "Archiver ce personnel ?" : "Réactiver ce personnel ?"} closeLabel="Fermer la confirmation" onClose={() => !busy && setConfirming(undefined)}><p>{confirming === "archive" ? "Ce compte ne pourra plus accéder à Acadéa, mais son historique sera conservé." : "Ce compte pourra de nouveau accéder à Acadéa avec ses identifiants existants."}</p><div className="grid grid-cols-2 gap-2"><button type="button" className="secondary-button justify-center" disabled={busy} onClick={() => setConfirming(undefined)}>Annuler</button><button type="button" className={confirming === "archive" ? "rounded bg-red-700 px-4 py-2 font-semibold text-white disabled:opacity-50" : "primary-button justify-center"} disabled={busy} onClick={() => void changeStatus()}>{busy ? "Traitement…" : confirming === "archive" ? "Archiver" : "Réactiver"}</button></div></AdminDrawer>}
  </div>;
}
