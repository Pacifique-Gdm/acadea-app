import type { FeeAllocationRubric, FeeAllocationVersion } from "../../types/feeAllocation";
import { UNALLOCATED_RUBRIC_ID, socialCaseShares, socialCumulativeLines, validateFeeAllocationRubrics } from "../../../api/_lib/feeAllocationMath.js";
import { toMoneyMinor } from "../../utils/money";
import { userFacingError } from "../../utils/userFacingError";

/** Lot 27c-4 : calculs de l'écran de la partie 2 (cas sociaux), identiques à ceux du registre.
 * Une ligne retirée (removed) ne reçoit plus rien : elle part au serveur comme une rubrique à 0 %. */
export type SocialPartLine = { id: string; name: string; mode: "percent" | "fixed"; value: string; removed?: boolean };
type Line = SocialPartLine;
const decimal = /^[0-9]+(?:[.,][0-9]{1,2})?$/;
const message = (cause: unknown) => userFacingError(cause, "Partie 2 indisponible.");
const percentText = (basisPoints: number) => `${(basisPoints / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;

/** Rubriques de la partie 2 saisies (lignes retirées à 0 %), le reste pour « Non affecté », ou une erreur lisible.
 * Version 1.19.0 : « Non affecté » ne se retire plus ; il reçoit toujours le reste (total inférieur à 100 % permis). */
export function socialPartRubrics(lines: Line[]): { rubrics: FeeAllocationRubric[]; error: string; percentBasisPoints: number; hasFixed: boolean } {
  try {
    const rubrics = lines.map((line): FeeAllocationRubric => {
      if (line.removed) return { id: line.id, name: line.name, mode: "percent", basisPoints: 0 };
      if (!decimal.test(line.value.trim())) throw new Error(`« ${line.name} » : renseignez une valeur positive avec au maximum deux décimales, ou retirez la ligne.`);
      const minor = toMoneyMinor(Number(line.value.replace(",", ".")));
      if (minor === 0) throw new Error(`« ${line.name} » est à 0 : retirez la ligne pour qu'elle ne reçoive plus rien.`);
      return { id: line.id, name: line.name, mode: line.mode, ...(line.mode === "fixed" ? { fixedMinor: minor } : { basisPoints: minor }) };
    });
    const percentBasisPoints = rubrics.reduce((sum, rubric) => sum + (rubric.mode === "percent" ? rubric.basisPoints ?? 0 : 0), 0);
    const hasFixed = rubrics.some((rubric) => rubric.mode === "fixed");
    if (percentBasisPoints > 10000) throw new Error(`Le total fait ${percentText(percentBasisPoints)} : il ne doit pas dépasser 100 % de ce que l'élève paie vraiment.`);
    return { error: "", rubrics, percentBasisPoints, hasFixed };
  } catch (cause) { return { rubrics: [], error: message(cause), percentBasisPoints: 0, hasFixed: false }; }
}

/** Texte du total, toujours visible sous les lignes. */
export function socialPartTotalText(percentBasisPoints: number, hasFixed: boolean) {
  const rest = Math.max(0, 10000 - percentBasisPoints);
  return `Total des rubriques : ${percentText(percentBasisPoints)}${hasFixed ? " plus les montants fixes" : ""}. Le reste${hasFixed ? "" : ` (${percentText(rest)})`} va dans « Non affecté ».`;
}

/** Aperçu en dollars : un élève normal (tarif) et un cas social (montant net), rubrique par rubrique. */
export function socialPartPreview(partOne: Pick<FeeAllocationVersion, "rubrics" | "feeAmountMinor">, part2: FeeAllocationRubric[], netMinor: number) {
  const normal = validateFeeAllocationRubrics(partOne.rubrics, partOne.feeAmountMinor);
  validateFeeAllocationRubrics(part2, partOne.feeAmountMinor, { allowZero: true });
  if (!Number.isSafeInteger(netMinor) || netMinor < 0 || netMinor > partOne.feeAmountMinor) throw new Error("Le montant net doit être compris entre 0 et le tarif.");
  const social = socialCaseShares(partOne.rubrics, part2, partOne.feeAmountMinor, netMinor);
  // Ce que reçoit chaque rubrique quand le cas social a tout payé : exactement le calcul du registre.
  const paid = netMinor === 0 ? social.map((share) => ({ ...share, amountMinor: 0 })) : socialCumulativeLines(normal.shares, social, netMinor, netMinor);
  const names = new Map([...normal.rubrics.map((rubric) => [rubric.id, rubric.name] as const), [UNALLOCATED_RUBRIC_ID, "Non affecté"] as const]);
  return normal.shares.map((share) => ({ rubricId: share.rubricId, name: names.get(share.rubricId) ?? "Rubrique",
    normalMinor: share.amountMinor, socialMinor: paid.find((item) => item.rubricId === share.rubricId)?.amountMinor ?? 0 }))
    .sort((a, b) => (a.rubricId === UNALLOCATED_RUBRIC_ID ? 1 : 0) - (b.rubricId === UNALLOCATED_RUBRIC_ID ? 1 : 0) || a.name.localeCompare(b.name, "fr"));
}


/** Version 1.19.0 : lignes de la partie 2 d'un frais, pré-remplies ; une rubrique à 0 % dans la partie 2 est une ligne retirée
 * (sa valeur de la partie 1 reste prête pour la remettre). */
export function socialPartLines(partOne: FeeAllocationRubric[], social?: FeeAllocationRubric[]): Line[] {
  const valueOf = (rubric: FeeAllocationRubric) => String((rubric.mode === "fixed" ? rubric.fixedMinor ?? 0 : rubric.basisPoints ?? 0) / 100);
  return partOne.map((rubric) => {
    const own = social?.find((item) => item.id === rubric.id);
    const removed = own?.mode === "percent" && own.basisPoints === 0;
    const source = own && !removed ? own : rubric;
    return { id: rubric.id, name: rubric.name, mode: source.mode, value: valueOf(source), ...(removed ? { removed: true } : {}) };
  });
}

/** « Appliquer à tous les frais » : recopie les réglages du frais affiché, rubrique par rubrique, sur chaque autre frais.
 * Une rubrique de l'autre frais absente du frais affiché garde sa valeur. Rend aussi, pour chaque frais, les rubriques
 * du frais affiché qu'il n'a pas : leur part ira dans « Non affecté ». */
export function applySocialLinesToAll(source: Line[], targets: { feeTypeId: string; lines: Line[] }[]) {
  return targets.map(({ feeTypeId, lines }) => ({ feeTypeId,
    lines: lines.map((line) => { const from = source.find((item) => item.id === line.id); return from ? { ...line, mode: from.mode, value: from.value, removed: from.removed ? true : undefined } : line; })
      .map(({ removed, ...line }) => removed ? { ...line, removed: true } : line),
    missing: source.filter((item) => !item.removed && !lines.some((line) => line.id === item.id)).map((item) => item.name) }));
}

/** Deux jeux de lignes donnent-ils la même partie 2 ? (sert à marquer un frais « modifié »). */
export function sameSocialLines(a: Line[], b: Line[]) {
  return a.length === b.length && a.every((line) => { const other = b.find((item) => item.id === line.id);
    return !!other && !!line.removed === !!other.removed && (line.removed || (line.mode === other.mode && Number(line.value.trim().replace(",", ".")) === Number(other.value.trim().replace(",", ".")))); });
}
