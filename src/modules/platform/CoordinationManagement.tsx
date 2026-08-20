import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { Building2, Check, ChevronRight, Loader2, Plus, UserRound, X } from "lucide-react";
import { db } from "../../firebase";
import { createCoordination, addCoordinationSchool, removeCoordinationSchool } from "../../services/coordinationService";
import type { AppUser, Coordination, CoordinationSchool, School } from "../../types";

type Props = { schools: School[] };

function dateLabel(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("fr-FR") : "—";
}

export function CoordinationManagement({ schools }: Props) {
  const [coordinations, setCoordinations] = useState<Coordination[]>([]);
  const [relations, setRelations] = useState<CoordinationSchool[]>([]);
  const [coordinators, setCoordinators] = useState<AppUser[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [coordinatorName, setCoordinatorName] = useState("");
  const [coordinatorEmail, setCoordinatorEmail] = useState("");
  const [coordinatorPassword, setCoordinatorPassword] = useState("");
  const [selectedSchools, setSelectedSchools] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!db) return undefined;
    const stopCoordinations = onSnapshot(collection(db, "coordinations"), (snapshot) => {
      setCoordinations(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Coordination)).sort((a, b) => a.name.localeCompare(b.name, "fr")));
    }, () => setError("Impossible de charger les Coordinations."));
    const stopRelations = onSnapshot(collection(db, "coordinationSchools"), (snapshot) => {
      setRelations(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as CoordinationSchool)));
    }, () => setError("Impossible de charger les rattachements."));
    getDocs(query(collection(db, "users"), where("role", "==", "coordination_admin"))).then((snapshot) => {
      setCoordinators(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as AppUser)));
    }).catch(() => setError("Impossible de charger les Coordinateurs."));
    return () => { stopCoordinations(); stopRelations(); };
  }, []);

  const selected = coordinations.find((item) => item.id === selectedId) ?? null;
  const selectedRelations = useMemo(() => relations.filter((item) => item.coordinationId === selectedId), [relations, selectedId]);
  const activeRelations = selectedRelations.filter((item) => item.active);
  const uncoordinatedSchools = schools.filter((school) => !school.activeCoordinationId && !relations.some((relation) => relation.schoolId === school.id && relation.active));
  const availableSchools = uncoordinatedSchools.filter((school) => !activeRelations.some((relation) => relation.schoolId === school.id));
  const coordinator = selected ? coordinators.find((item) => item.id === selected.principalCoordinatorUserId || item.coordinationId === selected.id) : undefined;

  function toggleSchool(schoolId: string) {
    setSelectedSchools((current) => current.includes(schoolId) ? current.filter((id) => id !== schoolId) : [...current, schoolId]);
  }

  async function submitCreate() {
    if (!name.trim() || !coordinatorName.trim() || !coordinatorEmail.includes("@") || coordinatorPassword.length < 6 || selectedSchools.length === 0) {
      setError("Nom, Coordinateur, mot de passe et au moins une école sont requis.");
      return;
    }
    setBusy(true); setError(""); setMessage("");
    try {
      await createCoordination({ name: name.trim(), code: code.trim() || undefined, phone: phone.trim() || undefined, email: email.trim() || undefined, address: address.trim() || undefined, schoolIds: selectedSchools, coordinator: { name: coordinatorName.trim(), email: coordinatorEmail.trim(), password: coordinatorPassword } });
      setCreateOpen(false); setName(""); setCode(""); setPhone(""); setEmail(""); setAddress(""); setCoordinatorName(""); setCoordinatorEmail(""); setCoordinatorPassword(""); setSelectedSchools([]); setMessage("Coordination créée.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Création impossible."); }
    finally { setBusy(false); }
  }

  async function changeRelation(schoolId: string, action: "add" | "remove") {
    if (!selected) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (action === "add") await addCoordinationSchool(selected.id, schoolId); else await removeCoordinationSchool(selected.id, schoolId);
      setMessage(action === "add" ? "École rattachée." : "École retirée du périmètre.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Modification impossible."); }
    finally { setBusy(false); }
  }

  return <section className="grid min-w-0 gap-4">
    {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-blue-100 bg-blue-50 p-4">
      <div><h2 className="text-lg font-bold">Coordinations</h2><p className="text-sm text-slate-600">Périmètres multi-écoles administrés exclusivement par le Super Administrateur.</p></div>
      <button type="button" onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-2 rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4"/>Créer Coordination</button>
    </div>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div className="grid content-start gap-2 rounded border bg-white p-3 shadow-sm">
        {coordinations.length === 0 && <p className="p-4 text-sm text-slate-500">Aucune Coordination.</p>}
        {coordinations.map((item) => { const count = relations.filter((relation) => relation.coordinationId === item.id && relation.active).length; return <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`flex items-center justify-between gap-3 rounded border p-3 text-left ${selectedId === item.id ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white"}`}><span className="min-w-0"><strong className="block truncate">{item.name}</strong><span className="text-xs text-slate-500">{item.status === "active" ? "Active" : item.status} · {count} école{count > 1 ? "s" : ""}</span></span><ChevronRight className="h-4 w-4 shrink-0 text-slate-400"/></button>; })}
      </div>
      <div className="rounded border bg-white p-4 shadow-sm">
        {!selected && <p className="text-sm text-slate-500">Sélectionnez une Coordination pour consulter sa fiche.</p>}
        {selected && <div className="grid gap-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-bold">{selected.name}</h3><p className="text-sm text-slate-500">{selected.code || "Sans sigle"} · {selected.status}</p></div><span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold"><UserRound className="h-3.5 w-3.5"/>{coordinator?.name || selected.principalCoordinatorUserId || "Coordinateur non chargé"}</span></div><div className="grid gap-2 text-sm sm:grid-cols-2"><p><b>E-mail :</b> {selected.email || "—"}</p><p><b>Téléphone :</b> {selected.phone || "—"}</p><p><b>Adresse :</b> {selected.address || "—"}</p><p><b>Créée le :</b> {dateLabel(selected.createdAt)}</p></div><div><h4 className="mb-2 font-semibold">Écoles rattachées</h4><div className="grid gap-2">{selectedRelations.map((relation) => { const school = schools.find((item) => item.id === relation.schoolId); return <div key={relation.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 p-2 text-sm"><span className="inline-flex items-center gap-2"><Building2 className="h-4 w-4 text-blue-600"/>{school?.name || relation.schoolId}<span className={`rounded-full px-2 py-0.5 text-xs ${relation.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{relation.active ? "Active" : `Retirée le ${dateLabel(relation.removedAt)}`}</span></span>{relation.active && <button type="button" disabled={busy} onClick={() => changeRelation(relation.schoolId, "remove")} className="inline-flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-xs font-semibold text-red-700"><X className="h-3 w-3"/>Retirer</button>}</div>; })}</div></div><div><h4 className="mb-2 font-semibold">Ajouter des écoles</h4><div className="grid gap-2 sm:grid-cols-2">{availableSchools.map((school) => <button key={school.id} type="button" disabled={busy} onClick={() => changeRelation(school.id, "add")} className="inline-flex items-center gap-2 rounded border border-blue-200 px-3 py-2 text-left text-sm text-blue-700"><Check className="h-4 w-4"/>{school.name}</button>)}{availableSchools.length === 0 && <p className="text-sm text-slate-500">Aucune école disponible.</p>}</div></div></div>}
      </div>
    </div>
    {createOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4"><div role="dialog" aria-modal="true" className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl"><div className="mb-4 flex items-center justify-between"><h3 className="text-lg font-bold">Créer Coordination</h3><button type="button" onClick={() => setCreateOpen(false)} aria-label="Fermer"><X className="h-5 w-5"/></button></div><div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-medium">Nom<input className="input" value={name} onChange={(event) => setName(event.target.value)}/></label><label className="grid gap-1 text-sm font-medium">Code / sigle<input className="input" value={code} onChange={(event) => setCode(event.target.value)}/></label><label className="grid gap-1 text-sm font-medium">Téléphone<input className="input" value={phone} onChange={(event) => setPhone(event.target.value)}/></label><label className="grid gap-1 text-sm font-medium">E-mail institutionnel<input className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)}/></label><label className="grid gap-1 text-sm font-medium sm:col-span-2">Adresse<input className="input" value={address} onChange={(event) => setAddress(event.target.value)}/></label><label className="grid gap-1 text-sm font-medium">Nom Coordinateur<input className="input" value={coordinatorName} onChange={(event) => setCoordinatorName(event.target.value)}/></label><label className="grid gap-1 text-sm font-medium">E-mail Coordinateur<input className="input" type="email" value={coordinatorEmail} onChange={(event) => setCoordinatorEmail(event.target.value)}/></label><label className="grid gap-1 text-sm font-medium sm:col-span-2">Mot de passe temporaire<input className="input" type="password" minLength={6} value={coordinatorPassword} onChange={(event) => setCoordinatorPassword(event.target.value)}/></label></div><fieldset className="mt-4 rounded border p-3"><legend className="px-1 text-sm font-semibold">Écoles rattachées</legend><div className="grid gap-2 sm:grid-cols-2">{uncoordinatedSchools.map((school) => <label key={school.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selectedSchools.includes(school.id)} onChange={() => toggleSchool(school.id)}/>{school.name}</label>)}</div></fieldset><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setCreateOpen(false)} className="rounded border px-4 py-2 text-sm font-semibold">Annuler</button><button type="button" disabled={busy} onClick={submitCreate} className="inline-flex items-center gap-2 rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white">{busy && <Loader2 className="h-4 w-4 animate-spin"/>}Créer</button></div></div></div>}
  </section>;
}
