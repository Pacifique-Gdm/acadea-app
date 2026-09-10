import { useState } from "react";
import type { School } from "../../types";
import type { SchoolLevelChoice } from "../../utils/schoolConfig";
import { AdminDrawer, Field, ImageUploadField } from "../../components/ui";
import { SCHOOL_INFORMATION_CONFIRMATION, canSaveSchoolInformation, schoolInformationDraft } from "./schoolInformation";
import type { SchoolInformationDraft } from "./schoolInformation";

export function SchoolInformationEditDrawer({
  school,
  schoolLevelChoices,
  saving,
  error,
  onClose,
  onSave,
}: {
  school: School;
  schoolLevelChoices: SchoolLevelChoice[];
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: (draft: SchoolInformationDraft, confirmation: string) => void;
}) {
  const [draft, setDraft] = useState(() => schoolInformationDraft(school));
  const [confirmation, setConfirmation] = useState("");
  const [logoProcessing, setLogoProcessing] = useState(false);
  const canSave = canSaveSchoolInformation({ draft, confirmation, saving, logoProcessing });

  return (
    <AdminDrawer
      title="Modifier les informations de l'école"
      closeLabel="Annuler la modification des informations de l'école"
      onClose={() => !saving && onClose()}
      footer={(
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <button type="button" className="secondary-button w-full justify-center" disabled={saving} onClick={onClose}>
            Annuler
          </button>
          <button type="button" className="primary-button w-full justify-center disabled:cursor-not-allowed disabled:opacity-50" disabled={!canSave} onClick={() => onSave(draft, confirmation)}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      )}
    >
      <div className="grid min-w-0 gap-4">
        <ImageUploadField
          label="Logo de l'école"
          value={draft.logoUrl}
          onChange={(logoUrl) => setDraft((current) => ({ ...current, logoUrl }))}
          onProcessingChange={setLogoProcessing}
          maxWidth={600}
          maxBytes={200 * 1024}
          disabled={saving}
          previewFit="contain"
        />
        <Field label="Nom de l'école" value={draft.name} onChange={(name) => setDraft((current) => ({ ...current, name }))} disabled={saving} />
        <Field label="Devise" value={draft.motto} onChange={(motto) => setDraft((current) => ({ ...current, motto }))} disabled={saving} />
        <Field label="Adresse" value={draft.address} onChange={(address) => setDraft((current) => ({ ...current, address }))} disabled={saving} />
        <Field label="Téléphone" value={draft.phone} onChange={(phone) => setDraft((current) => ({ ...current, phone }))} disabled={saving} />
        <Field label="Email" value={draft.email} onChange={(email) => setDraft((current) => ({ ...current, email }))} type="email" disabled={saving} />
        <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
          Niveau de l'école
          <select className="input min-w-0 w-full" value={draft.level} onChange={(event) => setDraft((current) => ({ ...current, level: event.target.value as SchoolLevelChoice }))} disabled={saving}>
            {schoolLevelChoices.map((level) => <option key={level} value={level}>{level}</option>)}
          </select>
        </label>
        <label className="grid min-w-0 gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
          Saisissez exactement « {SCHOOL_INFORMATION_CONFIRMATION} »
          <input
            className="input min-w-0 w-full bg-white"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={saving}
          />
        </label>
        {confirmation && confirmation !== SCHOOL_INFORMATION_CONFIRMATION && (
          <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
            Confirmation incorrecte. Saisissez exactement : {SCHOOL_INFORMATION_CONFIRMATION}
          </p>
        )}
        {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
      </div>
    </AdminDrawer>
  );
}
