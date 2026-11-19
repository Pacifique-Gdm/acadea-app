import { useCallback, useEffect, useState } from "react";
import { allocationRequest } from "../services/feeAllocation";

export type SpendRubric = { id: string; name: string; availableMinor?: number };
export type SpendOptions = { required: boolean; paused?: boolean; rubrics: SpendRubric[]; currency?: string };
export type SpendOptionsState = { options?: SpendOptions; error: string; reload: () => void };

/** Rubriques d'imputation : la sélection dépend de l'activation confirmée par le serveur, qui revérifie tout. */
export function useAllocationSpendOptions(schoolId: string, schoolYearId: string, enabled = true): SpendOptionsState {
  const [options, setOptions] = useState<SpendOptions>();
  const [error, setError] = useState("");
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setError("");
    void allocationRequest<SpendOptions>("spend-options", { schoolId, schoolYearId }, controller.signal)
      .then(result => { if (!controller.signal.aborted) setOptions(result); })
      .catch(cause => { if (!controller.signal.aborted) { setOptions(undefined); setError(cause instanceof Error ? cause.message : "Rubriques indisponibles."); } });
    return () => controller.abort();
  }, [schoolId, schoolYearId, round, enabled]);
  useEffect(() => { setOptions(undefined); }, [schoolId, schoolYearId]);
  const reload = useCallback(() => setRound(n => n + 1), []);
  return { options, error, reload };
}

export type RubricSpendCheck =
  | { kind: "not-required" }
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "choose" }
  | { kind: "ready"; rubric: SpendRubric; availableMinor: number; over: boolean };

/** Dépense avec répartition active : rubrique obligatoire, et montant limité à son disponible. */
export function rubricSpendCheck(state: Pick<SpendOptionsState, "options" | "error">, rubricId: string, debitMinor: number): RubricSpendCheck {
  if (state.error) return { kind: "unavailable" };
  if (!state.options) return { kind: "loading" };
  if (!state.options.required) return { kind: "not-required" };
  const rubric = state.options.rubrics.find(r => r.id === rubricId);
  if (!rubric) return { kind: "choose" };
  const availableMinor = rubric.availableMinor ?? 0;
  return { kind: "ready", rubric, availableMinor, over: debitMinor > 0 && debitMinor > availableMinor };
}

const amount = (minor: number, currency?: string) => `${(minor / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency ?? ""}`.trim();

export function AllocationRubricSelect({ schoolId, schoolYearId, value, onChange, spend }: {
  schoolId: string; schoolYearId: string; value: string; onChange: (value: string) => void; spend?: SpendOptionsState;
}) {
  const own = useAllocationSpendOptions(schoolId, schoolYearId, !spend);
  const { options, error, reload } = spend ?? own;
  if (error) return <p role="alert">{error} <button type="button" className="secondary-button" onClick={reload}>Réessayer les rubriques</button></p>;
  if (!options) return <p role="status">Vérification de la répartition…</p>;
  if (!options.required) return null;
  return <label className="grid gap-1 text-sm font-semibold">Rubrique d'imputation obligatoire
    <select required className="input" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">Choisir une rubrique</option>{options.rubrics.map(r => <option key={r.id} value={r.id}>{r.name}{typeof r.availableMinor === "number" ? ` — disponible ${amount(r.availableMinor, options.currency)}` : ""}</option>)}
    </select>
  </label>;
}

export const formatRubricAmount = amount;
