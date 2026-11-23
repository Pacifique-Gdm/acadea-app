import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AdminDrawer } from "../../components/ui";
import type { FeeAllocationRubric } from "../../types/feeAllocation";
import { AllocationApiError, loadSocialParts, publishSocialParts, type PublishSocialParts, type SocialPartItem } from "../../services/feeAllocation";
import { sameAllocationRubrics } from "../../../api/_lib/feeAllocationMath.js";
import { applySocialLinesToAll, sameSocialLines, socialPartLines, socialPartPreview, socialPartRubrics, socialPartTotalText, type SocialPartLine as Line } from "./feeAllocationSocialPartPreview";
import { formatCurrencyMoney } from "../../utils/currency";
import { toMoneyMinor } from "../../utils/money";
import { allocationClassLabel } from "../../utils/feeAllocationView";
import { AllocationActionButton as Action } from "./AllocationActionButton";
import { userFacingError } from "../../utils/userFacingError";
import { ErrorNotice } from "../../components/ui/ErrorNotice";
import { useLoadRetry } from "../../hooks/useLoadRetry";

/** Phrase tapée par l'Administrateur pour publier une partie 2 (identique au serveur). */
export const SOCIAL_PUBLISH_PHRASE = "PUBLIER LA PARTIE DEUX";
const message = (cause: unknown) => userFacingError(cause, "Partie 2 indisponible.");
const newId = () => crypto.randomUUID().replaceAll("-", "");
const decimal = /^[0-9]+(?:[.,][0-9]{1,2})?$/;
const feeLabel = (item: Pick<SocialPartItem, "feeName" | "className" | "classOptionKey">) => `${item.feeName} · ${allocationClassLabel(item.classOptionKey || item.className || "")}`;
const toInput = (rubrics: FeeAllocationRubric[]) => rubrics.map(({ id, mode, basisPoints, fixedMinor }) => ({ id, mode, ...(mode === "fixed" ? { fixedMinor } : { basisPoints }) }));

/** Champ de la phrase de confirmation : tapée à la main (pas de coller, pas de glisser, pas de remplissage automatique). */
export function TypedConfirmation({ value, onChange, disabled, label = `Pour publier, tapez vous-même « ${SOCIAL_PUBLISH_PHRASE} »` }: { value: string; onChange: (value: string) => void; disabled?: boolean; label?: string }) {
  const block = (event: { preventDefault: () => void }) => event.preventDefault();
  // Nom changeant pour que le navigateur ne propose jamais de remplissage automatique.
  const [name] = useState(() => `confirmation-partie-2-${newId()}`);
  return <label className="grid gap-1 text-sm">{label}
    <input className="input" value={value} disabled={disabled} aria-label="Phrase de confirmation de la partie 2" autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false}
      name={name} data-typed-confirmation onPaste={block} onDrop={block} onDragOver={block} onContextMenu={block}
      onChange={(event) => { const native = event.nativeEvent as InputEvent; if (native?.inputType === "insertFromPaste" || native?.inputType === "insertFromDrop" || native?.inputType === "insertReplacementText") return; onChange(event.target.value); }} />
    {value && value !== SOCIAL_PUBLISH_PHRASE && <span className="text-xs text-amber-800">La phrase n'est pas encore exacte.</span>}
  </label>;
}

/** Lignes de la partie 2 (cas sociaux) : rubriques de la partie 1, « Retirer la ligne » / « Remettre la ligne », « Non affecté » automatique.
 * Version 1.19.1 : « Retirer la ligne » sur la même ligne que le pourcentage ; « Recopier… » et un second bouton éventuel, moitié-moitié. */
export function SocialLinesEditor({ lines, currency, disabled, onChange, onCopyPartOne, copyLabel = "Recopier la partie 1", secondAction }: {
  lines: Line[]; currency: "USD" | "CDF"; disabled?: boolean; onChange: (lines: Line[]) => void; onCopyPartOne: () => void; copyLabel?: string; secondAction?: ReactNode;
}) {
  const entered = socialPartRubrics(lines);
  const update = (index: number, changes: Partial<Line>) => onChange(lines.map((row, i) => i === index ? { ...row, ...changes } : row));
  return <fieldset disabled={disabled} className="grid gap-2">
    {lines.map((line, index) => line.removed
      ? <div key={line.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-dashed bg-slate-50 p-2" data-removed-line>
        <span className="text-sm"><span className="font-medium line-through">{line.name}</span> — ligne retirée : elle ne reçoit plus rien des cas sociaux.</span>
        <button type="button" className="secondary-button" onClick={() => update(index, { removed: false })}>Remettre la ligne</button></div>
      : <div key={line.id} className="grid gap-2 rounded border p-2 sm:grid-cols-4">
        <span className="self-center text-sm font-medium">{line.name}</span>
        <label className="grid gap-1 text-sm">Mode<select className="input" aria-label={`Mode ${line.name}`} value={line.mode} onChange={(event) => update(index, { mode: event.target.value as Line["mode"] })}><option value="percent">Pourcentage</option><option value="fixed">Montant fixe</option></select></label>
        <div className="grid min-w-0 gap-1 text-sm sm:col-span-2" data-value-row><label htmlFor={`valeur-${line.id}`}>{line.mode === "percent" ? "Pourcentage (%)" : `Montant (${currency})`}</label>
          <div className="flex min-w-0 items-stretch gap-2"><input id={`valeur-${line.id}`} className="input min-w-0 flex-1" inputMode="decimal" aria-label={`Valeur ${line.name}`} value={line.value} onChange={(event) => update(index, { value: event.target.value })}/>
            <button type="button" className="secondary-button shrink-0 px-3" aria-label={`Retirer la ligne ${line.name}`} onClick={() => update(index, { removed: true })}>Retirer la ligne</button></div></div>
      </div>)}
    {/* « Non affecté » ne se retire pas : il reçoit toujours le reste, automatiquement. */}
    <div className="grid gap-2 rounded border bg-slate-50 p-2 sm:grid-cols-4" data-unallocated-line>
      <span className="self-center text-sm font-medium">Non affecté</span>
      <span className="self-center text-sm sm:col-span-3">Reçoit automatiquement le reste : ce qui n'est attribué à aucune rubrique.</span></div>
    {entered.error ? <p role="status" className="text-sm text-amber-800">{entered.error}</p>
      : <p className="text-sm" role="status">{socialPartTotalText(entered.percentBasisPoints, entered.hasFixed)}</p>}
    <div className={`grid min-w-0 gap-2 ${secondAction ? "grid-cols-2" : "grid-cols-1"}`} data-copy-actions>
      <button type="button" className="secondary-button w-full whitespace-normal px-2 text-center" onClick={onCopyPartOne}>{copyLabel}</button>{secondAction}</div>
  </fieldset>;
}

/** Version 1.19.0 : une partie 2 par frais, mais un seul formulaire pour tous les frais répartis au Tableau 1. */
export function SocialPartEditor({ schoolId, initialFeeTypeId, currency, canPublish, onClose, onPublished }: {
  schoolId: string; initialFeeTypeId: string; currency: "USD" | "CDF"; canPublish: boolean; onClose: () => void; onPublished: () => void;
}) {
  const [items, setItems] = useState<SocialPartItem[]>([]);
  const [selected, setSelected] = useState(initialFeeTypeId);
  /** Réglages de chaque frais, gardés quand on change de frais dans la liste. */
  const [drafts, setDrafts] = useState<Record<string, Line[]>>({});
  const [nets, setNets] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState<{ feeLabel: string; names: string[] }[]>([]);
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [errorLoad, setErrorLoad] = useState("");
  const errorLoadRetry = useLoadRetry(Boolean(errorLoad), () => setErrorLoad(""));
  const request = useRef<PublishSocialParts | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    void loadSocialParts(schoolId).then((result) => {
      if (!alive) return;
      setItems(result);
      setDrafts(Object.fromEntries(result.map((item) => [item.feeTypeId, socialPartLines(item.partOne.rubrics, item.social?.rubrics)])));
      setNets(Object.fromEntries(result.map((item) => [item.feeTypeId, String(item.partOne.feeAmountMinor / 200)])));
      setSelected((current) => result.some((item) => item.feeTypeId === current) ? current : result[0]?.feeTypeId ?? "");
    }).catch((cause) => { if (alive) setErrorLoad(message(cause)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [schoolId, errorLoadRetry.token, reload]);
  const saved = useMemo(() => new Map(items.map((item) => [item.feeTypeId, socialPartLines(item.partOne.rubrics, item.social?.rubrics)])), [items]);
  const modified = useMemo(() => items.filter((item) => drafts[item.feeTypeId] && !sameSocialLines(drafts[item.feeTypeId], saved.get(item.feeTypeId) ?? [])), [items, drafts, saved]);
  const item = items.find((entry) => entry.feeTypeId === selected) ?? null;
  const lines = useMemo(() => item ? drafts[item.feeTypeId] ?? [] : [], [item, drafts]);
  const entered = useMemo(() => socialPartRubrics(lines), [lines]);
  const net = item ? nets[item.feeTypeId] ?? "" : "";
  const preview = useMemo(() => {
    if (!item || entered.error) return { rows: [], error: entered.error };
    try {
      if (!decimal.test(net.trim())) throw new Error("Montant net du cas social invalide.");
      return { rows: socialPartPreview(item.partOne, entered.rubrics, toMoneyMinor(Number(net.replace(",", ".")))), error: "" };
    } catch (cause) { return { rows: [], error: message(cause) }; }
  }, [item, entered, net]);
  // Les frais modifiés qui ont une erreur bloquent la publication (on les nomme).
  const invalid = modified.filter((entry) => socialPartRubrics(drafts[entry.feeTypeId]).error);
  const changed = () => { request.current = null; setNotice(""); };
  const setLines = (feeTypeId: string, next: Line[]) => { changed(); setDrafts((all) => ({ ...all, [feeTypeId]: next })); };
  function applyToAll() {
    if (!item) return;
    changed();
    const others = items.filter((entry) => entry.feeTypeId !== item.feeTypeId).map((entry) => ({ feeTypeId: entry.feeTypeId, lines: drafts[entry.feeTypeId] ?? [] }));
    const result = applySocialLinesToAll(lines, others);
    setDrafts((all) => ({ ...all, ...Object.fromEntries(result.map((row) => [row.feeTypeId, row.lines])) }));
    setMissing(result.filter((row) => row.missing.length).map((row) => ({ feeLabel: feeLabel(items.find((entry) => entry.feeTypeId === row.feeTypeId)!), names: row.missing })));
    setNotice(`Réglages de « ${feeLabel(item)} » recopiés sur ${others.length} autre${others.length > 1 ? "s" : ""} frais, rubrique par rubrique.`);
  }
  async function publish() {
    if (busy || (!request.current && (!modified.length || invalid.length || confirmation !== SOCIAL_PUBLISH_PHRASE))) return;
    setBusy(true); setError("");
    request.current ??= { requestId: newId(), confirmation, items: modified.map((entry) => ({ feeTypeId: entry.feeTypeId, expectedPartOneVersionId: entry.partOne.id,
      expectedSocialVersionId: entry.social?.id ?? null, rubrics: toInput(socialPartRubrics(drafts[entry.feeTypeId]).rubrics) })) };
    try {
      const published = await publishSocialParts(request.current);
      request.current = null; setUncertain(false); setConfirmation(""); setMissing([]);
      setNotice(`Partie 2 publiée pour ${published.length} frais. Elle s'applique aux prochains paiements des cas sociaux ; les paiements déjà répartis ne changent pas.`);
      setReload((n) => n + 1); onPublished();
    } catch (cause) {
      const pending = !(cause instanceof AllocationApiError && cause.confirmedRejection);
      setUncertain(pending); if (!pending) request.current = null; setError(message(cause));
    } finally { setBusy(false); }
  }
  const locked = !canPublish || busy || uncertain;
  const ready = !!modified.length && !invalid.length && confirmation === SOCIAL_PUBLISH_PHRASE;
  return <AdminDrawer title="Partie 2 — cas sociaux" closeLabel="Fermer la partie 2" width="wide" onClose={() => { if (!busy) onClose(); }}><div className="text-justify" data-justified>
    {loading && <div aria-hidden className="h-40 animate-pulse rounded bg-slate-100" />}
    <ErrorNotice error={errorLoad} onRetry={errorLoadRetry.retry} />
    {!loading && !errorLoad && !items.length && <p role="status" className="text-sm">Publiez d'abord la partie 1 d'au moins un frais.</p>}
    {item && <>
      <label className="mb-2 grid gap-1 text-sm font-semibold">Frais
        <select className="input" aria-label="Frais de la partie 2" value={selected} disabled={busy} onChange={(event) => setSelected(event.target.value)}>
          {items.map((entry) => <option key={entry.feeTypeId} value={entry.feeTypeId}>{feeLabel(entry)}{modified.some((m) => m.feeTypeId === entry.feeTypeId) ? " — modifié" : ""}</option>)}
        </select></label>
      {modified.length > 0 && <p className="mb-2 text-sm" role="status" data-modified-fees>Frais modifiés, pas encore publiés : {modified.map(feeLabel).join(", ")}.</p>}
      <p className="mb-3 text-sm text-slate-700">Répartition propre aux élèves qui ont une réduction ou une prise en charge sur ce frais. Les pourcentages s'appliquent à ce que l'élève paie vraiment (tarif moins sa réduction). Le total peut être inférieur à 100 % : le reste va automatiquement dans « Non affecté ». Sans partie 2, la partie 1 s'applique.</p>
      <section className="mb-3 rounded border p-3 text-sm"><h3 className="mb-1 font-semibold">Partie 1 — élèves normalement inscrits (publiée)</h3>
        <ul>{item.partOne.rubrics.map((rubric) => <li key={rubric.id}>{rubric.name} : {rubric.mode === "fixed" ? formatCurrencyMoney((rubric.fixedMinor ?? 0) / 100, currency) : `${(rubric.basisPoints ?? 0) / 100} %`}</li>)}</ul></section>
      <p className="mb-2 text-sm" role="status">{item.social ? `Partie 2 en service : version ${item.social.version}, publiée le ${item.social.effectiveFrom.slice(0, 10)}${item.social.copyOfPartOne ? " (identique à la partie 1)" : ""}.` : "Aucune partie 2 publiée pour ce frais : les cas sociaux suivent la partie 1."}</p>
      {item.social && item.paidWithCurrent > 0 && <p role="note" className="mb-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Attention : {item.paidWithCurrent} cas social{item.paidWithCurrent > 1 ? "aux ont" : " a"} déjà payé ce frais avec la partie 2 en service. Leurs paiements déjà répartis ne changent pas ; leurs prochains paiements suivront la nouvelle partie 2 pour le reste de ce qu'ils doivent.</p>}
      <h3 className="mb-1 text-sm font-semibold">Partie 2 — cas sociaux · {feeLabel(item)}</h3>
      <SocialLinesEditor lines={lines} currency={currency} disabled={locked} onChange={(next) => setLines(item.feeTypeId, next)}
        onCopyPartOne={() => setLines(item.feeTypeId, socialPartLines(item.partOne.rubrics))}
        secondAction={items.length > 1 && <button type="button" className="secondary-button w-full whitespace-normal px-2 text-center" disabled={locked || !!entered.error} onClick={applyToAll}>Appliquer à tous les frais</button>} />
      {missing.length > 0 && <div role="note" className="mt-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-missing-rubrics>
        <p className="font-semibold">Rubriques absentes de certains frais : leur part ira dans « Non affecté ».</p>
        <ul className="mt-1 list-disc pl-5">{missing.map((row) => <li key={row.feeLabel}>« {row.feeLabel} » n'a pas {row.names.length > 1 ? "les rubriques" : "la rubrique"} {row.names.map((name) => `« ${name} »`).join(", ")}.</li>)}</ul></div>}
      <h3 className="mt-4 font-bold">Aperçu en {currency}</h3>
      <label className="my-2 grid max-w-xs gap-1 text-sm">Montant net d'un cas social ({currency}, tarif {formatCurrencyMoney(item.partOne.feeAmountMinor / 100, currency)})<input className="input" inputMode="decimal" aria-label="Montant net du cas social" value={net} onChange={(event) => setNets((all) => ({ ...all, [item.feeTypeId]: event.target.value }))}/></label>
      {preview.error ? <p role="status" className="text-sm text-amber-800">{preview.error}</p>
        : <div className="max-w-full overflow-x-auto"><table className="w-full min-w-[420px] text-sm" aria-label="Aperçu partie 1 et partie 2"><thead><tr><th scope="col" className="border-b p-2 text-left">Rubrique</th><th scope="col" className="border-b p-2 text-left">Élève normal (paie {formatCurrencyMoney(item.partOne.feeAmountMinor / 100, currency)})</th><th scope="col" className="border-b p-2 text-left">Cas social (paie {formatCurrencyMoney(Number(net.replace(",", ".")), currency)})</th></tr></thead>
          <tbody>{preview.rows.map((row) => <tr key={row.rubricId}><td className="border-b p-2">{row.name}</td><td className="border-b p-2">{formatCurrencyMoney(row.normalMinor / 100, currency)}</td><td className="border-b p-2">{formatCurrencyMoney(row.socialMinor / 100, currency)}</td></tr>)}</tbody></table></div>}
      {!entered.error && sameAllocationRubrics(item.partOne.rubrics, entered.rubrics) && <p className="mt-2 text-xs text-slate-600">Identique à la partie 1 : les cas sociaux reçoivent exactement les mêmes montants qu'avec la partie 1.</p>}
    </>}
    <ErrorNotice error={error} />
    {notice && <p role="status" className="my-3 text-sm text-emerald-700">{notice}</p>}
    {uncertain && <p className="my-2 text-sm">La publication a peut-être abouti. La vérification renvoie exactement la même demande.</p>}
    {canPublish && items.length > 0 && <div className="mt-4 grid gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm" data-social-publish>
      <p>La partie 2 s'appliquera aux paiements des cas sociaux arrivés après la publication, y compris à ceux qui ont déjà payé une partie de ce frais. Aucun paiement déjà réparti ne change. {modified.length ? `${modified.length} frais modifié${modified.length > 1 ? "s" : ""} ser${modified.length > 1 ? "ont" : "a"} publié${modified.length > 1 ? "s" : ""} en une seule fois.` : "Aucun frais modifié pour l'instant."}</p>
      {invalid.length > 0 && <p role="alert" className="text-amber-900">À corriger avant de publier : {invalid.map(feeLabel).join(", ")}.</p>}
      <TypedConfirmation value={confirmation} onChange={(value) => { request.current = null; setConfirmation(value); }} disabled={busy || uncertain} />
      {/* Version 1.19.1 : « Annuler » (ferme sans rien publier) et « Publier la partie 2 », moitié-moitié. */}
      <div className="grid w-full grid-cols-2 gap-2" data-social-publish-actions>
        <button type="button" className="secondary-button min-h-11 w-full px-2" disabled={busy} onClick={onClose}>Annuler</button>
        <Action className="primary-button w-full min-w-0 justify-items-center px-2 text-xs sm:text-sm" busy={busy} disabled={!uncertain && !ready} onClick={() => void publish()}>{uncertain ? "Vérifier la même demande" : "Publier la partie 2"}</Action></div>
    </div>}
  </div></AdminDrawer>;
}
