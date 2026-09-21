import { useState } from "react";
import type { School } from "../../types";
import { AdminDrawer } from "../../components/ui";
import { canSaveSchoolAcronym, SCHOOL_ACRONYM_CONFIRMATION, schoolAcronymError } from "./schoolAcronym";

export function SchoolAcronymEditDrawer({ school, saving, error, onClose, onSave }: {
  school: School;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: (acronym: string, confirmation: string) => void;
}) {
  const [acronym, setAcronym] = useState(school.acronym ?? "");
  const [confirmation, setConfirmation] = useState("");
  const validationError = acronym.trim() ? schoolAcronymError(acronym) : "";

  return <AdminDrawer title="Modifier le sigle" closeLabel="Annuler la modification du sigle" onClose={() => !saving && onClose()} footer={
    <div className="grid grid-cols-2 gap-2">
      <button type="button" className="secondary-button justify-center" disabled={saving} onClick={onClose}>Annuler</button>
      <button type="button" className="primary-button justify-center" disabled={!canSaveSchoolAcronym(acronym, school.acronym ?? "", confirmation, saving)} onClick={() => onSave(acronym.trim(), confirmation)}>{saving ? "Enregistrement…" : "Confirmer"}</button>
    </div>
  }>
    <label className="grid gap-1 text-sm font-semibold">Nouveau sigle<input className="input" value={acronym} onChange={(event) => setAcronym(event.target.value)} disabled={saving} /></label>
    <p className="text-sm text-slate-600">Le nouveau sigle changera les futures propositions d’adresses email. Les adresses des comptes existants resteront inchangées.</p>
    <label className="grid gap-1 text-sm font-semibold">Saisissez exactement « {SCHOOL_ACRONYM_CONFIRMATION} »<input className="input" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" spellCheck={false} disabled={saving} /></label>
    {validationError && <p role="alert" className="text-sm text-red-700">{validationError}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </AdminDrawer>;
}
