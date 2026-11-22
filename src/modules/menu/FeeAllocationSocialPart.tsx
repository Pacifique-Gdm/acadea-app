import { useEffect, useMemo, useRef, useState } from "react";
import { AdminDrawer } from "../../components/ui";
import type { FeeAllocationConfig, FeeAllocationRubric, FeeAllocationSocialVersion, FeeAllocationVersion } from "../../types/feeAllocation";
import { AllocationApiError, loadSocialPart, publishSocialPart, type PublishSocialPart } from "../../services/feeAllocation";
import { sameAllocationRubrics } from "../../../api/_lib/feeAllocationMath.js";
import { socialPartPreview, socialPartRubrics, socialPartTotalText, type SocialPartLine as Line } from "./feeAllocationSocialPartPreview";
import { formatCurrencyMoney } from "../../utils/currency";
import { toMoneyMinor } from "../../utils/money";
import { AllocationActionButton as Action } from "./AllocationActionButton";
import { userFacingError } from "../../utils/userFacingError";
import { ErrorNotice } from "../../components/ui/ErrorNotice";
import { useLoadRetry } from "../../hooks/useLoadRetry";

/** Lot 27c-4 : partie 2 de la répartition, propre aux cas sociaux. */
const valueOf = (rubric: FeeAllocationRubric) => String((rubric.mode === "fixed" ? rubric.fixedMinor ?? 0 : rubric.basisPoints ?? 0) / 100);
/** Toutes les lignes du Tableau 1, pré-remplies ; une rubrique à 0 % dans la partie 2 est une ligne retirée (sa valeur de la partie 1 reste prête pour la remettre). */
const toLines = (partOne: FeeAllocationRubric[], social?: FeeAllocationRubric[]): Line[] => partOne.map((rubric) => {
  const own = social?.find((item) => item.id === rubric.id);
  const removed = own?.mode === "percent" && own.basisPoints === 0;
  const source = own && !removed ? own : rubric;
  return { id: rubric.id, name: rubric.name, mode: source.mode, value: valueOf(source), ...(removed ? { removed: true } : {}) };
});
const message = (cause: unknown) => userFacingError(cause, "Partie 2 indisponible.");
const newId = () => crypto.randomUUID().replaceAll("-", "");
const decimal = /^[0-9]+(?:[.,][0-9]{1,2})?$/;

export function SocialPartEditor({ config, feeName, classLabel, currency, canPublish, onClose, onPublished }: {
  config: FeeAllocationConfig; feeName: string; classLabel: string; currency: "USD" | "CDF"; canPublish: boolean; onClose: () => void; onPublished: () => void;
}) {
  const [partOne, setPartOne] = useState<FeeAllocationVersion | null>(null);
  const [social, setSocial] = useState<FeeAllocationSocialVersion | null>(null);
  const [history, setHistory] = useState<FeeAllocationSocialVersion[]>([]);
  const [paidWithCurrent, setPaidWithCurrent] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [net, setNet] = useState("");
  const [unallocatedRemoved, setUnallocatedRemoved] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [confirming, setConfirming] = useState(false);
  const [errorLoad, setErrorLoad] = useState("");
  const errorLoadRetry = useLoadRetry(Boolean(errorLoad), () => setErrorLoad(""));
  const request = useRef<PublishSocialPart | null>(null);
  useEffect(() => {
    let alive = true;
    void loadSocialPart(config.schoolId, config.feeTypeId).then((result) => {
      if (!alive) return;
      setPartOne(result.partOne); setSocial(result.social); setHistory(result.history); setPaidWithCurrent(result.paidWithCurrent ?? 0);
      if (result.partOne) {
        setLines(toLines(result.partOne.rubrics, result.social?.rubrics)); setUnallocatedRemoved(result.social?.unallocatedRemoved === true);
        setNet(String(result.partOne.feeAmountMinor / 200));
      }
    }).catch((cause) => { if (alive) setErrorLoad(message(cause)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [config.schoolId, config.feeTypeId, errorLoadRetry.token]);
  const entered = useMemo(() => socialPartRubrics(lines, { unallocatedRemoved }), [lines, unallocatedRemoved]);
  const preview = useMemo(() => {
    if (!partOne || entered.error) return { rows: [], error: entered.error };
    try {
      if (!decimal.test(net.trim())) throw new Error("Montant net du cas social invalide.");
      return { rows: socialPartPreview(partOne, entered.rubrics, toMoneyMinor(Number(net.replace(",", ".")))), error: "" };
    } catch (cause) { return { rows: [], error: message(cause) }; }
  }, [partOne, entered, net]);
  const copy = partOne && !entered.error && !unallocatedRemoved && sameAllocationRubrics(partOne.rubrics, entered.rubrics);
  const changed = () => { request.current = null; setConfirming(false); };
  const update = (index: number, changes: Partial<Line>) => { changed(); setLines((rows) => rows.map((row, i) => i === index ? { ...row, ...changes } : row)); };
  async function publish() {
    if (!partOne || busy || (!request.current && (entered.error || preview.error))) return;
    setBusy(true); setError("");
    request.current ??= { feeTypeId: config.feeTypeId, requestId: newId(), expectedPartOneVersionId: partOne.id, expectedSocialVersionId: social?.id ?? null,
      rubrics: entered.rubrics.map(({ id, mode, basisPoints, fixedMinor }) => ({ id, mode, ...(mode === "fixed" ? { fixedMinor } : { basisPoints }) })),
      ...(unallocatedRemoved ? { unallocatedRemoved: true } : {}) };
    try {
      const published = await publishSocialPart(request.current);
      request.current = null; setUncertain(false); setConfirming(false);
      setSocial(published); setPaidWithCurrent(0); setHistory((items) => [published, ...items.filter((item) => item.id !== published.id).map((item) => item.status === "published" ? { ...item, status: "superseded" as const } : item)]);
      setNotice(`Partie 2 publiée (version ${published.version}). Elle s'appliquera aux cas sociaux dont le premier paiement de ce frais arrivera à partir de maintenant.`);
      onPublished();
    } catch (cause) {
      const pending = !(cause instanceof AllocationApiError && cause.confirmedRejection);
      setUncertain(pending); if (!pending) request.current = null; setError(message(cause));
    } finally { setBusy(false); }
  }
  return <AdminDrawer title="Partie 2 — cas sociaux" closeLabel="Fermer la partie 2" width="wide" onClose={() => { if (!busy) onClose(); }}><div className="text-justify" data-justified>
    <p className="mb-2 text-sm font-semibold">{feeName} · {classLabel}</p>
    <p className="mb-3 text-sm text-slate-700">Répartition propre aux élèves qui ont une réduction ou une prise en charge sur ce frais. Les pourcentages s'appliquent à ce que l'élève doit vraiment payer (tarif moins sa réduction). Toutes les lignes de la partie 1 sont reprises : retirez celles qui ne doivent plus rien recevoir des cas sociaux, puis répartissez les pourcentages sur les lignes restantes. Sans partie 2, la partie 1 s'applique.</p>
    {loading && <div aria-hidden className="h-40 animate-pulse rounded bg-slate-100" />}
    {!loading && !partOne && !error && <p role="status" className="text-sm">Publiez d'abord la partie 1 de ce frais.</p>}
    {partOne && <>
      <section className="mb-3 rounded border p-3 text-sm"><h3 className="mb-1 font-semibold">Partie 1 — élèves normalement inscrits (publiée)</h3>
        <ul>{partOne.rubrics.map((rubric) => <li key={rubric.id}>{rubric.name} : {rubric.mode === "fixed" ? formatCurrencyMoney((rubric.fixedMinor ?? 0) / 100, currency) : `${(rubric.basisPoints ?? 0) / 100} %`}</li>)}</ul></section>
      <p className="mb-2 text-sm" role="status">{social ? `Partie 2 en service : version ${social.version}, publiée le ${social.effectiveFrom.slice(0, 10)}${social.copyOfPartOne ? " (identique à la partie 1)" : ""}.` : "Aucune partie 2 publiée : les cas sociaux suivent la partie 1."}</p>
      {social && paidWithCurrent > 0 && <p role="note" className="mb-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Attention : {paidWithCurrent} cas social{paidWithCurrent > 1 ? "aux ont" : " a"} déjà payé ce frais avec la partie 2 en service. Si vous publiez une nouvelle partie 2, leurs paiements déjà répartis ne changent pas ; leurs prochains paiements suivront la nouvelle partie 2 pour le reste de ce qu'ils doivent.</p>}
      <fieldset disabled={!canPublish || busy || uncertain} className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold">Partie 2 — cas sociaux</legend>
        {lines.map((line, index) => line.removed
          ? <div key={line.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-dashed bg-slate-50 p-2" data-removed-line>
            <span className="text-sm"><span className="font-medium line-through">{line.name}</span> — ligne retirée : elle ne reçoit plus rien des cas sociaux.</span>
            <button type="button" className="secondary-button" onClick={() => update(index, { removed: false })}>Remettre la ligne</button></div>
          : <div key={line.id} className="grid gap-2 rounded border p-2 sm:grid-cols-4">
          <span className="self-center text-sm font-medium">{line.name}</span>
          <label className="grid gap-1 text-sm">Mode<select className="input" aria-label={`Mode ${line.name}`} value={line.mode} onChange={(event) => update(index, { mode: event.target.value as Line["mode"] })}><option value="percent">Pourcentage</option><option value="fixed">Montant fixe</option></select></label>
          <label className="grid gap-1 text-sm">{line.mode === "percent" ? "Pourcentage (%)" : `Montant (${currency})`}<input className="input" inputMode="decimal" aria-label={`Valeur ${line.name}`} value={line.value} onChange={(event) => update(index, { value: event.target.value })}/></label>
          <button type="button" className="secondary-button self-end" aria-label={`Retirer la ligne ${line.name}`} onClick={() => update(index, { removed: true })}>Retirer la ligne</button>
        </div>)}
        {unallocatedRemoved
          ? <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-dashed bg-slate-50 p-2" data-removed-line>
            <span className="text-sm"><span className="font-medium line-through">Non affecté</span> — ligne retirée : tout doit aller aux rubriques.</span>
            <button type="button" className="secondary-button" onClick={() => { changed(); setUnallocatedRemoved(false); }}>Remettre la ligne</button></div>
          : <div className="grid gap-2 rounded border p-2 sm:grid-cols-4" data-unallocated-line>
            <span className="self-center text-sm font-medium">Non affecté</span>
            <span className="self-center text-sm sm:col-span-2">Reçoit automatiquement ce qui n'est attribué à aucune rubrique.</span>
            <button type="button" className="secondary-button self-end" aria-label="Retirer la ligne Non affecté" onClick={() => { changed(); setUnallocatedRemoved(true); }}>Retirer la ligne</button></div>}
        {!entered.error && <p className="text-sm" role="status">{socialPartTotalText(entered.percentBasisPoints, entered.hasFixed, unallocatedRemoved)}</p>}
        <button type="button" className="secondary-button justify-self-start" onClick={() => { changed(); setUnallocatedRemoved(false); setLines(toLines(partOne.rubrics)); }}>Recopier la partie 1</button>
      </fieldset>
      <h3 className="mt-4 font-bold">Aperçu en {currency}</h3>
      <label className="my-2 grid max-w-xs gap-1 text-sm">Montant net d'un cas social ({currency}, tarif {formatCurrencyMoney(partOne.feeAmountMinor / 100, currency)})<input className="input" inputMode="decimal" aria-label="Montant net du cas social" value={net} onChange={(event) => setNet(event.target.value)}/></label>
      {preview.error ? <p role="status" className="text-sm text-amber-800">{preview.error}</p>
        : <div className="max-w-full overflow-x-auto"><table className="w-full min-w-[420px] text-sm" aria-label="Aperçu partie 1 et partie 2"><thead><tr><th scope="col" className="border-b p-2 text-left">Rubrique</th><th scope="col" className="border-b p-2 text-left">Élève normal (paie {formatCurrencyMoney(partOne.feeAmountMinor / 100, currency)})</th><th scope="col" className="border-b p-2 text-left">Cas social (paie {formatCurrencyMoney(Number(net.replace(",", ".")), currency)})</th></tr></thead>
          <tbody>{preview.rows.map((row) => <tr key={row.rubricId}><td className="border-b p-2">{row.name}</td><td className="border-b p-2">{formatCurrencyMoney(row.normalMinor / 100, currency)}</td><td className="border-b p-2">{formatCurrencyMoney(row.socialMinor / 100, currency)}</td></tr>)}</tbody></table></div>}
      {copy && <p className="mt-2 text-xs text-slate-600">Identique à la partie 1 : les cas sociaux reçoivent exactement les mêmes montants qu'avec la partie 1.</p>}
      <ErrorNotice error={errorLoad} onRetry={errorLoadRetry.retry} /><ErrorNotice error={error} />
      {notice && <p role="status" className="my-3 text-sm text-emerald-700">{notice}</p>}
      {uncertain && <p className="my-2 text-sm">La publication a peut-être abouti. La vérification renvoie exactement la même demande.</p>}
      {canPublish && (confirming || uncertain ? <div className="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm">
          <p>La partie 2 s'appliquera aux cas sociaux dont le <b>premier paiement</b> de ce frais arrivera après la publication. Un cas social déjà réparti selon une partie 2 précédente suivra celle-ci pour ses prochains paiements. Un cas social déjà réparti selon la partie 1 la garde pour ce frais. Aucun paiement déjà réparti ne change.</p>
          <div className="mt-2 flex flex-wrap gap-2"><button type="button" className="secondary-button" disabled={busy || uncertain} onClick={() => setConfirming(false)}>Revenir</button><Action className="primary-button" busy={busy} onClick={() => void publish()}>{uncertain ? "Vérifier la même demande" : "Confirmer la publication"}</Action></div></div>
        : <div className="mt-4"><button type="button" className="primary-button" disabled={!!entered.error || !!preview.error} onClick={() => setConfirming(true)}>Publier la partie 2</button></div>)}
      {history.length > 0 && <details className="mt-4 text-sm"><summary className="cursor-pointer">Versions de la partie 2</summary><ul className="mt-2 grid gap-1">{history.map((item) => <li key={item.id}>Version {item.version} · {item.status === "published" ? "en service" : "remplacée"} · {item.effectiveFrom.slice(0, 10)}{item.copyOfPartOne ? " · identique à la partie 1" : ""}</li>)}</ul></details>}
    </>}
  </div></AdminDrawer>;
}
