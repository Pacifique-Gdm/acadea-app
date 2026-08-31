import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { AdminDrawer, Metric } from "../ui";
import { requestArchivedStudentsImport, type ArchivedStudentsImportStatus } from "../../services/provisioning";
import { loadFirestoreYearData } from "../../services/firestoreData";
import type { AppData, AppUser, School, SchoolYear } from "../../types";

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
  const inFlight = useRef(false);
  const contextVersion = useRef(0);
  const canImport = user.role === "secretary" && user.status === "active" && user.schoolId === school.id
    && year.status === "active" && school.activeSchoolYearId === year.id;
  const archivedYears = data.schoolYears.filter((item) => item.schoolId === school.id && item.status === "archived" && item.id !== year.id);

  useEffect(() => {
    const version = ++contextVersion.current;
    setStatus(undefined); setError(""); setFinished(false);
    if (!open || !sourceYearId || !canImport) { setChecking(false); return; }
    setChecking(true);
    void requestArchivedStudentsImport({ schoolId: school.id, schoolYearId: year.id, sourceYearId, mode: "inspect" })
      .then((next) => { if (version === contextVersion.current) setStatus(next); })
      .catch((caught) => { if (version === contextVersion.current) setError(caught instanceof Error ? caught.message : "Vérification de l'import impossible."); })
      .finally(() => { if (version === contextVersion.current) setChecking(false); });
    return () => { contextVersion.current += 1; };
  }, [canImport, open, school.id, sourceYearId, year.id]);

  async function importStudents() {
    if (!canImport || confirmation !== "IMPORTER LES ELEVES" || !sourceYearId || checking || inFlight.current || status?.complete || !status?.sourceCount) return;
    inFlight.current = true; setBusy(true); setError("");
    const version = contextVersion.current;
    try {
      let next: ArchivedStudentsImportStatus;
      // Continuation requests perform actual bounded transactions; this is not
      // polling. A failed call stops here and can be resumed safely by the user.
      do {
        next = await requestArchivedStudentsImport({ schoolId: school.id, schoolYearId: year.id, sourceYearId, mode: "import", confirmation });
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
    setSourceYearId(""); setConfirmation(""); setStatus(undefined); setError(""); setFinished(false); onClose();
  }
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
            {status?.status === "empty" && <p>Aucun élève dans l'année source archivée.</p>}
            {status?.complete ? <p role="status" className="rounded bg-mint/10 p-3 text-sm">{finished ? `Transition terminée : ${status.promotedCount ?? status.importedCount} élève(s) promu(s), ${status.terminalExitCount ?? 0} fin(s) de cycle terminal, ${status.schoolCycleExitCount ?? 0} fin(s) de cycle dans l’établissement, ${status.skippedCount ?? 0} élève(s) non réimporté(s).` : `Les données de l’année sélectionnée ont déjà été importées vers ${year.name}.`}</p> : <>
              {(status?.status === "legacy-incomplete" || status?.status === "partial") && <p role="status">L'import précédent est incomplet. La reprise conserve les élèves déjà présents et leurs données.</p>}
              <label className="grid gap-1 text-sm font-semibold">Phrase de confirmation
                <input className="input" placeholder="IMPORTER LES ELEVES" value={confirmation} disabled={busy || checking} onChange={(event) => setConfirmation(event.target.value)} />
              </label>
              <button className="primary-button justify-center disabled:opacity-50" type="button" onClick={() => void importStudents()} disabled={busy || checking || !status?.sourceCount || confirmation !== "IMPORTER LES ELEVES"}>
                <Upload className="h-4 w-4" />{busy ? `Transition annuelle… ${status?.phase ?? "préparation"}` : "Importer les données annuelles"}
              </button>
            </>}
          </>}
      {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
    </div>
  </AdminDrawer>;
}
