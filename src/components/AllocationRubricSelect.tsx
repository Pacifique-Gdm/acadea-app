import { useEffect, useState } from "react";
import { allocationRequest } from "../services/feeAllocation";

/** Selection is conditional on server-confirmed activation; the API rechecks it. */
export function AllocationRubricSelect({ schoolId, schoolYearId, value, onChange }: {
  schoolId: string; schoolYearId: string; value: string; onChange: (value: string) => void;
}) {
  const [options, setOptions] = useState<{ required: boolean; paused?: boolean; rubrics: { id: string; name: string }[] }>();
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setOptions(undefined); setError("");
    void allocationRequest<{ required: boolean; paused?: boolean; rubrics: { id: string; name: string }[] }>("spend-options", { schoolId, schoolYearId }, controller.signal)
      .then(result => { if (!controller.signal.aborted) setOptions(result); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Rubriques indisponibles."); });
    return () => controller.abort();
  }, [schoolId, schoolYearId, reload]);
  if (error) return <p role="alert">{error} <button type="button" className="secondary-button" onClick={() => setReload(n => n + 1)}>Réessayer les rubriques</button></p>;
  if (!options) return <p role="status">Vérification de la répartition…</p>;
  if (!options.required) return null;
  return <label className="grid gap-1 text-sm font-semibold">Rubrique d'imputation obligatoire
    <select required className="input" value={value} onChange={e => onChange(e.target.value)} disabled={options.paused}>
      <option value="">Choisir une rubrique</option>{options.rubrics.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
    </select>{options.paused && <span role="alert">Répartition en pause : aucun décaissement n'est autorisé.</span>}
  </label>;
}
