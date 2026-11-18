import type { FeeAllocationRubric, FeeAllocationVersion } from "../../types/feeAllocation";
import { UNALLOCATED_RUBRIC_ID, socialCaseShares, socialCumulativeLines, validateFeeAllocationRubrics } from "../../../api/_lib/feeAllocationMath.js";
import { toMoneyMinor } from "../../utils/money";

/** Lot 27c-4 : calculs de l'écran de la partie 2 (cas sociaux), identiques à ceux du registre. */
export type SocialPartLine = { id: string; name: string; mode: "percent" | "fixed"; value: string };
type Line = SocialPartLine;
const decimal = /^[0-9]+(?:[.,][0-9]{1,2})?$/;
const message = (cause: unknown) => cause instanceof Error ? cause.message : "Partie 2 indisponible.";

/** Rubriques de la partie 2 saisies, ou une erreur lisible. */
export function socialPartRubrics(lines: Line[]): { rubrics: FeeAllocationRubric[]; error: string } {
  try {
    return { error: "", rubrics: lines.map((line) => {
      if (!decimal.test(line.value.trim())) throw new Error("Renseignez une valeur positive avec au maximum deux décimales.");
      const minor = toMoneyMinor(Number(line.value.replace(",", ".")));
      return { id: line.id, name: line.name, mode: line.mode, ...(line.mode === "fixed" ? { fixedMinor: minor } : { basisPoints: minor }) };
    }) };
  } catch (cause) { return { rubrics: [], error: message(cause) }; }
}

/** Aperçu en dollars : un élève normal (tarif) et un cas social (montant net), rubrique par rubrique. */
export function socialPartPreview(partOne: Pick<FeeAllocationVersion, "rubrics" | "feeAmountMinor">, part2: FeeAllocationRubric[], netMinor: number) {
  const normal = validateFeeAllocationRubrics(partOne.rubrics, partOne.feeAmountMinor);
  validateFeeAllocationRubrics(part2, partOne.feeAmountMinor);
  if (!Number.isSafeInteger(netMinor) || netMinor < 0 || netMinor > partOne.feeAmountMinor) throw new Error("Le montant net doit être compris entre 0 et le tarif.");
  const social = socialCaseShares(partOne.rubrics, part2, partOne.feeAmountMinor, netMinor);
  // Ce que reçoit chaque rubrique quand le cas social a tout payé : exactement le calcul du registre.
  const paid = netMinor === 0 ? social.map((share) => ({ ...share, amountMinor: 0 })) : socialCumulativeLines(normal.shares, social, netMinor, netMinor);
  const names = new Map([...normal.rubrics.map((rubric) => [rubric.id, rubric.name] as const), [UNALLOCATED_RUBRIC_ID, "Non affecté"] as const]);
  return normal.shares.map((share) => ({ rubricId: share.rubricId, name: names.get(share.rubricId) ?? "Rubrique",
    normalMinor: share.amountMinor, socialMinor: paid.find((item) => item.rubricId === share.rubricId)?.amountMinor ?? 0 }))
    .sort((a, b) => (a.rubricId === UNALLOCATED_RUBRIC_ID ? 1 : 0) - (b.rubricId === UNALLOCATED_RUBRIC_ID ? 1 : 0) || a.name.localeCompare(b.name, "fr"));
}

