import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { AdminDrawer } from "../../components/ui";
import type { School } from "../../types";
import { createCoordination } from "../../services/coordinationService";

export function CoordinationCreateDrawer({ schools, onClose, onSuccess }: { schools: School[]; onClose: () => void; onSuccess: () => void }) {
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
  const availableSchools = schools.filter((school) => !school.activeCoordinationId);
  const toggleSchool = (schoolId: string) => setSelectedSchools((current) => current.includes(schoolId) ? current.filter((id) => id !== schoolId) : [...current, schoolId]);

  async function submit() {
    if (!name.trim() || !coordinatorName.trim() || !coordinatorEmail.includes("@") || coordinatorPassword.length < 6 || selectedSchools.length === 0) {
      setError("Nom, Coordinateur, mot de passe et au moins une école sont requis.");
      return;
    }
    setBusy(true); setError("");
    try {
      await createCoordination({ name: name.trim(), code: code.trim() || undefined, phone: phone.trim() || undefined, email: email.trim() || undefined, address: address.trim() || undefined, schoolIds: selectedSchools, coordinator: { name: coordinatorName.trim(), email: coordinatorEmail.trim(), password: coordinatorPassword } });
      onSuccess(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Création impossible."); }
    finally { setBusy(false); }
  }

  return <AdminDrawer title="Créer Coordination" closeLabel="Fermer la création de Coordination" onClose={() => !busy && onClose()}>
    <div className="grid min-w-0 gap-3">
      <label className="grid gap-1 text-sm font-medium">Nom<input className="input" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="grid gap-1 text-sm font-medium">Code / sigle<input className="input" value={code} onChange={(event) => setCode(event.target.value)} /></label>
      <label className="grid gap-1 text-sm font-medium">Téléphone<input className="input" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
      <label className="grid gap-1 text-sm font-medium">E-mail institutionnel<input className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label className="grid gap-1 text-sm font-medium">Adresse<input className="input" value={address} onChange={(event) => setAddress(event.target.value)} /></label>
      <label className="grid gap-1 text-sm font-medium">Nom Coordinateur<input className="input" value={coordinatorName} onChange={(event) => setCoordinatorName(event.target.value)} /></label>
      <label className="grid gap-1 text-sm font-medium">E-mail Coordinateur<input className="input" type="email" value={coordinatorEmail} onChange={(event) => setCoordinatorEmail(event.target.value)} /></label>
      <label className="grid gap-1 text-sm font-medium">Mot de passe temporaire<input className="input" type="password" minLength={6} value={coordinatorPassword} onChange={(event) => setCoordinatorPassword(event.target.value)} /></label>
      <fieldset className="grid gap-2 rounded border p-3"><legend className="px-1 text-sm font-semibold">Écoles rattachées</legend>{availableSchools.map((school) => <label key={school.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selectedSchools.includes(school.id)} onChange={() => toggleSchool(school.id)} />{school.name}</label>)}{availableSchools.length === 0 && <p className="text-sm text-slate-500">Aucune école disponible.</p>}</fieldset>
      {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <button type="button" className="primary-button justify-center" disabled={busy} onClick={() => void submit()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {busy ? "Création…" : "Créer"}</button>
    </div>
  </AdminDrawer>;
}
