import { useCallback, useEffect, useState } from "react";
import { createRubric, deleteRubric, loadRubricCatalog, renameRubric, setRubricHidden, type AllocationCatalogRubric } from "../../services/feeAllocation";

const message = (cause: unknown) => cause instanceof Error ? cause.message : "Rubriques indisponibles.";

/** Lot 27b : rubriques de l'école pour l'année active (Administrateur). Renommer à tout moment ;
 * supprimer seulement une rubrique qui n'a jamais servi (sinon le serveur refuse : la masquer). */
export function RubricCatalogPanel({ schoolId, onChanged }: { schoolId: string; onChanged: () => void }) {
  const [rubrics, setRubrics] = useState<AllocationCatalogRubric[] | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(""), [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const refresh = useCallback(async () => {
    try { setRubrics((await loadRubricCatalog(schoolId)).rubrics); setError(""); } catch (cause) { setError(message(cause)); }
  }, [schoolId]);
  useEffect(() => { void refresh(); }, [refresh]);
  async function run(key: string, action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(key); setError("");
    try { await action(); await refresh(); onChanged(); } catch (cause) { setError(message(cause)); } finally { setBusy(""); }
  }
  return <details className="rounded border p-3 text-sm">
    <summary className="cursor-pointer font-semibold">Rubriques de l'année</summary>
    <p className="mt-2 text-xs text-slate-600">Une rubrique réutilisée sur plusieurs frais additionne ses montants (aucun doublon). Une rubrique déjà utilisée ne peut pas être supprimée, seulement masquée : elle reste dans l'historique.</p>
    {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
    {!rubrics && !error && <p role="status" className="mt-2">Chargement…</p>}
    <ul className="mt-2 grid gap-2">{(rubrics ?? []).map((rubric) => <li key={rubric.id} className="flex flex-wrap items-center gap-2 rounded border p-2">
      {editing?.id === rubric.id
        ? <><input className="input" aria-label="Nouveau nom" maxLength={80} value={editing.name} onChange={(event) => setEditing({ id: rubric.id, name: event.target.value })}/>
          <button type="button" className="secondary-button" disabled={!!busy || !editing.name.trim()} onClick={() => void run(`rename-${rubric.id}`, async () => { await renameRubric(schoolId, rubric.id, editing.name); setEditing(null); })}>Enregistrer</button>
          <button type="button" className="secondary-button" onClick={() => setEditing(null)}>Annuler</button></>
        : <><span className={`font-semibold ${rubric.hidden ? "text-slate-400 line-through" : ""}`}>{rubric.name}</span>{rubric.hidden && <span className="text-xs text-slate-500">masquée</span>}
          <button type="button" className="secondary-button" disabled={!!busy} onClick={() => setEditing({ id: rubric.id, name: rubric.name })}>Renommer</button>
          <button type="button" className="secondary-button" disabled={!!busy} onClick={() => void run(`hide-${rubric.id}`, () => setRubricHidden(schoolId, rubric.id, !rubric.hidden))}>{rubric.hidden ? "Afficher" : "Masquer"}</button>
          <button type="button" className="secondary-button" disabled={!!busy} onClick={() => void run(`delete-${rubric.id}`, () => deleteRubric(schoolId, rubric.id))}>Supprimer</button></>}
    </li>)}</ul>
    {rubrics && !rubrics.length && <p className="mt-2 text-slate-600">Aucune rubrique pour cette année.</p>}
    <div className="mt-3 flex flex-wrap gap-2"><input className="input" aria-label="Nom de la nouvelle rubrique" placeholder="Nom de la nouvelle rubrique" maxLength={80} value={name} onChange={(event) => setName(event.target.value)}/>
      <button type="button" className="secondary-button" disabled={!!busy || !name.trim()} onClick={() => void run("create", async () => { await createRubric(schoolId, name); setName(""); })}>Ajouter une rubrique</button></div>
  </details>;
}
