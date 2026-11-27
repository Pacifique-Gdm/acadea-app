import { useCallback, useEffect, useState } from "react";
import { ErrorNotice } from "../../components/ui/ErrorNotice";
import { formatActivityDateTime } from "../../utils/activityHistory";
import {
  basisPointsToPercent, emptyTemplateForm, loadAllocationTemplate, newTemplateId, percentToBasisPoints, percentsTotal, publishAllocationTemplate,
  templateFormProblems, templateToForm, type AllocationTemplate, type TemplateForm,
} from "../../services/coordinationAllocationTemplate";

/** Lot 7 — « Modèles de répartition » du Coordinateur. Aucune donnée d'école n'est lue ni affichée ici. */
export function AllocationTemplateEditor() {
  const [published, setPublished] = useState<AllocationTemplate | null>(null);
  const [form, setForm] = useState<TemplateForm>(emptyTemplateForm);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    setState("loading"); setError(null);
    try { const { template } = await loadAllocationTemplate(); setPublished(template); setForm(templateToForm(template)); setState("ready"); }
    catch (cause) { setError(cause); setState("error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (state === "loading") return <p role="status">Chargement du modèle…</p>;
  if (state === "error") return <ErrorNotice error={error} onRetry={() => void load()} fallback="Lecture du modèle impossible." />;

  const rubricIds = form.rubrics.map((r) => r.id);
  const problems = templateFormProblems(form);
  const nextVersion = (published?.version ?? 0) + 1;
  const update = (change: (draft: TemplateForm) => TemplateForm) => { setMessage(""); setForm((current) => change(structuredClone(current))); };
  async function publish() {
    if (busy || problems.length) return;
    setBusy(true); setError(null); setMessage("");
    try { const { template } = await publishAllocationTemplate(form, published?.version ?? 0); setPublished(template); setForm(templateToForm(template)); setMessage(`Version ${template.version} publiée.`); }
    catch (cause) { setError(cause); }
    finally { setBusy(false); }
  }
  const percentRow = (percents: Record<string, string>, onChange: (rubricId: string, value: string) => void, label: string) => {
    const total = percentsTotal(percents, rubricIds);
    return <div className="grid min-w-0 gap-2">
      <div className="grid min-w-0 gap-2 sm:grid-cols-3">{form.rubrics.map((rubric) => <label key={rubric.id} className="grid min-w-0 gap-1 text-sm font-medium">
        <span className="break-words">{rubric.name || "Rubrique sans nom"} (%)</span>
        <input className="input min-w-0 w-full" inputMode="decimal" aria-label={`${label} — ${rubric.name || "rubrique"} en pourcentage`} value={percents[rubric.id] ?? ""} onChange={(event) => onChange(rubric.id, event.target.value)} placeholder="0" />
      </label>)}</div>
      <p className={`text-sm ${total > 10000 ? "font-semibold text-red-700" : "text-slate-600"}`}>Total : {basisPointsToPercent(total)} % · Non affecté : {basisPointsToPercent(Math.max(0, 10000 - total))} %</p>
    </div>;
  };

  return <div className="grid min-w-0 gap-4 text-sm" data-allocation-template-editor>
    <p className="rounded bg-blue-50 p-3 text-justify">Cet écran ne montre aucune donnée des écoles : ni élèves, ni paiements, ni soldes. Les écoles de votre coordination pourront utiliser ce modèle et le modifier librement ; il ne change jamais une répartition déjà validée.</p>
    {published ? <p className="text-slate-600">Version publiée : <b>{published.version}</b>, le {formatActivityDateTime(published.publishedAt)}{published.publishedByName ? ` par ${published.publishedByName}` : ""}.</p> : <p className="text-slate-600">Aucun modèle publié pour l'instant.</p>}
    <label className="grid min-w-0 gap-1 font-semibold">Nom du modèle
      <input className="input min-w-0 w-full" value={form.name} maxLength={80} onChange={(event) => update((d) => ({ ...d, name: event.target.value }))} placeholder="Modèle 2026-2027" />
    </label>

    <section className="grid min-w-0 gap-3" aria-label="Rubriques du modèle">
      <h3 className="font-semibold">Rubriques et sous-rubriques</h3>
      {form.rubrics.map((rubric, index) => <div key={rubric.id} className="grid min-w-0 gap-2 rounded border p-3">
        <label className="grid min-w-0 gap-1 font-medium">Rubrique
          <input className="input min-w-0 w-full" value={rubric.name} maxLength={80} onChange={(event) => update((d) => { d.rubrics[index].name = event.target.value; return d; })} placeholder="Personnel" />
        </label>
        {rubric.subRubrics.map((sub, subIndex) => <div key={sub.id} className="grid min-w-0 gap-2 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
          <label className="grid min-w-0 gap-1">Sous-rubrique
            <input className="input min-w-0 w-full" value={sub.name} maxLength={80} onChange={(event) => update((d) => { d.rubrics[index].subRubrics[subIndex].name = event.target.value; return d; })} placeholder="Enseignant" />
          </label>
          <label className="grid min-w-0 gap-1">% de la rubrique
            <input className="input min-w-0 w-full" inputMode="decimal" value={sub.percent} onChange={(event) => update((d) => { d.rubrics[index].subRubrics[subIndex].percent = event.target.value; return d; })} placeholder="0" />
          </label>
          <button type="button" className="secondary-button w-full justify-center" onClick={() => update((d) => { d.rubrics[index].subRubrics.splice(subIndex, 1); return d; })}>Retirer</button>
        </div>)}
        {rubric.subRubrics.length > 0 && <p className="text-slate-600">Non affecté ({rubric.name || "rubrique"}) : {basisPointsToPercent(Math.max(0, 10000 - rubric.subRubrics.reduce((sum, sub) => sum + (percentToBasisPoints(sub.percent) || 0), 0)))} %</p>}
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <button type="button" className="secondary-button w-full justify-center" onClick={() => update((d) => { d.rubrics[index].subRubrics.push({ id: newTemplateId(), name: "", percent: "" }); return d; })}>Ajouter une sous-rubrique</button>
          <button type="button" className="secondary-button w-full justify-center" disabled={form.rubrics.length <= 1} onClick={() => update((d) => {
            d.rubrics.splice(index, 1);
            d.feeTypes.forEach((feeType) => { delete feeType.percents[rubric.id]; });
            delete d.defaultPercents[rubric.id];
            return d;
          })}>Retirer la rubrique</button>
        </div>
      </div>)}
      <button type="button" className="secondary-button w-full justify-center" onClick={() => update((d) => { d.rubrics.push({ id: newTemplateId(), name: "", subRubrics: [] }); return d; })}>Ajouter une rubrique</button>
    </section>

    <section className="grid min-w-0 gap-3" aria-label="Répartition par type de frais">
      <h3 className="font-semibold">Répartition par type de frais</h3>
      <p className="text-justify text-slate-600">Le type de frais est reconnu par le début du nom du frais de l'école (« Minerval 1ère » → Minerval). L'administrateur de l'école voit la correspondance proposée et peut la corriger avant de valider.</p>
      {form.feeTypes.map((feeType, index) => <div key={feeType.id} className="grid min-w-0 gap-2 rounded border p-3">
        <label className="grid min-w-0 gap-1 font-medium">Type de frais
          <input className="input min-w-0 w-full" value={feeType.label} maxLength={60} onChange={(event) => update((d) => { d.feeTypes[index].label = event.target.value; return d; })} placeholder="Minerval" />
        </label>
        {percentRow(feeType.percents, (rubricId, value) => update((d) => { d.feeTypes[index].percents[rubricId] = value; return d; }), feeType.label || "Type de frais")}
        <button type="button" className="secondary-button w-full justify-center" onClick={() => update((d) => { d.feeTypes.splice(index, 1); return d; })}>Retirer le type de frais</button>
      </div>)}
      <button type="button" className="secondary-button w-full justify-center" onClick={() => update((d) => { d.feeTypes.push({ id: newTemplateId(), label: "", percents: {} }); return d; })}>Ajouter un type de frais</button>
      <div className="grid min-w-0 gap-2 rounded border p-3">
        <h4 className="font-medium">Tout autre frais (par défaut)</h4>
        {percentRow(form.defaultPercents, (rubricId, value) => update((d) => { d.defaultPercents[rubricId] = value; return d; }), "Tout autre frais")}
      </div>
    </section>

    {problems.length > 0 && <ul className="grid gap-1 rounded bg-amber-50 p-3 text-amber-900" aria-label="À corriger avant publication">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>}
    {error ? <ErrorNotice error={error} fallback="Publication impossible." /> : null}
    {message && <p role="status" className="rounded bg-green-50 p-3 font-semibold text-green-800">{message}</p>}
    <button type="button" className="primary-button w-full justify-center" disabled={busy || problems.length > 0} onClick={() => void publish()}>{busy ? "Publication…" : `Publier la version ${nextVersion}`}</button>
  </div>;
}
