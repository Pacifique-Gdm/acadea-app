import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";
import { Archive, ArchiveRestore, Building2, ChevronRight, Plus, UserRound } from "lucide-react";
import { AdminDrawer, MultiSelectDropdown, PasswordField } from "../../components/ui";
import { db } from "../../firebase";
import type { AppUser, AuditLog, Coordination, School, SubCoordination, SubCoordinationSchool } from "../../types";
import { temporaryPasswordAfterPhoneChange } from "../../utils/temporaryPassword";
import { activityTimestamp, formatActivityDateTime } from "../../utils/activityHistory";
import {
  addSubCoordinationSchool,
  archiveSubCoordination,
  createSubCoordination,
  nextSubCoordinationEmail,
  reactivateSubCoordination,
  removeSubCoordinationSchool,
  transferSubCoordinationSchool,
} from "../../services/subCoordinationService";

type Props = { coordination: Coordination; schools: School[]; currentUser: AppUser };

function dateLabel(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("fr-FR") : "—";
}

export function SubCoordinationManagement({ coordination, schools, currentUser }: Props) {
  const [items, setItems] = useState<SubCoordination[]>([]);
  const [relations, setRelations] = useState<SubCoordinationSchool[]>([]);
  const [coordinators, setCoordinators] = useState<AppUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [lastName, setLastName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordEdited, setPasswordEdited] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [circumscription, setCircumscription] = useState("");
  const [schoolIds, setSchoolIds] = useState<string[]>([]);
  const [transferSchoolId, setTransferSchoolId] = useState("");
  const [transferTargetId, setTransferTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!db || currentUser.role !== "coordination_admin") return undefined;
    const stopItems = onSnapshot(query(collection(db, "subCoordinations"), where("coordinationId", "==", coordination.id)), (snapshot) => {
      setItems(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as SubCoordination)).sort((a, b) => a.circumscription.localeCompare(b.circumscription, "fr")));
    }, () => setError("Impossible de charger les Sous-coordinations."));
    const stopRelations = onSnapshot(query(collection(db, "subCoordinationSchools"), where("coordinationId", "==", coordination.id)), (snapshot) => {
      setRelations(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as SubCoordinationSchool)));
    }, () => setError("Impossible de charger les écoles déléguées."));
    const stopAuditLogs = onSnapshot(query(collection(db, "auditLogs"), where("coordinationId", "==", coordination.id)), (snapshot) => {
      setAuditLogs(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as AuditLog)));
    }, () => setError("Impossible de charger l’historique des Sous-coordinations."));
    return () => { stopItems(); stopRelations(); stopAuditLogs(); };
  }, [coordination.id, currentUser.role]);

  useEffect(() => {
    if (!db || currentUser.role !== "coordination_admin" || items.length === 0) { setCoordinators([]); return; }
    let cancelled = false;
    void Promise.all(items.map((item) => getDoc(doc(db!, "users", item.coordinatorUserId)))).then((snapshots) => {
      if (!cancelled) setCoordinators(snapshots.filter((item) => item.exists()).map((item) => ({ id: item.id, ...item.data() } as AppUser)));
    }).catch(() => { if (!cancelled) setError("Impossible de charger les Sous-coordinateurs."); });
    return () => { cancelled = true; };
  }, [currentUser.role, items]);

  const selected = items.find((item) => item.id === selectedId) ?? null;
  const selectedRelations = useMemo(() => relations.filter((item) => item.subCoordinationId === selectedId), [relations, selectedId]);
  const activeRelations = selectedRelations.filter((item) => item.active);
  const activeAssignedSchoolIds = new Set(relations.filter((item) => item.active).map((item) => item.schoolId));
  const availableSchools = schools.filter((school) => !activeAssignedSchoolIds.has(school.id));
  const selectedCoordinator = selected ? coordinators.find((item) => item.id === selected.coordinatorUserId) : undefined;
  const selectedAuditLogs = useMemo(() => auditLogs
    .filter((item) => item.subCoordinationId === selectedId || item.resourceId === selectedId)
    .sort((left, right) => activityTimestamp(right.createdAt) - activityTimestamp(left.createdAt)), [auditLogs, selectedId]);
  const generatedEmail = useMemo(() => nextSubCoordinationEmail(coordination.name, coordinators), [coordination.name, coordinators]);

  useEffect(() => { if (!email) setEmail(generatedEmail); }, [email, generatedEmail]);

  function resetForm() {
    setLastName(""); setMiddleName(""); setFirstName(""); setPhone(""); setEmail(nextSubCoordinationEmail(coordination.name, coordinators)); setPassword(""); setPasswordEdited(false); setPasswordVisible(false); setCircumscription(""); setSchoolIds([]);
  }

  async function submit() {
    if (busy || !lastName.trim() || !phone.trim() || !email.includes("@") || password.length < 6 || !circumscription.trim()) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      await createSubCoordination({ circumscription: circumscription.trim(), schoolIds, coordinator: { lastName: lastName.trim(), middleName: middleName.trim() || undefined, firstName: firstName.trim() || undefined, phone: phone.trim(), email: email.trim(), password } });
      setCreateOpen(false); resetForm(); setSuccess("Sous-coordination créée avec succès.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Création impossible."); }
    finally { setBusy(false); }
  }

  async function changeSchool(schoolId: string, action: "add" | "remove") {
    if (!selected || busy) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      if (action === "add") await addSubCoordinationSchool(selected.id, schoolId); else await removeSubCoordinationSchool(selected.id, schoolId);
      setSuccess(action === "add" ? "École ajoutée au périmètre délégué." : "École retirée du périmètre délégué.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Modification impossible."); }
    finally { setBusy(false); }
  }

  async function transferSchool() {
    if (!selected || !transferSchoolId || !transferTargetId || busy) return;
    setBusy(true); setError(""); setSuccess("");
    try { await transferSubCoordinationSchool(selected.id, transferTargetId, transferSchoolId); setTransferSchoolId(""); setTransferTargetId(""); setSuccess("École transférée sans double attribution."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Transfert impossible."); }
    finally { setBusy(false); }
  }

  async function changeStatus() {
    if (!selected || busy) return;
    const archive = selected.active;
    if (!window.confirm(archive ? "Archiver ce Sous-coordinateur ? Ses relations resteront conservées." : "Réactiver ce Sous-coordinateur avec son périmètre actuel ?")) return;
    setBusy(true); setError(""); setSuccess("");
    try { if (archive) await archiveSubCoordination(selected.id); else await reactivateSubCoordination(selected.id); setSuccess(archive ? "Sous-coordinateur archivé." : "Sous-coordinateur réactivé."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Changement de statut impossible."); }
    finally { setBusy(false); }
  }

  return <div className="grid min-w-0 gap-4">
    {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {success && <p role="status" className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{success}</p>}
    <div className="flex min-w-0 flex-col gap-3 rounded border border-blue-100 bg-blue-50 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><h3 className="font-bold">Sous-coordinations</h3><p className="break-words text-sm text-slate-600">Déléguez la supervision sans transférer l’autorité annuelle.</p></div><button type="button" className="primary-button w-full justify-center sm:w-auto" onClick={() => { resetForm(); setCreateOpen(true); }}><Plus className="h-4 w-4"/>Créer sous-coordination</button></div>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]"><div className="grid content-start gap-2">{items.map((item) => <button key={item.id} type="button" className={`flex items-center justify-between gap-2 rounded border p-3 text-left ${selectedId === item.id ? "border-blue-400 bg-blue-50" : "bg-white"}`} onClick={() => setSelectedId(item.id)}><span className="min-w-0"><strong className="block truncate">{item.circumscription}</strong><span className="text-xs text-slate-500">{item.active ? "Active" : "Archivée"} · {relations.filter((relation) => relation.subCoordinationId === item.id && relation.active).length} école(s)</span></span><ChevronRight className="h-4 w-4 shrink-0"/></button>)}{items.length === 0 && <p className="rounded bg-slate-50 p-4 text-sm text-slate-500">Aucune Sous-coordination.</p>}</div>
      <div className="min-w-0 rounded border bg-white p-3 sm:p-4">{!selected && <p className="text-sm text-slate-500">Sélectionnez une Sous-coordination pour consulter sa fiche.</p>}{selected && <div className="grid min-w-0 gap-4"><div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><h4 className="break-words text-lg font-bold">{selected.circumscription}</h4><p className="text-sm text-slate-500">Créée le {dateLabel(selected.createdAt)}</p></div><button type="button" disabled={busy} onClick={() => void changeStatus()} className={selected.active ? "inline-flex w-full items-center justify-center gap-2 rounded border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 sm:w-auto" : "secondary-button w-full justify-center sm:w-auto"}>{selected.active ? <Archive className="h-4 w-4"/> : <ArchiveRestore className="h-4 w-4"/>}{selected.active ? "Archiver" : "Réactiver"}</button></div><p className="flex min-w-0 flex-wrap items-center gap-2 break-words text-sm"><UserRound className="h-4 w-4 shrink-0"/><b>Sous-coordinateur :</b> {selectedCoordinator?.name ?? selected.coordinatorUserId}</p><p className="text-sm"><b>Statut :</b> {selected.active ? "Actif" : "Archivé"}</p><div className="min-w-0"><h5 className="mb-2 font-semibold">Écoles supervisées ({activeRelations.length})</h5><div className="grid min-w-0 gap-2">{selectedRelations.map((relation) => <div key={relation.id} className="flex min-w-0 flex-col gap-2 rounded border p-2 text-sm sm:flex-row sm:items-center sm:justify-between"><span className="flex min-w-0 flex-wrap items-center gap-2"><Building2 className="h-4 w-4 shrink-0 text-blue-600"/><span className="min-w-0 break-words">{schools.find((school) => school.id === relation.schoolId)?.name ?? relation.schoolId}</span><span className={`rounded-full px-2 py-0.5 text-xs ${relation.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{relation.active ? "Active" : `Retirée le ${dateLabel(relation.removedAt)}`}</span></span>{relation.active && <button type="button" disabled={busy} className="w-full rounded border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 sm:w-auto" onClick={() => void changeSchool(relation.schoolId, "remove")}>Retirer</button>}</div>)}</div></div>{selected.active && <div><h5 className="mb-2 font-semibold">Ajouter une école disponible</h5><div className="grid gap-2 sm:grid-cols-2">{availableSchools.map((school) => <button key={school.id} type="button" disabled={busy} className="min-w-0 break-words rounded border border-blue-200 px-3 py-2 text-left text-sm text-blue-700" onClick={() => void changeSchool(school.id, "add")}>{school.name}</button>)}{availableSchools.length === 0 && <p className="text-sm text-slate-500">Aucune école disponible.</p>}</div></div>}{activeRelations.length > 0 && items.some((item) => item.id !== selected.id && item.active) && <div className="grid min-w-0 gap-2 rounded border p-3"><h5 className="font-semibold">Transférer une école</h5><select className="input min-w-0 w-full" aria-label="École à transférer" value={transferSchoolId} onChange={(event) => setTransferSchoolId(event.target.value)}><option value="">Choisir l’école</option>{activeRelations.map((relation) => <option key={relation.schoolId} value={relation.schoolId}>{schools.find((school) => school.id === relation.schoolId)?.name ?? relation.schoolId}</option>)}</select><select className="input min-w-0 w-full" aria-label="Sous-coordination cible" value={transferTargetId} onChange={(event) => setTransferTargetId(event.target.value)}><option value="">Choisir la cible</option>{items.filter((item) => item.id !== selected.id && item.active).map((item) => <option key={item.id} value={item.id}>{item.circumscription}</option>)}</select><button type="button" className="secondary-button w-full justify-center" disabled={busy || !transferSchoolId || !transferTargetId} onClick={() => void transferSchool()}>Transférer</button></div>}</div>}</div></div>
    {selected && <div className="rounded border bg-white p-4"><h5 className="mb-2 font-semibold">Historique pertinent</h5><div className="grid gap-2">{selectedAuditLogs.map((item) => <div key={item.id} className="rounded border bg-slate-50 p-2 text-sm"><p className="font-medium">{item.action}</p><p className="text-xs text-slate-500">{formatActivityDateTime(item.createdAt)} · {item.actorName || "Acteur inconnu"}</p></div>)}{selectedAuditLogs.length === 0 && <p className="text-sm text-slate-500">Aucune activité enregistrée.</p>}</div></div>}
    {createOpen && <AdminDrawer title="Créer sous-coordination" closeLabel="Fermer" onClose={() => !busy && setCreateOpen(false)}><div className="grid min-w-0 gap-3"><label className="grid min-w-0 gap-1 text-sm font-medium">Nom<input className="input min-w-0 w-full" value={lastName} onChange={(event) => setLastName(event.target.value)}/></label><label className="grid min-w-0 gap-1 text-sm font-medium">Postnom<input className="input min-w-0 w-full" value={middleName} onChange={(event) => setMiddleName(event.target.value)}/></label><label className="grid min-w-0 gap-1 text-sm font-medium">Prénom<input className="input min-w-0 w-full" value={firstName} onChange={(event) => setFirstName(event.target.value)}/></label><label className="grid min-w-0 gap-1 text-sm font-medium">Téléphone<input className="input min-w-0 w-full" value={phone} onChange={(event) => { const value = event.target.value; setPhone(value); setPassword(temporaryPasswordAfterPhoneChange({ nextPhone: value, currentPassword: password, manuallyEdited: passwordEdited })); }}/></label><label className="grid min-w-0 gap-1 text-sm font-medium">Email<input className="input min-w-0 w-full" type="email" value={email} onChange={(event) => setEmail(event.target.value)}/></label><PasswordField label="Mot de passe temporaire" value={password} onChange={(value) => { setPassword(value); setPasswordEdited(true); }} visible={passwordVisible} onToggle={() => setPasswordVisible((value) => !value)}/><label className="grid min-w-0 gap-1 text-sm font-medium">Circonscription<input className="input min-w-0 w-full" placeholder="Commune de Gombe" value={circumscription} onChange={(event) => setCircumscription(event.target.value)}/></label><MultiSelectDropdown label="Écoles à superviser" options={availableSchools.map((school) => ({ value: school.id, label: school.name }))} values={schoolIds} onChange={setSchoolIds} placeholder="Sélectionner les écoles"/><p className="break-words text-sm font-semibold text-blue-700">{schoolIds.length} école{schoolIds.length > 1 ? "s" : ""} sélectionnée{schoolIds.length > 1 ? "s" : ""}</p><div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><button type="button" className="secondary-button w-full justify-center" disabled={busy} onClick={() => setCreateOpen(false)}>Annuler</button><button type="button" className="primary-button w-full justify-center" disabled={busy || !lastName.trim() || !phone.trim() || !email.includes("@") || password.length < 6 || !circumscription.trim()} onClick={() => void submit()}>{busy ? "Création…" : "Créer"}</button></div></div></AdminDrawer>}
  </div>;
}
