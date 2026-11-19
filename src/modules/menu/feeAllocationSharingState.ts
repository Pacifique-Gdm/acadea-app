import { useCallback, useEffect, useState } from "react";
import { loadAllocationShares, rubricsSharedWith, staffRoleLabel, type AllocationShares } from "../../services/feeAllocation";

/** Lot « Deux onglets » : état du partage des rubriques (Administrateur). */
const message = (cause: unknown) => cause instanceof Error ? cause.message : "Partage indisponible.";

export function useAllocationShares(schoolId: string, enabled: boolean) {
  const [shares, setShares] = useState<AllocationShares | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    if (!enabled) return;
    try { setShares(await loadAllocationShares(schoolId)); setError(""); } catch (cause) { setError(message(cause)); }
  }, [schoolId, enabled]);
  useEffect(() => { void reload(); }, [reload]);
  return { shares, error, reload, setShares };
}


export type Viewer = { id: string; label: string; detail: string; rubricIds: string[] };
/** Personnes qui voient quelque chose : « Tout le personnel » (si une rubrique lui est partagée), puis chacun. */
export function allocationViewers(shares: AllocationShares, names: Map<string, string>): Viewer[] {
  const allRubrics = Object.entries(shares.rubrics).filter(([, rule]) => rule.all).map(([id]) => id);
  const viewers: Viewer[] = allRubrics.length ? [{ id: "all", label: "Tout le personnel", detail: "", rubricIds: allRubrics }] : [];
  for (const person of shares.staff) {
    const rubricIds = rubricsSharedWith(shares.rubrics, person.id);
    if (rubricIds.length) viewers.push({ id: person.id, label: person.name, detail: staffRoleLabel(person.role), rubricIds });
  }
  return viewers.map((v) => ({ ...v, rubricIds: [...v.rubricIds].sort((a, b) => (names.get(a) ?? "").localeCompare(names.get(b) ?? "", "fr")) }));
}

