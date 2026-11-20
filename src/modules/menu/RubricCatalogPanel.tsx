import { useCallback, useEffect, useState } from "react";
import { deleteRubric, loadRubricCatalog, renameRubric, type AllocationCatalogRubric, type AllocationShares } from "../../services/feeAllocation";
import { BUTTON_ROW, HandTypedPhraseField, RENAME_PHRASE, ShareRubricButton } from "./FeeAllocationSharing";
import { userFacingError } from "../../utils/userFacingError";
import { ErrorNotice } from "../../components/ui/ErrorNotice";

const message = (cause: unknown) => userFacingError(cause, "Rubriques indisponibles.");

/** Rubriques de l'école pour l'année active (Administrateur).
 * Lot « Deux onglets » (décision du 17/11) : plus de bouton « Ajouter une rubrique » ni « Masquer ».
 * Une nouvelle rubrique se crée par « + Ajouter » puis « + Nouvelle rubrique… ». « Renommer » et « Partager »
 * (partage avec le personnel) pour toutes ; « Supprimer » seulement pour une rubrique qui n'a jamais servi
 * (le serveur garde son refus). L'ordre suit celui du tableau. */
export function RubricCatalogPanel({ schoolId, onChanged, order = [], shares, onSharesChanged }: {
  schoolId: string; onChanged: () => void; order?: string[]; shares?: AllocationShares | null; onSharesChanged?: (next: AllocationShares) => void;
}) {
  const [rubrics, setRubrics] = useState<AllocationCatalogRubric[] | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  // Version 1.15.2 : « RENOMMER CETTE RUBRIQUE » tapée à la main ; bouton bloqué tant que la phrase n'est pas exacte.
  const [renameTyped, setRenameTyped] = useState("");
  const refresh = useCallback(async () => {
    try { setRubrics((await loadRubricCatalog(schoolId)).rubrics); setError(""); } catch (cause) { setError(message(cause)); }
  }, [schoolId]);
  useEffect(() => { void refresh(); }, [refresh]);
  async function run(key: string, action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(key); setError("");
    try { await action(); await refresh(); onChanged(); } catch (cause) { setError(message(cause)); } finally { setBusy(""); }
  }
  const rank = (id: string) => { const index = order.indexOf(id); return index < 0 ? Number.MAX_SAFE_INTEGER : index; };
  const sorted = [...(rubrics ?? [])].sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name, "fr"));
  const shareLabel = (id: string) => {
    const rule = shares?.rubrics[id];
    if (!rule) return "";
    if (rule.all) return "partagée : tout le personnel";
    const n = rule.userIds?.length ?? 0;
    return n ? `partagée : ${n} personne${n > 1 ? "s" : ""}` : "";
  };
  return <details className="rounded border p-3 text-sm">
    <summary className="cursor-pointer font-semibold">Rubriques de l'année</summary>
    <p className="mt-2 text-justify text-xs text-slate-600">Une rubrique réutilisée sur plusieurs frais additionne ses montants. Une nouvelle rubrique se crée par « + Ajouter », puis « + Nouvelle rubrique… ». « Partager » la montre, en lecture seule, au personnel choisi.</p>
    <ErrorNotice error={error} onRetry={() => void refresh()} />
    {!rubrics && !error && <div aria-hidden className="mt-2 h-16 animate-pulse rounded bg-slate-100" />}
    <ul className="mt-2 grid gap-2">{sorted.map((rubric) => <li key={rubric.id} className="grid gap-2 rounded border p-2">
      {editing?.id === rubric.id
        ? <span className="grid gap-2"><input className="input w-full" aria-label="Nouveau nom" maxLength={80} value={editing.name} onChange={(event) => setEditing({ id: rubric.id, name: event.target.value })}/>
          <HandTypedPhraseField phrase={RENAME_PHRASE} value={renameTyped} onChange={setRenameTyped} />
          <span className={BUTTON_ROW}><button type="button" className="secondary-button w-full justify-center" onClick={() => setEditing(null)}>Annuler</button>
          <button type="button" className="primary-button w-full justify-center" disabled={!!busy || !editing.name.trim() || renameTyped !== RENAME_PHRASE} onClick={() => { if (renameTyped !== RENAME_PHRASE) return; void run(`rename-${rubric.id}`, async () => { await renameRubric(schoolId, rubric.id, editing.name); setEditing(null); }); }}>Enregistrer</button></span></span>
        : <><span className="font-semibold">{rubric.name}{shareLabel(rubric.id) && <span className="ml-2 rounded bg-emerald-50 px-2 py-0.5 text-xs font-normal text-emerald-800">{shareLabel(rubric.id)}</span>}</span>
          <span className={BUTTON_ROW}>
            <button type="button" className="secondary-button w-full justify-center" disabled={!!busy} onClick={() => { setEditing({ id: rubric.id, name: rubric.name }); setRenameTyped(""); }}>Renommer</button>
            {shares && onSharesChanged && <ShareRubricButton schoolId={schoolId} rubric={rubric} shares={shares} onChanged={onSharesChanged} />}
            {rubric.used === false && <button type="button" className="secondary-button w-full justify-center" disabled={!!busy} onClick={() => void run(`delete-${rubric.id}`, () => deleteRubric(schoolId, rubric.id))}>Supprimer</button>}
          </span></>}
    </li>)}</ul>
    {rubrics && !sorted.length && <p className="mt-2 text-slate-600">Aucune rubrique pour cette année. Utilisez « + Ajouter » puis « + Nouvelle rubrique… ».</p>}
  </details>;
}
