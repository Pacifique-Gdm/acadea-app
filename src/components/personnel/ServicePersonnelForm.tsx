import { useState, type FormEvent } from "react";
import { Field } from "../ui";
import { createServicePersonnel } from "../../services/personnel";
import { isValidProvisioningPhone } from "../../utils/schoolAccountCredentials";

export const SERVICE_PERSONNEL_FUNCTIONS = [
  "Vigile", "Gardien", "Agent de sécurité", "Agent d'entretien", "Personnel de ménage",
  "Intendant", "Jardinier", "Technicien", "Agent de maintenance", "Autre fonction",
] as const;

export function ServicePersonnelForm({ schoolId, onCreated }: { schoolId: string; onCreated?: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState<string>(SERVICE_PERSONNEL_FUNCTIONS[0]);
  const [otherJobTitle, setOtherJobTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(""); setSuccess("");
    if (!name.trim() || !isValidProvisioningPhone(phone) || jobTitle === "Autre fonction" && !otherJobTitle.trim()) {
      setError("Nom, téléphone valide et fonction professionnelle sont requis.");
      return;
    }
    setBusy(true);
    try {
      await createServicePersonnel({ schoolId, name: name.trim(), phone: phone.trim(), jobTitle, otherJobTitle: jobTitle === "Autre fonction" ? otherJobTitle.trim() : undefined });
      setName(""); setPhone(""); setJobTitle(SERVICE_PERSONNEL_FUNCTIONS[0]); setOtherJobTitle("");
      setSuccess("Fiche du personnel créée sans compte Acadéa.");
      onCreated?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Création du personnel impossible.");
    } finally { setBusy(false); }
  }

  return <form onSubmit={(event) => void submit(event)} className="grid min-w-0 gap-4">
    <Field label="Nom complet" value={name} onChange={setName}/>
    <Field label="Téléphone" value={phone} onChange={setPhone}/>
    <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">Fonction professionnelle
      <select className="input min-w-0" value={jobTitle} onChange={(event) => setJobTitle(event.target.value)}>{SERVICE_PERSONNEL_FUNCTIONS.map((title) => <option key={title} value={title}>{title}</option>)}</select>
    </label>
    {jobTitle === "Autre fonction" && <Field label="Préciser la fonction" value={otherJobTitle} onChange={setOtherJobTitle}/>}
    {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {success && <p role="status" className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">{success}</p>}
    <button type="submit" className="primary-button justify-center" disabled={busy}>{busy ? "Création…" : "Créer le personnel sans compte"}</button>
  </form>;
}
