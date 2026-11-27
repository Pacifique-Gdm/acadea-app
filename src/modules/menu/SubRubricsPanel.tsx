import { useMemo, useState } from "react";
import { allocationRequest } from "../../services/feeAllocation";
import { personnelJobTitleLabel } from "../../services/personnel";
import { formatRubricAmount } from "../../components/AllocationRubricSelect";
import { userFacingError } from "../../utils/userFacingError";
import { ErrorNotice } from "../../components/ui/ErrorNotice";
import { BUTTON_ROW, HandTypedPhraseField } from "./FeeAllocationSharing";

/** Lots 5 et 6 : sous-rubriques d'une rubrique (Administrateur). Une seule répartition pour tous les frais.
 * Montant fixe = par élève et par frais payé, servi en premier ; le reste en pourcentage ; « Non affecté (rubrique) » = le reste. */
export const SUB_RUBRICS_PHRASE = "ENREGISTRER LES SOUS-RUBRIQUES";
export const SUB_RUBRIC_FUNCTIONS = ["school_admin", "cashier", "discipline_director", "study_director", "secretary", "teacher", "service"] as const;
export type SubRubricFunction = typeof SUB_RUBRIC_FUNCTIONS[number];
export type SubRubric = { id: string; name: string; mode: "percent" | "fixed"; basisPoints?: number; fixedMinor?: number; functions: SubRubricFunction[] };
export type SubRubricBalanceRow = { id: string; name: string; mode?: "percent" | "fixed"; basisPoints?: number; fixedMinor?: number; receivedMinor: number; spentMinor: number; availableMinor: number };
export type RubricWithSubs = { id: string; name: string; subRubrics?: SubRubric[]; subView?: SubRubricBalanceRow[] };

export const functionLabel = (role: SubRubricFunction) => role === "service" ? "Personnel sans compte" : personnelJobTitleLabel(role, true);

type Line = { id?: string; name: string; mode: "percent" | "fixed"; value: string; functions: SubRubricFunction[] };
const toLine = (sub: SubRubric): Line => ({ id: sub.id, name: sub.name, mode: sub.mode, functions: [...sub.functions],
  value: sub.mode === "fixed" ? String((sub.fixedMinor ?? 0) / 100) : String((sub.basisPoints ?? 0) / 100) });
const hundredths = (value: string) => {
  const text = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const n = Math.round(Number(text) * 100);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** Convertit les lignes saisies en demande au serveur ; renvoie un message si une ligne est incomplète. */
export function subRubricPayload(lines: Line[]): { subRubrics: Array<Omit<SubRubric, "id"> & { id?: string }> } | { error: string } {
  const subRubrics = [];
  let basisPoints = 0;
  for (const line of lines) {
    const name = line.name.trim();
    const amount = hundredths(line.value);
    if (!name) return { error: "Donnez un nom à chaque sous-rubrique." };
    if (amount === null) return { error: `Valeur invalide pour « ${name} ».` };
    if (line.mode === "percent") { if (amount > 10000) return { error: `Pourcentage supérieur à 100 % pour « ${name} ».` }; basisPoints += amount; }
    subRubrics.push({ ...(line.id ? { id: line.id } : {}), name, mode: line.mode, ...(line.mode === "percent" ? { basisPoints: amount } : { fixedMinor: amount }), functions: line.functions });
  }
  if (basisPoints > 10000) return { error: "Les pourcentages dépassent 100 %." };
  return { subRubrics };
}

/** Vrai si un pourcentage ou un montant change (ajout et retrait compris) : la phrase tapée à la main est alors demandée. */
export function subRubricAmountsChanged(saved: SubRubric[], next: Array<{ id?: string; mode: string; basisPoints?: number; fixedMinor?: number }>) {
  const key = (list: typeof next) => JSON.stringify(list.map((s) => [s.id ?? "", s.mode, s.basisPoints ?? null, s.fixedMinor ?? null]));
  return key(saved) !== key(next);
}

export function SubRubricsPanel({ schoolId, rubric, currency, onSaved }: { schoolId: string; rubric: RubricWithSubs; currency?: string; onSaved: () => void }) {
  const saved = useMemo(() => rubric.subRubrics ?? [], [rubric.subRubrics]);
  const [lines, setLines] = useState<Line[]>(() => saved.map(toLine));
  const [typed, setTyped] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const money = (minor: number) => formatRubricAmount(minor, currency);
  const used = (id?: string) => { const row = rubric.subView?.find((r) => r.id === id); return !!row && (row.receivedMinor !== 0 || row.spentMinor !== 0); };
  const payload = subRubricPayload(lines);
  const changed = "subRubrics" in payload ? subRubricAmountsChanged(saved, payload.subRubrics) : true;
  const edit = (index: number, patch: Partial<Line>) => setLines((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  async function save() {
    if (busy) return;
    if (!("subRubrics" in payload)) { setError(payload.error); return; }
    if (changed && typed !== SUB_RUBRICS_PHRASE) { setError(`Tapez à la main « ${SUB_RUBRICS_PHRASE} » pour confirmer.`); return; }
    setBusy(true); setError("");
    try {
      await allocationRequest("save-sub-rubrics", { schoolId, rubricId: rubric.id, subRubrics: payload.subRubrics, ...(changed ? { confirmation: typed } : {}), requestId: `subrubric-${crypto.randomUUID()}` });
      setTyped(""); onSaved();
    } catch (cause) { setError(userFacingError(cause, "Sous-rubriques non enregistrées.")); } finally { setBusy(false); }
  }
  return <section className="grid gap-2 rounded border border-slate-200 bg-slate-50 p-2" aria-label={`Sous-rubriques de « ${rubric.name} »`} data-sub-rubrics-panel>
    <h4 className="font-semibold">Sous-rubriques de « {rubric.name} »</h4>
    <p className="text-justify text-xs text-slate-600">Une seule répartition, valable pour tous les frais qui alimentent « {rubric.name} ». Un montant fixe est compté par élève et par frais payé, et servi en premier ; les pourcentages se partagent le reste. Ce qui n'est pas réparti va dans « Non affecté ({rubric.name}) ». Les encaissements reçus avant la création restent dans « Non affecté ({rubric.name}) ».</p>
    {!!rubric.subView?.length && saved.length > 0 && <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-xs" data-sub-rubric-balances>
      <thead><tr className="text-left"><th className="p-1">Sous-rubrique</th><th className="p-1">Part</th><th className="p-1">Reçu</th><th className="p-1">Dépensé</th><th className="p-1">Disponible</th></tr></thead>
      <tbody>{rubric.subView.map((row) => <tr key={row.id} className={`border-t ${row.id === "UNALLOCATED" ? "italic text-slate-500" : ""}`}>
        <td className="p-1">{row.name}</td>
        <td className="p-1">{row.id === "UNALLOCATED" ? "le reste" : row.mode === "fixed" ? `${money(row.fixedMinor ?? 0)} fixe` : `${((row.basisPoints ?? 0) / 100).toLocaleString("fr-FR")} %`}</td>
        <td className="p-1">{money(row.receivedMinor)}</td><td className="p-1">{money(row.spentMinor)}</td>
        <td className={`p-1 font-semibold ${row.availableMinor < 0 ? "text-red-700" : ""}`}>{money(row.availableMinor)}</td>
      </tr>)}</tbody>
    </table></div>}
    {lines.map((line, index) => <div key={line.id ?? `new-${index}`} className="grid gap-2 rounded border bg-white p-2" data-sub-rubric-line>
      <label className="grid gap-1 text-sm">Nom<input className="input" maxLength={80} value={line.name} onChange={(event) => edit(index, { name: event.target.value })}/></label>
      <div className={BUTTON_ROW}>
        <label className="grid gap-1 text-sm">Mode<select className="input" value={line.mode} onChange={(event) => edit(index, { mode: event.target.value as Line["mode"] })}>
          <option value="percent">Pourcentage</option><option value="fixed">Montant fixe</option></select></label>
        <label className="grid gap-1 text-sm">{line.mode === "percent" ? "Pourcentage (%)" : `Montant par élève et par frais payé${currency ? ` (${currency})` : ""}`}
          <input className="input" inputMode="decimal" value={line.value} onChange={(event) => edit(index, { value: event.target.value })}/></label>
      </div>
      <fieldset className="grid gap-1 text-sm"><legend className="font-semibold">Fonctions concernées (proposition dans la paie)</legend>
        <span className="flex flex-wrap gap-2">{SUB_RUBRIC_FUNCTIONS.map((role) => <label key={role} className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
          <input type="checkbox" checked={line.functions.includes(role)} onChange={(event) => edit(index, { functions: event.target.checked ? [...line.functions, role] : line.functions.filter((f) => f !== role) })}/>{functionLabel(role)}</label>)}</span>
      </fieldset>
      {!used(line.id) && <div className={BUTTON_ROW}><button type="button" className="secondary-button w-full justify-center" onClick={() => setLines((rows) => rows.filter((_, i) => i !== index))}>Retirer la ligne</button></div>}
    </div>)}
    <div className={BUTTON_ROW}><button type="button" className="secondary-button w-full justify-center" onClick={() => setLines((rows) => [...rows, { name: "", mode: "percent", value: "", functions: [] }])}>+ Ajouter une sous-rubrique</button></div>
    {changed && "subRubrics" in payload && <HandTypedPhraseField phrase={SUB_RUBRICS_PHRASE} value={typed} onChange={setTyped} />}
    <ErrorNotice error={error} />
    <div className={BUTTON_ROW}>
      <button type="button" className="secondary-button w-full justify-center" disabled={busy} onClick={() => { setLines(saved.map(toLine)); setTyped(""); setError(""); }}>Annuler</button>
      <button type="button" className="primary-button w-full justify-center" disabled={busy || !("subRubrics" in payload) || (changed && typed !== SUB_RUBRICS_PHRASE)} onClick={() => void save()}>{busy ? "Enregistrement…" : "Enregistrer les sous-rubriques"}</button>
    </div>
  </section>;
}

/** Bouton « Sous-rubriques » (seul sur sa ligne, pleine largeur) et le panneau qu'il ouvre sous la rubrique. */
export function SubRubricsSection({ schoolId, rubric, currency, open, onToggle, onSaved }: {
  schoolId: string; rubric: RubricWithSubs; currency?: string; open: boolean; onToggle: () => void; onSaved: () => void;
}) {
  const count = rubric.subRubrics?.length ?? 0;
  return <>
    <span className={BUTTON_ROW}><button type="button" className="secondary-button w-full justify-center" aria-expanded={open} onClick={onToggle}>{open ? "Fermer les sous-rubriques" : `Sous-rubriques${count ? ` (${count})` : ""}`}</button></span>
    {open && <SubRubricsPanel key={JSON.stringify(rubric.subRubrics ?? [])} schoolId={schoolId} rubric={rubric} currency={currency} onSaved={onSaved} />}
  </>;
}
