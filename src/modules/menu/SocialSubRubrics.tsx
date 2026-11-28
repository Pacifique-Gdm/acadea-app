import type { SocialSubOverride, SocialSubOverrides } from "../../services/feeAllocation";
import type { SubRubric } from "./SubRubricsPanel";

/** F2 (décision du 27/11/2026) : sous-rubriques des cas sociaux dans la partie 2.
 * Reprises automatiquement de la partie 1, modifiables ; une seule répartition par rubrique pour tous les frais des cas sociaux,
 * enregistrée avec « Publier la partie 2 » (seule la phrase « PUBLIER LA PARTIE DEUX » est demandée). */
export type SocialSubLine = { id: string; name: string; mode: "percent" | "fixed"; value: string; removed?: boolean };
export type CatalogRubricWithSocial = { id: string; name: string; subRubrics?: SubRubric[]; socialSubRubrics?: SocialSubOverrides };

const decimal = /^[0-9]+(?:[.,][0-9]{1,2})?$/;
const amountOf = (source: { mode: "percent" | "fixed"; basisPoints?: number; fixedMinor?: number }) => source.mode === "fixed" ? source.fixedMinor ?? 0 : source.basisPoints ?? 0;
const hundredths = (value: string) => decimal.test(value.trim()) ? Math.round(Number(value.trim().replace(",", ".")) * 100) : null;

/** Lignes de la partie 2 d'une rubrique : la partie 1, avec les écarts déjà publiés pour les cas sociaux. */
export function socialSubLines(subs: SubRubric[], overrides?: SocialSubOverrides): SocialSubLine[] {
  return subs.map((sub) => {
    const own: SocialSubOverride | undefined = overrides?.[sub.id];
    const removed = !!own && "removed" in own;
    const source = own && !("removed" in own) ? own : sub;
    return { id: sub.id, name: sub.name, mode: source.mode, value: String(amountOf(source) / 100), ...(removed ? { removed: true } : {}) };
  });
}

/** Écarts avec la partie 1 à envoyer au serveur, ou une erreur lisible. */
export function socialSubPayload(lines: SocialSubLine[], subs: SubRubric[]): { overrides: SocialSubOverrides } | { error: string } {
  const overrides: SocialSubOverrides = {};
  let basisPoints = 0;
  for (const line of lines) {
    const sub = subs.find((item) => item.id === line.id);
    if (!sub) continue;
    if (line.removed) { overrides[line.id] = { removed: true }; continue; }
    const amount = hundredths(line.value);
    if (amount === null || amount <= 0) return { error: `« ${line.name} » : renseignez une valeur positive avec au maximum deux décimales, ou retirez la ligne.` };
    if (line.mode === "percent") { if (amount > 10000) return { error: `Pourcentage supérieur à 100 % pour « ${line.name} ».` }; basisPoints += amount; }
    if (line.mode !== sub.mode || amount !== amountOf(sub)) overrides[line.id] = line.mode === "fixed" ? { mode: "fixed", fixedMinor: amount } : { mode: "percent", basisPoints: amount };
  }
  if (basisPoints > 10000) return { error: "Les pourcentages des sous-rubriques des cas sociaux dépassent 100 %." };
  return { overrides };
}

/** Vrai si les lignes donnent les mêmes écarts que ceux déjà publiés. */
export function sameSocialSubOverrides(a: SocialSubOverrides, b: SocialSubOverrides = {}) {
  const key = (value: SocialSubOverrides) => JSON.stringify(Object.keys(value).sort().map((id) => [id, value[id]]));
  return key(a) === key(b);
}

/** Bloc sous une rubrique de la partie 2 : ses sous-rubriques pour les cas sociaux et « Non affecté (rubrique) ». */
export function SocialSubRubricsBlock({ rubricName, lines, currency, error, onChange, onCopyPartOne }: {
  rubricName: string; lines: SocialSubLine[]; currency: "USD" | "CDF"; error: string; onChange: (lines: SocialSubLine[]) => void; onCopyPartOne: () => void;
}) {
  const update = (index: number, changes: Partial<SocialSubLine>) => onChange(lines.map((row, i) => i === index ? { ...row, ...changes } : row));
  return <div className="ml-4 grid gap-2 rounded border-l-4 border-indigo-200 bg-indigo-50/40 p-2" data-social-sub-rubrics aria-label={`Sous-rubriques de « ${rubricName} » pour les cas sociaux`}>
    <p className="text-xs text-slate-700"><span className="font-semibold">Sous-rubriques de « {rubricName} » pour les cas sociaux</span> — reprises automatiquement de la partie 1, modifiables. Valables pour tous les frais des cas sociaux.</p>
    {lines.map((line, index) => line.removed
      ? <div key={line.id} className="grid grid-cols-2 items-center gap-2" data-removed-sub-line>
        <span className="text-sm line-through">{line.name}</span>
        <button type="button" className="secondary-button w-full justify-center" onClick={() => update(index, { removed: false })}>Remettre la ligne</button></div>
      : <div key={line.id} className="grid gap-2 sm:grid-cols-4" data-social-sub-line>
        <span className="self-center text-sm">{line.name}</span>
        <label className="grid gap-1 text-sm">Mode<select className="input" aria-label={`Mode ${line.name}`} value={line.mode} onChange={(event) => update(index, { mode: event.target.value as SocialSubLine["mode"] })}><option value="percent">Pourcentage</option><option value="fixed">Montant fixe</option></select></label>
        <div className="grid min-w-0 gap-1 text-sm sm:col-span-2"><label htmlFor={`sous-valeur-${line.id}`}>{line.mode === "percent" ? "Pourcentage (%)" : `Montant par élève et par frais payé (${currency})`}</label>
          <div className="grid grid-cols-2 gap-2"><input id={`sous-valeur-${line.id}`} className="input min-w-0" inputMode="decimal" aria-label={`Valeur ${line.name}`} value={line.value} onChange={(event) => update(index, { value: event.target.value })}/>
            <button type="button" className="secondary-button w-full justify-center" aria-label={`Retirer la ligne ${line.name}`} onClick={() => update(index, { removed: true })}>Retirer la ligne</button></div></div>
      </div>)}
    <div className="grid grid-cols-2 gap-2 rounded bg-slate-100 p-1 text-sm italic text-slate-600" data-social-sub-unallocated><span>Non affecté ({rubricName})</span><span>reçoit le reste</span></div>
    {error && <p role="status" className="text-sm text-amber-800">{error}</p>}
    <button type="button" className="secondary-button w-full justify-center" onClick={onCopyPartOne}>Recopier les sous-rubriques de la partie 1</button>
  </div>;
}

