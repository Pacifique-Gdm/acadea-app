import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { AdminDrawer, Metric } from "../ui";
import { requestArchivedStudentsImport, type AnnualDecision, type AnnualDecisionGroup, type ArchivedStudentsImportStatus } from "../../services/provisioning";
import { annualExitReason } from "../../utils/studentYearTransition.js";
import { loadFirestoreYearData } from "../../services/firestoreData";
import type { AppData, AppUser, School, SchoolYear } from "../../types";
import { orderSchoolYears } from "../../utils/schoolYears";

export function ArchivedStudentsImportDrawer({ open, onClose, user, data, school, year, updateData }: {
  open: boolean; onClose: () => void; user: AppUser; data: AppData; school: School; year: SchoolYear;
  updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void;
}) {
  const [sourceYearId, setSourceYearId] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState<ArchivedStudentsImportStatus>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [finished, setFinished] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, AnnualDecision>>({});
  const [retained, setRetained] = useState<Set<string>>(new Set());
  const inFlight = useRef(false);
  const contextVersion = useRef(0);
  const canImport = user.role === "secretary" && user.status === "active" && user.schoolId === school.id
    && year.status === "active" && school.activeSchoolYearId === year.id;
  const archivedYears = orderSchoolYears(data.schoolYears.filter((item) => item.schoolId === school.id && item.status === "archived" && item.id !== year.id));

  useEffect(() => {
    const version = ++contextVersion.current;
    setStatus(undefined); setError(""); setFinished(false); setDecisions({}); setRetained(new Set());
    if (!open || !sourceYearId || !canImport) { setChecking(false); return; }
    setChecking(true);
    void requestArchivedStudentsImport({ schoolId: school.id, schoolYearId: year.id, sourceYearId, mode: "inspect" })
      .then((next) => {
        if (version !== contextVersion.current) return;
        setStatus(next);
        // Import déjà commencé : les décisions enregistrées s'appliquent et ne changent plus.
        if (next.decisionsLocked) { setDecisions(next.decisions ?? {}); setRetained(new Set(next.retainedStudentIds ?? [])); }
      })
      .catch((caught) => { if (version === contextVersion.current) setError(caught instanceof Error ? caught.message : "Vérification de l'import impossible."); })
      .finally(() => { if (version === contextVersion.current) setChecking(false); });
    return () => { contextVersion.current += 1; };
  }, [canImport, open, school.id, sourceYearId, year.id]);

  async function importStudents() {
    if (!canImport || confirmation !== "IMPORTER LES ELEVES" || !sourceYearId || checking || inFlight.current || status?.complete || !status?.sourceCount || review.missing.length) return;
    inFlight.current = true; setBusy(true); setError("");
    const version = contextVersion.current;
    try {
      let next: ArchivedStudentsImportStatus;
      // Continuation requests perform actual bounded transactions; this is not
      // polling. A failed call stops here and can be resumed safely by the user.
      do {
        next = await requestArchivedStudentsImport({ schoolId: school.id, schoolYearId: year.id, sourceYearId, mode: "import", confirmation, decisions, retainedStudentIds: [...retained] });
        if (version !== contextVersion.current) return;
        setStatus(next);
      } while (!next.complete && next.remaining > 0);
      if (!next.complete) throw new Error("Import incomplet. Vous pouvez reprendre l'opération sans doublon.");
      const refreshed = await loadFirestoreYearData(user, year.id);
      if (version !== contextVersion.current) return;
      if (!refreshed) throw new Error("Import terminé, mais actualisation des élèves indisponible. Réouvrez le formulaire pour vérifier.");
      updateData(refreshed, { persist: false });
      setFinished(true);
    } catch (caught) {
      if (version === contextVersion.current) setError(caught instanceof Error ? caught.message : "Import interrompu. Vous pouvez le reprendre sans doublon.");
    } finally { inFlight.current = false; setBusy(false); }
  }

  function close() {
    if (inFlight.current) return;
    setSourceYearId(""); setConfirmation(""); setStatus(undefined); setError(""); setFinished(false); setDecisions({}); setRetained(new Set()); onClose();
  }
  const locked = Boolean(status?.decisionsLocked) || busy;
  const toggleRetained = (id: string) => setRetained((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const review = summarize(status, decisions, retained);
  if (!open) return null;
  return <AdminDrawer title="Importer les élèves d’une année archivée" onClose={close} closeLabel="Fermer l'import des élèves">
    <div className="grid min-w-0 gap-4">
      <p className="rounded border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">La transition annuelle reprend les élèves éligibles, leurs fiches médicales et les configurations de frais et pédagogiques. Paiements, reçus, présences, notes, cotes, sanctions, messages et historiques restent dans leur année d'origine.</p>
      {!canImport ? <p role="alert">L'import nécessite un Secrétaire actif et l'année active de son école. Les archives restent en lecture seule.</p>
        : archivedYears.length === 0 ? <p>Aucune année archivée disponible pour l'import.</p>
          : <>
            <label className="grid gap-1 text-sm font-semibold">Année archivée
              <select className="input" value={sourceYearId} disabled={busy} onChange={(event) => { setSourceYearId(event.target.value); setConfirmation(""); }}>
                <option value="" disabled>Sélectionner une année</option>
                {archivedYears.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            {checking && <p role="status">Vérification des élèves et de l'import…</p>}
            {status && <Metric label="Élèves disponibles" value={String(status.sourceCount)} />}
            {status && <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <p className="rounded bg-green-50 p-2"><strong>{status.promotedCount ?? 0}</strong><br/>promus</p>
              <p className="rounded bg-slate-100 p-2"><strong>{status.terminalExitCount ?? 0}</strong><br/>fins de cycle terminal</p>
              <p className="rounded bg-amber-50 p-2"><strong>{status.schoolCycleExitCount ?? 0}</strong><br/>fins de cycle école</p>
              <p className="rounded bg-slate-100 p-2"><strong>{status.skippedCount ?? 0}</strong><br/>non réimportés</p>
            </div>}
            {status && <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4" aria-label="Données annuelles reconduites">
              <p className="rounded border border-slate-200 p-2"><strong>{status.importedCollections?.studentMedicalRecords ?? 0}</strong><br/>fiches médicales</p>
              <p className="rounded border border-slate-200 p-2"><strong>{status.importedCollections?.feeTypes ?? 0}</strong><br/>types de frais</p>
              <p className="rounded border border-slate-200 p-2"><strong>{status.importedCollections?.pedagogicalAssignments ?? 0}</strong><br/>affectations</p>
              <p className="rounded border border-slate-200 p-2"><strong>{status.importedCollections?.timetableEntries ?? 0}</strong><br/>créneaux d’horaire</p>
            </div>}
            {status?.status === "empty" && <p>Aucun élève dans l'année source archivée.</p>}
            {status && !status.complete && <AnnualDecisions status={status} decisions={decisions} retained={retained} locked={locked}
              onDecide={(key, value) => setDecisions((current) => ({ ...current, [key]: value }))} onToggleRetained={toggleRetained} />}
            {status && !status.complete && status.sourceCount > 0 && <AnnualSummary review={review} />}
            {status?.complete ? <p role="status" className="rounded bg-mint/10 p-3 text-sm">{finished ? `Transition terminée : ${status.promotedCount ?? status.importedCount} élève(s) promu(s), ${status.terminalExitCount ?? 0} fin(s) de cycle terminal, ${status.schoolCycleExitCount ?? 0} fin(s) de cycle dans l’établissement, ${status.skippedCount ?? 0} élève(s) non réimporté(s).` : `Les données de l’année sélectionnée ont déjà été importées vers ${year.name}.`}</p> : <>
              {(status?.status === "legacy-incomplete" || status?.status === "partial") && <p role="status">L'import précédent est incomplet. La reprise conserve les élèves déjà présents et leurs données.</p>}
              <label className="grid gap-1 text-sm font-semibold">Phrase de confirmation
                <input className="input" placeholder="IMPORTER LES ELEVES" value={confirmation} disabled={busy || checking} onChange={(event) => setConfirmation(event.target.value)} />
              </label>
              <button className="primary-button justify-center disabled:opacity-50" type="button" onClick={() => void importStudents()} disabled={busy || checking || !status?.sourceCount || review.missing.length > 0 || confirmation !== "IMPORTER LES ELEVES"}>
                <Upload className="h-4 w-4" />{busy ? `Transition annuelle… ${status?.phase ?? "préparation"}` : "Importer les données annuelles"}
              </button>
            </>}
          </>}
      {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
    </div>
  </AdminDrawer>;
}

type Review = {
  promoted: number;
  departures: Array<{ id: string; name: string; className: string; reason: string }>;
  openedClasses: string[];
  withoutOption: Array<{ id: string; name: string }>;
  missing: AnnualDecisionGroup[];
};

const effectiveDecision = (group: AnnualDecisionGroup, decisions: Record<string, AnnualDecision>) => decisions[group.key] ?? group.defaultDecision;

/** Résumé avant confirmation, recalculé à chaque choix de la Secrétaire.
 * Le serveur refait le même calcul et refuse toute décision manquante. */
export function summarize(status: ArchivedStudentsImportStatus | undefined, decisions: Record<string, AnnualDecision>, retained: Set<string>): Review {
  const groups = status?.groups ?? [];
  const serverOpened = groups.filter((group) => group.decision === "open").reduce((total, group) => total + group.students.length, 0);
  const opened = groups.filter((group) => effectiveDecision(group, decisions) === "open");
  const promoted = Math.max(0, (status?.promotedCount ?? 0) - serverOpened) + opened.reduce((total, group) => total + group.students.length, 0);
  const finalistReason = annualExitReason("finalist").exitReasonDetails;
  const departures = [
    ...(status?.finalists ?? []).filter((student) => !retained.has(student.id)).map((student) => ({ ...student, reason: finalistReason })),
    ...groups.filter((group) => effectiveDecision(group, decisions) === "leave").flatMap((group) => group.students
      .filter((student) => !retained.has(student.id))
      .map((student) => ({ ...student, reason: annualExitReason(group.kind, group.section).exitReasonDetails }))),
  ];
  const openedClasses = [...new Set(opened.map((group) => `${group.targetClassName}${group.kind !== "missing-cycle" && group.option ? ` (option ${group.option})` : ""}`))];
  const withoutOption = [...(status?.withoutOption ?? []), ...opened.filter((group) => group.sourceClassName === "8ème CTEB" && group.decision !== "open").flatMap((group) => group.students)];
  const missing = groups.filter((group) => !effectiveDecision(group, decisions) && group.students.some((student) => !retained.has(student.id)));
  return { promoted, departures, openedClasses, withoutOption, missing };
}

const KIND_LABELS: Record<AnnualDecisionGroup["kind"], string> = {
  "missing-class": "classe suivante non organisée",
  "missing-option": "option non organisée dans la classe suivante",
  "missing-cycle": "cycle non organisé dans l'école",
};

export function AnnualDecisions({ status, decisions, retained, locked, onDecide, onToggleRetained }: {
  status: ArchivedStudentsImportStatus; decisions: Record<string, AnnualDecision>; retained: Set<string>; locked: boolean;
  onDecide: (key: string, value: AnnualDecision) => void; onToggleRetained: (id: string) => void;
}) {
  const groups = status.groups ?? [];
  const finalists = status.finalists ?? [];
  if (!groups.length && !finalists.length) return null;
  const keep = (id: string) => <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={retained.has(id)} disabled={locked} onChange={() => onToggleRetained(id)} />Garder (retirer des partants)</label>;
  return <div className="grid gap-3" aria-label="Décisions du passage d'année">
    {status.decisionsLocked && <p role="status" className="text-sm">L'import a déjà commencé : les décisions enregistrées s'appliquent et ne peuvent plus être modifiées.</p>}
    {groups.map((group) => {
      const decision = effectiveDecision(group, decisions);
      return <fieldset key={group.key} className="grid gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm">
        <legend className="font-semibold">{group.sourceClassName}{group.option ? ` (option ${group.option})` : ""} → {group.targetClassName} : {KIND_LABELS[group.kind]}{group.kind === "missing-cycle" ? ` (${group.section})` : ""}</legend>
        <p>{group.students.length} élève(s). {group.kind === "missing-cycle" ? "Sans décision, les élèves quittent l'école." : "Décision obligatoire."}</p>
        <label className="flex items-center gap-2"><input type="radio" name={`decision-${group.key}`} checked={decision === "open"} disabled={locked || !group.canOpen} onChange={() => onDecide(group.key, "open")} />Ouvrir la classe suivante{group.kind === "missing-option" ? " (et son option)" : ""}</label>
        {!group.canOpen && group.openBlockedReason && <p className="text-xs">{group.openBlockedReason}</p>}
        <label className="flex items-center gap-2"><input type="radio" name={`decision-${group.key}`} checked={decision === "leave"} disabled={locked} onChange={() => onDecide(group.key, "leave")} />Les élèves quittent l'école</label>
        <ul className="grid gap-1">{group.students.map((student) => <li key={student.id} className="flex flex-wrap items-center justify-between gap-2">
          <span>{student.name} <span className="text-xs text-slate-500">{student.matricule}</span></span>{decision === "leave" && keep(student.id)}
        </li>)}</ul>
      </fieldset>;
    })}
    {finalists.length > 0 && <div className="grid gap-2 rounded border border-slate-200 p-3 text-sm">
      <p className="font-semibold">Finalistes de 4ème Humanité ({finalists.length}) : archivés « Finaliste : fin du cycle secondaire »</p>
      <ul className="grid gap-1">{finalists.map((student) => <li key={student.id} className="flex flex-wrap items-center justify-between gap-2">
        <span>{student.name} <span className="text-xs text-slate-500">{student.matricule}</span></span>{keep(student.id)}
      </li>)}</ul>
    </div>}
  </div>;
}

export function AnnualSummary({ review }: { review: Review }) {
  return <div className="grid gap-2 rounded border border-blue-100 bg-blue-50 p-3 text-sm" aria-label="Résumé avant confirmation">
    <p className="font-semibold">Résumé avant confirmation</p>
    <p><strong>{review.promoted}</strong> élève(s) montent dans la classe suivante.</p>
    {review.openedClasses.length > 0 && <p>Classes ouvertes : {review.openedClasses.join(", ")}.</p>}
    <p><strong>{review.departures.length}</strong> élève(s) archivé(s) (quittent l'école).</p>
    {review.departures.length > 0 && <ul className="grid gap-1 text-xs">{review.departures.map((student) => <li key={student.id}>{student.name} ({student.className}) : {student.reason}</li>)}</ul>}
    {review.withoutOption.length > 0 && <>
      <p>Élèves entrant en 1ère Humanité sans option ({review.withoutOption.length}) :</p>
      <ul className="grid gap-1 text-xs">{review.withoutOption.map((student) => <li key={student.id}>{student.name}</li>)}</ul>
    </>}
    {review.missing.length > 0 && <p role="alert" className="font-semibold text-red-700">Décision requise pour : {review.missing.map((group) => `${group.sourceClassName}${group.option ? ` (${group.option})` : ""} → ${group.targetClassName}`).join(", ")}.</p>}
  </div>;
}
