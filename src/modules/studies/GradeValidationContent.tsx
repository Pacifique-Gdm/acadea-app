import { useEffect, useState } from "react";
import type { School, SchoolYear } from "../../types";
import { ErrorNotice } from "../../components/ui/ErrorNotice";
import { ModifiedBy } from "../../components/ui/ModifiedBy";
import { userFacingError } from "../../utils/userFacingError";
import { ConsolidatedGradesView } from "../teacher/ConsolidatedGradesView";
import type { ConsolidatedClassReport } from "../teacher/consolidatedGrades";
import { loadDirectorConsolidatedReport } from "../teacher/gradePublicationService";
import { editableGradingSlots, gradingSlotLabels, type EditableGradingSlot } from "../teacher/teacherGrading";
import { cancelGradeValidation, loadGradeValidationStatus, validateGrades, validationLabel, type GradeValidationStatus } from "./gradeValidation";
import type { StudyClass } from "./studyTypes";

// Lot P6 : contenu du drawer « Validation des bulletins » du Préfet d'études.
// Le Préfet choisit une classe de SES sections et une période, consulte la fiche consolidée, puis valide.
// Ensuite seulement, la Direction des études peut publier (le serveur refuse sinon).
export function GradeValidationContent({ school, year, classes, sections }: { school: School; year: SchoolYear; classes: StudyClass[]; sections: string[] }) {
  const ownClasses = classes.filter((item) => item.active !== false && (!item.section || sections.includes(item.section)));
  const [classId, setClassId] = useState("");
  const [slot, setSlot] = useState<EditableGradingSlot>("period_1");
  const [status, setStatus] = useState<GradeValidationStatus>();
  const [report, setReport] = useState<ConsolidatedClassReport>();
  const [showReport, setShowReport] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const selected = ownClasses.find((item) => item.id === classId);

  useEffect(() => {
    if (!classId) return undefined;
    let active = true;
    setStatus(undefined); setError("");
    loadGradeValidationStatus(school.id, year.id, classId)
      .then((value) => { if (active) setStatus(value); })
      .catch((cause: unknown) => { if (active) setError(userFacingError(cause, "Validation des bulletins indisponible.")); });
    return () => { active = false; };
  }, [school.id, year.id, classId, attempt]);

  async function openReport() {
    setShowReport(true);
    if (report) return;
    try { setReport((await loadDirectorConsolidatedReport(school.id, year.id, classId)).report); }
    catch (cause) { setError(userFacingError(cause, "Fiche consolidée indisponible.")); }
  }
  async function act(kind: "validate" | "cancel") {
    const state = status?.validations?.[slot];
    if (busy || !state) return;
    setBusy(true); setError("");
    try {
      if (kind === "validate") await validateGrades({ schoolId: school.id, schoolYearId: year.id, classId, slot, expectedFingerprint: state.fingerprint });
      else await cancelGradeValidation({ schoolId: school.id, schoolYearId: year.id, classId, slot });
      setAttempt((value) => value + 1);
    } catch (cause) { setError(userFacingError(cause, "Validation impossible.")); }
    finally { setBusy(false); }
  }

  const state = status?.validations?.[slot];
  return <div className="grid gap-4">
    <p className="text-sm text-slate-500">Valider une classe et une période avant la publication aux parents par la Direction des études.</p>
    <ErrorNotice error={error} />
    <label className="grid gap-1 text-sm font-semibold">Classe<select className="input" value={classId} onChange={(event) => { setClassId(event.target.value); setReport(undefined); setShowReport(false); }}>
      <option value="">Choisir une classe</option>
      {ownClasses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    {ownClasses.length === 0 && <p className="text-sm text-slate-600">Aucune classe dans vos sections.</p>}
    {classId && <label className="grid gap-1 text-sm font-semibold">Période<select className="input" value={slot} onChange={(event) => setSlot(event.target.value as EditableGradingSlot)}>
      {editableGradingSlots.map((item) => <option key={item} value={item}>{gradingSlotLabels[item]}</option>)}
    </select></label>}
    {classId && !status && !error && <p role="status" className="text-sm text-slate-500">Chargement…</p>}
    {status && !status.required && <p className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">La validation n'est pas exigée pour cette classe.</p>}
    {status?.required && <section className="grid gap-2 rounded border border-slate-200 bg-white p-3 text-sm">
      <p className="font-bold">{selected?.name ?? "Classe"} · {gradingSlotLabels[slot]}</p>
      <span className={`w-fit rounded px-2 py-0.5 text-xs font-bold ${state?.validated ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>{validationLabel(state)}</span>
      {state?.validated && state.validatedByName && <ModifiedBy name={state.validatedByName} functionLabel={state.validatedByFunction} at={state.validatedAt} verb="Validé" />}
      {state?.validated && <p className="text-xs text-slate-500">Publication possible par la Direction des études.</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="secondary-button min-w-0 justify-center" onClick={() => void openReport()}>Voir la fiche</button>
        {state?.validated
          ? <button type="button" className="secondary-button min-w-0 justify-center" disabled={busy || year.status !== "active"} onClick={() => void act("cancel")}>Annuler la validation</button>
          : <button type="button" className="primary-button min-w-0 justify-center" disabled={busy || !state || year.status !== "active"} onClick={() => void act("validate")}>{busy ? "Chargement…" : "Valider"}</button>}
      </div>
    </section>}
    {showReport && classId && (report ? <ConsolidatedGradesView report={report} school={school} year={year} className={selected?.name ?? "Classe"} /> : !error && <p role="status" className="text-sm text-slate-500">Chargement de la fiche…</p>)}
  </div>;
}
