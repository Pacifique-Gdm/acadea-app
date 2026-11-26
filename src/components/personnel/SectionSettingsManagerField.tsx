import { useEffect, useState } from "react";
import type { AppUser, School } from "../../types";
import { setSectionSettingsManager, subscribeToSectionSettingsManagers } from "../../services/sectionSettingsManagers";
import { eligibleManagerSections, sectionManagerId } from "../../utils/sectionSettingsManagers";
import type { ManagedSection, SectionSettingsManagers } from "../../utils/sectionSettingsManagers";
import { schoolSectionLabels } from "../../utils/schoolConfig";
import { studyFunctionLabel } from "../../utils/studyFunction";
import { userFacingError } from "../../utils/userFacingError";
import { ErrorNotice } from "../ui/ErrorNotice";

// Lot R6 : case « Responsable des réglages de la section » dans la fiche du personnel (administrateur seulement).
// Elle n'apparaît que si la section (CTEB ou Secondaire) a à la fois un Préfet d'études et un Directeur des études.
const personLabel = (person: AppUser | undefined) => person ? `${person.name}${studyFunctionLabel(person) ? `, ${studyFunctionLabel(person)}` : ""}` : "une autre personne";

export function SectionSettingsManagerField({ admin, school, target, personnel, managersOverride }: { admin: AppUser; school: School; target: AppUser; personnel: readonly AppUser[]; managersOverride?: SectionSettingsManagers }) {
  const [managers, setManagers] = useState<SectionSettingsManagers>(managersOverride ?? {});
  const [replacing, setReplacing] = useState<ManagedSection>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isAdmin = admin.role === "school_admin" && admin.schoolId === school.id;
  useEffect(() => {
    if (managersOverride || !isAdmin) return undefined;
    return subscribeToSectionSettingsManagers({ schoolId: school.id, onData: setManagers, onError: () => setError("Impossible de lire les responsables des réglages.") });
  }, [isAdmin, managersOverride, school.id]);
  if (!isAdmin) return null;
  const sections = eligibleManagerSections(personnel, school.id, target);
  if (!sections.length) return null;

  async function save(section: ManagedSection, enabled: boolean) {
    setBusy(true); setError("");
    try {
      const next = await setSectionSettingsManager({ schoolId: school.id, section, userId: target.id, enabled, expectedUserId: sectionManagerId(managers, section) ?? null });
      setManagers(next);
      setReplacing(undefined);
    } catch (cause) { setError(userFacingError(cause, "Désignation du responsable impossible.")); }
    finally { setBusy(false); }
  }

  return <section className="grid gap-2 rounded border border-slate-200 bg-slate-50 p-3" aria-label="Responsable des réglages de la section">
    {sections.map((section) => {
      const currentId = sectionManagerId(managers, section);
      const current = currentId ? personnel.find((person) => person.id === currentId) : undefined;
      const checked = currentId === target.id;
      const label = schoolSectionLabels[section] ?? section;
      return <div key={section} className="grid gap-1">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={checked} disabled={busy} onChange={(event) => {
            if (!event.target.checked) { void save(section, false); return; }
            if (currentId && currentId !== target.id) { setReplacing(section); return; }
            void save(section, true);
          }}/>
          Responsable des réglages de la section {label}
        </label>
        {currentId && !checked && <p className="text-xs text-slate-500">Actuellement : {personLabel(current)}</p>}
        {replacing === section && <div role="alertdialog" aria-label="Confirmer le remplacement" className="grid gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">Remplacer {personLabel(current)} par {personLabel(target)} ?</p>
          <div className="grid grid-cols-2 gap-2"><button type="button" className="secondary-button justify-center" disabled={busy} onClick={() => setReplacing(undefined)}>Annuler</button><button type="button" className="primary-button justify-center" disabled={busy} onClick={() => void save(section, true)}>{busy ? "Enregistrement…" : "Remplacer"}</button></div>
        </div>}
      </div>;
    })}
    <ErrorNotice error={error} />
  </section>;
}
