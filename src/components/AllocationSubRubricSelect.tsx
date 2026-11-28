import { formatRubricAmount, type SpendOptionsState, type SpendRubric } from "./AllocationRubricSelect";
import { personnelJobTitleLabel } from "../services/personnel";
import { SUB_REST_NAME } from "../utils/feeAllocationView";
import { formatCurrencyMoney } from "../utils/currency";

/** Lots 5 et 6 : 2e champ « Sous-rubrique ». Il n'apparaît que si la répartition est active (le 1er champ apparaît)
 * ET si la rubrique choisie a des sous-rubriques. Le serveur revérifie tout. */
export type SpendSubRubric = { id: string; name: string; availableMinor: number; functions?: string[] };
export const SUB_UNALLOCATED = "UNALLOCATED";
/** F2 (décision du 28/11/2026) : la ligne du reste s'appelle « Reste », comme dans les tableaux (jamais une rubrique d'école). */
export const subRubricLabel = (sub: Pick<SpendSubRubric, "id" | "name">) => sub.id === SUB_UNALLOCATED ? SUB_REST_NAME : sub.name;

export function subRubricsOf(state: Pick<SpendOptionsState, "options">, rubricId: string): SpendSubRubric[] {
  if (!state.options?.required || !rubricId) return [];
  const rubric = state.options.rubrics.find((item) => item.id === rubricId) as (SpendRubric & { subRubrics?: SpendSubRubric[] }) | undefined;
  return Array.isArray(rubric?.subRubrics) ? rubric.subRubrics : [];
}

export type SubRubricSpendCheck =
  | { kind: "none" }
  | { kind: "choose" }
  | { kind: "ready"; sub: SpendSubRubric; availableMinor: number; over: boolean };

/** Sortie d'argent sur une rubrique qui a des sous-rubriques : sous-rubrique obligatoire, montant limité à son solde. */
export function subRubricSpendCheck(state: Pick<SpendOptionsState, "options">, rubricId: string, subRubricId: string, debitMinor: number): SubRubricSpendCheck {
  const subs = subRubricsOf(state, rubricId);
  if (!subs.length) return { kind: "none" };
  const sub = subs.find((item) => item.id === subRubricId);
  if (!sub) return { kind: "choose" };
  return { kind: "ready", sub, availableMinor: sub.availableMinor, over: debitMinor > 0 && debitMinor > sub.availableMinor };
}

export const subRubricBlocks = (check: SubRubricSpendCheck) => check.kind === "choose" || (check.kind === "ready" && check.over);

/** Message d'erreur à montrer avant l'envoi, ou chaîne vide. */
export function subRubricSpendError(check: SubRubricSpendCheck, currency?: string) {
  if (check.kind === "choose") return "Choisissez la sous-rubrique.";
  if (check.kind === "ready" && check.over) return `Solde insuffisant sur « ${subRubricLabel(check.sub)} » : disponible ${formatRubricAmount(check.availableMinor, currency)}. Rien n'est enregistré.`;
  return "";
}

/** Paie : la première sous-rubrique dont les « Fonctions concernées » contiennent la fonction du bénéficiaire. */
export function proposedSubRubricId(subs: SpendSubRubric[], beneficiary?: { jobTitle: string; hasAccount: boolean } | null) {
  if (!beneficiary) return "";
  const role = beneficiary.hasAccount ? beneficiary.jobTitle : "service";
  return subs.find((sub) => (sub.functions ?? []).includes(role))?.id ?? "";
}

/** F2 (28/11/2026) : disponible négatif d'une sous-rubrique (part de l'ouverture baissée après une mise à jour du prévu).
 * Même format de montant que les tableaux, signe devant : « −$16,67 », « −16 670,00 FC ». */
export const negativeSubRubricMessage = (availableMinor: number, currency?: string) =>
  `Disponible négatif : −${formatCurrencyMoney(Math.abs(availableMinor) / 100, currency === "CDF" ? "CDF" : "USD")}. Aucune dépense possible sur cette sous-rubrique.`;

export function AllocationSubRubricSelect({ spend, rubricId, value, onChange, debitMinor = 0, proposedFor }: {
  spend: Pick<SpendOptionsState, "options">; rubricId: string; value: string; onChange: (value: string) => void; debitMinor?: number;
  proposedFor?: { jobTitle: string; hasAccount: boolean } | null;
}) {
  const subs = subRubricsOf(spend, rubricId);
  if (!subs.length) return null;
  const currency = spend.options?.currency;
  const check = subRubricSpendCheck(spend, rubricId, value, debitMinor);
  const proposed = proposedSubRubricId(subs, proposedFor);
  return <div className="grid gap-1" data-sub-rubric>
    <label className="grid gap-1 text-sm font-semibold">Sous-rubrique obligatoire
      <select required className="input" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Choisir une sous-rubrique</option>
        {subs.map((sub) => <option key={sub.id} value={sub.id} style={sub.availableMinor < 0 ? { color: "#b91c1c" } : undefined}>{subRubricLabel(sub)} — disponible {formatRubricAmount(sub.availableMinor, currency)}</option>)}
      </select>
    </label>
    {proposed && value === proposed && proposedFor && <p className="text-xs text-emerald-700" data-sub-rubric-proposed>Proposée selon la fonction « {personnelJobTitleLabel(proposedFor.jobTitle, proposedFor.hasAccount)} ». Vous pouvez la changer.</p>}
    {check.kind === "ready" && check.availableMinor < 0 && <p className="text-sm font-semibold text-red-700" data-sub-rubric-negative>{negativeSubRubricMessage(check.availableMinor, currency)}</p>}
    {check.kind === "ready" && check.over && <p role="alert" className="rounded bg-red-50 p-2 text-sm font-semibold text-red-700">Solde insuffisant sur « {subRubricLabel(check.sub)} » : il manque {formatRubricAmount(debitMinor - check.availableMinor, currency)}. Rien n'est enregistré.</p>}
  </div>;
}
