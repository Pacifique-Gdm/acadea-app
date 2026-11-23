import type { FeeAllocationConfig } from "../../types/feeAllocation";

/** Version publique d'une répartition, telle que l'écran d'activation la reçoit. */
export type PlanVersion = { id: string; feeTypeId: string; version: number; status: "prepared" | "published"; hasSocialPart?: true };
export type PendingPublication = { feeTypeId: string; draftRevision: number; preparedId: string | null; hasSocialPart: boolean };

/** Correction 1.20.1 : frais à préparer puis publier, chacun pour lui-même (et non « le premier frais trouvé »).
 * - Un frais dont le brouillon est déjà publié à cette révision n'est plus à publier.
 * - Répartition active : un frais déjà réparti ne peut plus changer (le serveur refuse) ; il est compté à part.
 * - Un nouveau frais (ou une classe pas encore répartie) reste à publier, même s'il n'est pas le premier de la liste. */
export function pendingPublications(configs: FeeAllocationConfig[], versions: PlanVersion[], status: string) {
  const active = status !== "EN_PREPARATION";
  const items: PendingPublication[] = [];
  let locked = 0;
  for (const config of configs) {
    if (!config.draft) continue;
    const mine = versions.filter((version) => version.feeTypeId === config.feeTypeId && version.version === config.draftRevision);
    if (mine.some((version) => version.status === "published")) continue;
    if (active && config.currentVersionId) { locked += 1; continue; }
    const prepared = mine.find((version) => version.status === "prepared") ?? null;
    items.push({ feeTypeId: config.feeTypeId, draftRevision: config.draftRevision, preparedId: prepared?.id ?? null,
      hasSocialPart: prepared ? prepared.hasSocialPart === true : !!config.draft.socialRubrics?.length });
  }
  return { items, locked };
}
