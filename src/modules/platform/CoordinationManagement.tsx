import { useEffect, useMemo, useState } from "react";
import { Building2, Check, ChevronRight, X } from "lucide-react";
import { collection, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import { AdminDrawer } from "../../components/ui";
import { addCoordinationSchool, removeCoordinationSchool } from "../../services/coordinationService";
import type { AppUser, Coordination, CoordinationSchool, School } from "../../types";

const ADD_CONFIRMATION = "AJOUTER CETTE ECOLE";
const REMOVE_CONFIRMATION = "RETIRER CETTE ECOLE";
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
  const [pendingRelation, setPendingRelation] = useState<{ action: "add" | "remove"; school: School } | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!db) return undefined;
    const stopCoordinations = onSnapshot(collection(db, "coordinations"), (snapshot) => setCoordinations(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Coordination)).sort((a, b) => a.name.localeCompare(b.name, "fr"))), () => setError("Impossible de charger les Coordinations."));
    const stopRelations = onSnapshot(collection(db, "coordinationSchools"), (snapshot) => setRelations(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as CoordinationSchool))), () => setError("Impossible de charger les rattachements."));
    getDocs(query(collection(db, "users"), where("role", "==", "coordination_admin"))).then((snapshot) => setCoordinators(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as AppUser)))).catch(() => setError("Impossible de charger les Coordinateurs."));
    return () => { stopCoordinations(); stopRelations(); };
  }, []);

  const selected = coordinations.find((item) => item.id === selectedId) ?? null;
  const selectedRelations = useMemo(() => relations.filter((item) => item.coordinationId === selectedId), [relations, selectedId]);
  const activeRelations = selectedRelations.filter((item) => item.active);
  const availableSchools = schools.filter((school) => !school.activeCoordinationId && !relations.some((relation) => relation.schoolId === school.id && relation.active));
  const coordinator = selected ? coordinators.find((item) => item.id === selected.principalCoordinatorUserId || item.coordinationId === selected.id) : undefined;
  const schoolName = (schoolId: string) => schools.find((school) => school.id === schoolId)?.name ?? schoolId;

  function requestRelation(action: "add" | "remove", school: School) {
    setPendingRelation({ action, school }); setConfirmation(""); setError("");
  }

  async function confirmRelation() {
    if (!selected || !pendingRelation) return;
    const expected = pendingRelation.action === "add" ? ADD_CONFIRMATION : REMOVE_CONFIRMATION;
    if (confirmation !== expected || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (pendingRelation.action === "add") await addCoordinationSchool(selected.id, pendingRelation.school.id);
      else await removeCoordinationSchool(selected.id, pendingRelation.school.id);
      setPendingRelation(null); setConfirmation(""); setMessage(pendingRelation.action === "add" ? "École rattachée." : "École retirée du périmètre. L’école et ses données sont conservées.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Modification impossible."); }
    finally { setBusy(false); }
  }

  return <section className="grid min-w-0 gap-4">
    {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-blue-100 bg-blue-50 p-4"><div><h2 className="text-lg font-bold">Coordinations</h2><p className="text-sm text-slate-600">Périmètres multi-écoles administrés exclusivement par le Super Administrateur.</p></div></div>
    <div className="grid min-w-0 gap-4"><div className="grid content-start gap-2 rounded border bg-white p-3 shadow-sm">
      {coordinations.length === 0 && <p className="p-4 text-sm text-slate-500">Aucune Coordination.</p>}
      {coordinations.map((item) => { const count = relations.filter((relation) => relation.coordinationId === item.id && relation.active).length; return <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className="flex min-w-0 items-center justify-between gap-3 rounded border border-slate-200 bg-white p-3 text-left hover:border-blue-400 hover:bg-blue-50"><span className="min-w-0"><strong className="block truncate">{item.name}</strong><span className="text-xs text-slate-500">{item.status === "active" ? "Active" : item.status} · {count} école{count > 1 ? "s" : ""}</span></span><ChevronRight className="h-4 w-4 shrink-0 text-slate-400" /></button>; })}
    </div></div>
    {selected && <AdminDrawer title={selected.name} closeLabel="Fermer la fiche Coordination" onClose={() => { setSelectedId(""); setPendingRelation(null); }}><div className="grid min-w-0 gap-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3">{selected.logoUrl && <img src={selected.logoUrl} alt={`Logo ${selected.name}`} className="h-12 w-12 rounded object-contain" />}<div><h3 className="text-xl font-bold">{selected.name}</h3><p className="text-sm text-slate-500">{selected.code || "Sans sigle"} · {selected.status}</p></div></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{coordinator?.name || selected.principalCoordinatorUserId || "Coordinateur non chargé"}</span></div>
      <div className="grid gap-2 text-sm sm:grid-cols-2"><p><b>E-mail :</b> {selected.email || "—"}</p><p><b>Téléphone :</b> {selected.phone || "—"}</p><p><b>Adresse :</b> {selected.address || "—"}</p><p><b>Créée le :</b> {dateLabel(selected.createdAt)}</p></div>
      <div><h4 className="mb-2 font-semibold">Écoles rattachées ({activeRelations.length})</h4><div className="grid gap-2">{selectedRelations.map((relation) => <div key={relation.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded border border-slate-200 p-2 text-sm"><span className="inline-flex min-w-0 items-center gap-2"><Building2 className="h-4 w-4 shrink-0 text-blue-600" /><span className="break-words">{schoolName(relation.schoolId)}</span><span className={`rounded px-2 py-0.5 text-xs ${relation.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{relation.active ? "Active" : `Retirée le ${dateLabel(relation.removedAt)}`}</span></span>{relation.active && <button type="button" disabled={busy} onClick={() => { const school = schools.find((item) => item.id === relation.schoolId); if (school) requestRelation("remove", school); }} className="inline-flex shrink-0 items-center gap-1 rounded border border-red-200 px-2 py-1 text-xs font-semibold text-red-700"><X className="h-3 w-3" />Retirer de la Coordination</button>}</div>)}</div></div>
      <div><h4 className="mb-2 font-semibold">Ajouter une école</h4><div className="grid gap-2 sm:grid-cols-2">{availableSchools.map((school) => <button key={school.id} type="button" disabled={busy} onClick={() => requestRelation("add", school)} className="inline-flex min-w-0 items-center gap-2 rounded border border-blue-200 px-3 py-2 text-left text-sm text-blue-700"><Check className="h-4 w-4 shrink-0" />{school.name}</button>)}{availableSchools.length === 0 && <p className="text-sm text-slate-500">Aucune école disponible.</p>}</div></div>
      {pendingRelation && <div className="grid gap-3 rounded border border-amber-200 bg-amber-50 p-3" role="alertdialog" aria-label="Confirmation de périmètre"><h4 className="font-bold">Confirmer {pendingRelation.action === "add" ? "le rattachement" : "le retrait"}</h4><p className="text-sm">École : <b>{pendingRelation.school.name}</b><br />Coordination : <b>{selected.name}</b></p>{pendingRelation.action === "remove" && <p className="text-sm">L’école ne sera pas supprimée d’Acadéa. Ses données, utilisateurs, élèves, finances et années scolaires sont conservés ; seule la relation avec cette Coordination sera retirée.</p>}{pendingRelation.action === "add" && <p className="text-sm">L’école sera rattachée à cette Coordination selon le workflow de gouvernance existant.</p>}<input className="input" aria-label="Texte de confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={pendingRelation.action === "add" ? ADD_CONFIRMATION : REMOVE_CONFIRMATION} /><div className="grid grid-cols-2 gap-2"><button type="button" className="secondary-button justify-center" disabled={busy} onClick={() => setPendingRelation(null)}>Annuler</button><button type="button" className="primary-button justify-center" disabled={busy || confirmation !== (pendingRelation.action === "add" ? ADD_CONFIRMATION : REMOVE_CONFIRMATION)} onClick={() => void confirmRelation()}>{busy ? "Enregistrement…" : "Confirmer"}</button></div></div>}
    </div></AdminDrawer>}
  </section>;
}
