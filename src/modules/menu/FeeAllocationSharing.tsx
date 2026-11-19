import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AdminDrawer } from "../../components/ui";
import { AllocationApiError, revokeShare, setRubricShare, staffRoleLabel, type AllocationShares } from "../../services/feeAllocation";
import { allocationViewers, type Viewer } from "./feeAllocationSharingState";

/** Lot « Deux onglets et partage des rubriques » (maquette validée le 19/11). */
const message = (cause: unknown) => cause instanceof Error ? cause.message : "Partage indisponible.";
/** Phrases à taper exactement (demande du 19/11) : le bouton reste désactivé sinon. */
export const SHARE_PHRASE = "PARTAGER AVEC CE PERSONNEL";
export const REVOKE_PHRASE = "RETIRER CE PARTAGE";
/** Version 1.15.2 : renommer une rubrique exige cette phrase, tapée à la main. */
export const RENAME_PHRASE = "RENOMMER CETTE RUBRIQUE";
/** Seule la frappe au clavier est acceptée : pas de coller, de glisser-déposer ni de remplissage automatique. */
export const HAND_TYPED_INPUTS = new Set(["insertText", "insertCompositionText", "deleteContentBackward", "deleteContentForward", "deleteWordBackward", "deleteWordForward"]);
export function blockNonTyped(event: FormEvent<HTMLInputElement>) {
  const inputType = (event.nativeEvent as InputEvent).inputType;
  if (inputType && !HAND_TYPED_INPUTS.has(inputType)) event.preventDefault();
}

/** Phrase à taper à la main (renommage) : coller et remplissage automatique refusés. */
export function HandTypedPhraseField({ phrase, value, onChange }: { phrase: string; value: string; onChange: (value: string) => void }) {
  return <label className="mt-2 grid gap-1 text-justify text-sm">Pour confirmer, tapez à la main « {phrase} »
    <input className="input" value={value} name={`phrase-${phrase.length}`} autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false} data-lpignore="true" data-1p-ignore="true"
      aria-label={`Tapez à la main « ${phrase} »`} onBeforeInput={blockNonTyped} onPaste={(event) => event.preventDefault()} onDrop={(event) => event.preventDefault()}
      onChange={(event) => onChange(event.target.value)} /></label>;
}
/** Boutons côte à côte à parts égales ; un bouton seul prend toute la largeur. */
export const BUTTON_ROW = "grid w-full min-w-0 auto-cols-fr grid-flow-col gap-2";

function PhraseField({ phrase, value, onChange }: { phrase: string; value: string; onChange: (value: string) => void }) {
  return <label className="mt-3 grid gap-1 text-sm">Pour confirmer, tapez exactement « {phrase} »
    <input className="input" value={value} onChange={(event) => onChange(event.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} aria-label={`Tapez exactement « ${phrase} »`} /></label>;
}

/** Petite fenêtre : à côté du bouton cliqué sur ordinateur, par le bas de l'écran sur téléphone (même contenu). */
export function SidePopover({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", close); box.current?.focus();
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);
  return <>
    <div className="fixed inset-0 z-40 bg-black/20 sm:hidden" aria-hidden onClick={onClose} />
    <div ref={box} tabIndex={-1} role="dialog" aria-label={title}
      className="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-2xl border border-slate-300 bg-white p-4 text-sm shadow-lg outline-none sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-1 sm:w-80 sm:max-h-none sm:rounded-xl">
      <p className="mb-2 font-semibold">{title}</p>
      {children}
    </div>
  </>;
}

/** Bouton « Partager » d'une rubrique : tout le personnel, ou des personnes au choix (avec espace Acadéa). */
export function ShareRubricButton({ schoolId, rubric, shares, onChanged }: { schoolId: string; rubric: { id: string; name: string }; shares: AllocationShares; onChanged: (next: AllocationShares) => void }) {
  const rule = shares.rubrics[rubric.id];
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"all" | "some">(rule?.all ? "all" : "some");
  const [chosen, setChosen] = useState<string[]>(rule?.all ? [] : rule?.userIds ?? []);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [typed, setTyped] = useState("");
  const begin = () => { setMode(rule?.all ? "all" : "some"); setChosen(rule?.all ? [] : rule?.userIds ?? []); setError(""); setTyped(""); setOpen(true); };
  async function save() {
    if (busy || typed !== SHARE_PHRASE) return;
    setBusy(true); setError("");
    try {
      const next = await setRubricShare(schoolId, shares.revision, rubric.id, mode === "all", mode === "all" ? [] : chosen);
      onChanged({ ...shares, revision: next.revision, rubrics: next.rubrics }); setOpen(false);
    } catch (cause) { setError(cause instanceof AllocationApiError && cause.status === 409 ? "Le partage a changé entre-temps. Fermez puis rouvrez pour voir la dernière version." : message(cause)); }
    finally { setBusy(false); }
  }
  // Version 1.15.2 : le partage se fait dans un drawer à part, avec la croix pour revenir.
  return <span className="relative block min-w-0">
    <button type="button" className="secondary-button w-full justify-center" aria-expanded={open} onClick={() => open ? setOpen(false) : begin()}>Partager</button>
    {open && <AdminDrawer title={`Partager « ${rubric.name} »`} closeLabel="Fermer le partage" onClose={() => { if (!busy) setOpen(false); }}>
      <div className="grid gap-1 text-justify text-sm"><p className="mb-2 font-semibold">Avec qui partager cette rubrique ?</p>
      <label className="flex items-start gap-2 py-1"><input type="radio" name={`mode-${rubric.id}`} checked={mode === "all"} onChange={() => setMode("all")} />Tout le personnel (y compris celui ajouté plus tard)</label>
      <label className="flex items-start gap-2 py-1"><input type="radio" name={`mode-${rubric.id}`} checked={mode === "some"} onChange={() => setMode("some")} />Des personnes au choix :</label>
      {mode === "some" && <fieldset className="ml-6 grid gap-1" aria-label="Personnes au choix">
        {shares.staff.map((person) => <label key={person.id} className="flex items-start gap-2 py-0.5">
          <input type="checkbox" checked={chosen.includes(person.id)} onChange={(event) => setChosen((items) => event.target.checked ? [...items, person.id] : items.filter((id) => id !== person.id))} />
          <span>{person.name} — {staffRoleLabel(person.role)}</span></label>)}
        {!shares.staff.length && <p className="text-slate-600">Aucun membre du personnel n'a encore d'espace Acadéa.</p>}
      </fieldset>}
      <p className="mt-2 text-xs text-slate-600">Seul le personnel qui a un espace Acadéa est proposé. Ne rien cocher retire le partage de cette rubrique.</p>
      <PhraseField phrase={SHARE_PHRASE} value={typed} onChange={setTyped} />
      {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
      <div className={`mt-3 ${BUTTON_ROW}`}><button type="button" className="secondary-button w-full justify-center" onClick={() => setOpen(false)}>Annuler</button>
        <button type="button" className="primary-button w-full justify-center" disabled={busy || typed !== SHARE_PHRASE} onClick={() => void save()}>{busy ? "Enregistrement…" : "Partager"}</button></div>
      </div>
    </AdminDrawer>}
  </span>;
}

/** Onglet « Partage répartition » : la liste du personnel qui voit quelque chose, avec le retrait. */
export function SharingTab({ schoolId, shares, error, names, onChanged }: { schoolId: string; shares: AllocationShares | null; error: string; names: Map<string, string>; onChanged: (next: AllocationShares) => void }) {
  const [revoking, setRevoking] = useState<string | null>(null);
  const [whole, setWhole] = useState(true), [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState(""), [typed, setTyped] = useState("");
  if (error) return <p role="alert" className="text-sm text-red-700">{error}</p>;
  if (!shares) return <div aria-hidden className="h-32 animate-pulse rounded bg-slate-100" />;
  const viewers = allocationViewers(shares, names);
  async function revoke(viewer: Viewer) {
    if (busy || (!whole && !picked.length) || typed !== REVOKE_PHRASE) return;
    setBusy(true); setFailure("");
    try {
      const next = await revokeShare(schoolId, shares!.revision, viewer.id, whole ? null : picked);
      onChanged({ ...shares!, revision: next.revision, rubrics: next.rubrics }); setRevoking(null);
    } catch (cause) { setFailure(message(cause)); } finally { setBusy(false); }
  }
  return <div className="grid gap-2 text-sm">
    {!viewers.length && <p role="status" className="text-slate-600">Aucune rubrique n'est partagée. Utilisez « Partager » dans « Rubriques de l'année ».</p>}
    {viewers.map((viewer) => <div key={viewer.id} className="relative grid gap-2 rounded border p-3">
      <span><b>{viewer.label}</b>{viewer.detail && ` · ${viewer.detail}`}<br /><span className="text-slate-600">{viewer.rubricIds.map((id) => names.get(id) ?? "Rubrique").join(", ")}</span></span>
      <span className="relative block"><button type="button" className="secondary-button w-full justify-center" aria-expanded={revoking === viewer.id} onClick={() => { setRevoking(revoking === viewer.id ? null : viewer.id); setWhole(true); setPicked([]); setFailure(""); setTyped(""); }}>Retirer…</button>
        {revoking === viewer.id && <SidePopover title={`Retirer à ${viewer.label}`} onClose={() => setRevoking(null)}>
          <label className="flex items-start gap-2 py-1"><input type="radio" name={`retrait-${viewer.id}`} checked={whole} onChange={() => setWhole(true)} />Tout le drawer</label>
          <label className="flex items-start gap-2 py-1"><input type="radio" name={`retrait-${viewer.id}`} checked={!whole} onChange={() => setWhole(false)} />Des rubriques au choix :</label>
          {!whole && <fieldset className="ml-6 grid gap-1" aria-label="Rubriques à retirer">{viewer.rubricIds.map((id) => <label key={id} className="flex items-start gap-2">
            <input type="checkbox" checked={picked.includes(id)} onChange={(event) => setPicked((items) => event.target.checked ? [...items, id] : items.filter((x) => x !== id))} />{names.get(id) ?? "Rubrique"}</label>)}</fieldset>}
          <PhraseField phrase={REVOKE_PHRASE} value={typed} onChange={setTyped} />
          {failure && <p role="alert" className="mt-2 text-red-700">{failure}</p>}
          <div className={`mt-3 ${BUTTON_ROW}`}><button type="button" className="secondary-button w-full justify-center" onClick={() => setRevoking(null)}>Annuler</button>
            <button type="button" className="primary-button w-full justify-center" disabled={busy || (!whole && !picked.length) || typed !== REVOKE_PHRASE} onClick={() => void revoke(viewer)}>{busy ? "Retrait…" : "Retirer"}</button></div>
        </SidePopover>}</span>
    </div>)}
    <p className="text-xs text-slate-600">S'il ne reste aucune rubrique partagée avec une personne, le drawer disparaît de son Menu.</p>
  </div>;
}
