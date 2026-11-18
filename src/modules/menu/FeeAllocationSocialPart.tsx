import { useEffect, useMemo, useRef, useState } from "react";
import { AdminDrawer } from "../../components/ui";
import type { FeeAllocationConfig, FeeAllocationRubric, FeeAllocationSocialVersion, FeeAllocationVersion } from "../../types/feeAllocation";
import { AllocationApiError, loadSocialPart, publishSocialPart, type PublishSocialPart } from "../../services/feeAllocation";
import { sameAllocationRubrics } from "../../../api/_lib/feeAllocationMath.js";
import { socialPartPreview, socialPartRubrics, type SocialPartLine as Line } from "./feeAllocationSocialPartPreview";
import { formatCurrencyMoney } from "../../utils/currency";
import { toMoneyMinor } from "../../utils/money";
import { AllocationActionButton as Action } from "./AllocationActionButton";

/** Lot 27c-4 : partie 2 de la répartition, propre aux cas sociaux. */
const toLines = (rubrics: FeeAllocationRubric[]): Line[] => rubrics.map((rubric) => ({ id: rubric.id, name: rubric.name, mode: rubric.mode,
  value: String((rubric.mode === "fixed" ? rubric.fixedMinor ?? 0 : rubric.basisPoints ?? 0) / 100) }));
const message = (cause: unknown) => cause instanceof Error ? cause.message : "Partie 2 indisponible.";
const newId = () => crypto.randomUUID().replaceAll("-", "");
const decimal = /^[0-9]+(?:[.,][0-9]{1,2})?$/;

export function SocialPartEditor({ config, feeName, classLabel, currency, canPublish, onClose, onPublished }: {
  config: FeeAllocationConfig; feeName: string; classLabel: string; currency: "USD" | "CDF"; canPublish: boolean; onClose: () => void; onPublished: () => void;
}) {
  const [partOne, setPartOne] = useState<FeeAllocationVersion | null>(null);
  const [social, setSocial] = useState<FeeAllocationSocialVersion | null>(null);
  const [history, setHistory] = useState<FeeAllocationSocialVersion[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [net, setNet] = useState("");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [confirming, setConfirming] = useState(false);
  const request = useRef<PublishSocialPart | null>(null);
  useEffect(() => {
    let alive = true;
    void loadSocialPart(config.schoolId, config.feeTypeId).then((result) => {
      if (!alive) return;
      setPartOne(result.partOne); setSocial(result.social); setHistory(result.history);
      if (result.partOne) {
        setLines(toLines(result.social?.rubrics ?? result.partOne.rubrics));
        setNet(String(result.partOne.feeAmountMinor / 200));
      }
    }).catch((cause) => { if (alive) setError(message(cause)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [config.schoolId, config.feeTypeId]);
  const entered = useMemo(() => socialPartRubrics(lines), [lines]);
  const preview = useMemo(() => {
    if (!partOne || entered.error) return { rows: [], error: entered.error };
    try {
      if (!decimal.test(net.trim())) throw new Error("Montant net du cas social invalide.");
      return { rows: socialPartPreview(partOne, entered.rubrics, toMoneyMinor(Number(net.replace(",", ".")))), error: "" };
    } catch (cause) { return { rows: [], error: message(cause) }; }
  }, [partOne, entered, net]);
  const copy = partOne && !entered.error && sameAllocationRubrics(partOne.rubrics, entered.rubrics);
  const update = (index: number, changes: Partial<Line>) => { request.current = null; setConfirming(false); setLines((rows) => rows.map((row, i) => i === index ? { ...row, ...changes } : row)); };
  async function publish() {
    if (!partOne || busy || (!request.current && (entered.error || preview.error))) return;
    setBusy(true); setError("");
    request.current ??= { feeTypeId: config.feeTypeId, requestId: newId(), expectedPartOneVersionId: partOne.id, expectedSocialVersionId: social?.id ?? null,
      rubrics: entered.rubrics.map(({ id, mode, basisPoints, fixedMinor }) => ({ id, mode, ...(mode === "fixed" ? { fixedMinor } : { basisPoints }) })) };
    try {
      const published = await publishSocialPart(request.current);
      request.current = null; setUncertain(false); setConfirming(false);
      setSocial(published); setHistory((items) => [published, ...items.filter((item) => item.id !== published.id).map((item) => item.status === "published" ? { ...item, status: "superseded" as const } : item)]);
      setNotice(`Partie 2 publiée (version ${published.version}). Elle s'appliquera aux cas sociaux dont le premier paiement de ce frais arrivera à partir de maintenant.`);
      onPublished();
    } catch (cause) {
      const pending = !(cause instanceof AllocationApiError && cause.confirmedRejection);
      setUncertain(pending); if (!pending) request.current = null; setError(message(cause));
    } finally { setBusy(false); }
  }
  return <AdminDrawer title="Partie 2 — cas sociaux" closeLabel="Fermer la partie 2" width="wide" onClose={() => { if (!busy) onClose(); }}>
    <p className="mb-2 text-sm font-semibold">{feeName} · {classLabel}</p>
    <p className="mb-3 text-sm text-slate-700">Répartition propre aux élèves qui ont une réduction ou une prise en charge sur ce frais. Les pourcentages s'appliquent à ce que l'élève doit vraiment payer (tarif moins sa réduction). Sans partie 2, la partie 1 s'applique.</p>
    {loading && <div aria-hidden className="h-40 animate-pulse rounded bg-slate-100" />}
    {!loading && !partOne && !error && <p role="status" className="text-sm">Publiez d'abord la partie 1 de ce frais.</p>}
    {partOne && <>
      <section className="mb-3 rounded border p-3 text-sm"><h3 className="mb-1 font-semibold">Partie 1 — élèves normalement inscrits (publiée)</h3>
        <ul>{partOne.rubrics.map((rubric) => <li key={rubric.id}>{rubric.name} : {rubric.mode === "fixed" ? formatCurrencyMoney((rubric.fixedMinor ?? 0) / 100, currency) : `${(rubric.basisPoints ?? 0) / 100} %`}</li>)}</ul></section>
      <p className="mb-2 text-sm" role="status">{social ? `Partie 2 en service : version ${social.version}, publiée le ${social.effectiveFrom.slice(0, 10)}${social.copyOfPartOne ? " (identique à la partie 1)" : ""}.` : "Aucune partie 2 publiée : les cas sociaux suivent la partie 1."}</p>
      <fieldset disabled={!canPublish || busy || uncertain} className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold">Partie 2 — cas sociaux</legend>
        {lines.map((line, index) => <div key={line.id} className="grid gap-2 rounded border p-2 sm:grid-cols-3">
          <span className="self-center text-sm font-medium">{line.name}</span>
          <label className="grid gap-1 text-sm">Mode<select className="input" aria-label={`Mode ${line.name}`} value={line.mode} onChange={(event) => update(index, { mode: event.target.value as Line["mode"] })}><option value="percent">Pourcentage</option><option value="fixed">Montant fixe</option></select></label>
          <label className="grid gap-1 text-sm">{line.mode === "percent" ? "Pourcentage (%)" : `Montant (${currency})`}<input className="input" inputMode="decimal" aria-label={`Valeur ${line.name}`} value={line.value} onChange={(event) => update(index, { value: event.target.value })}/></label>
        </div>)}
        <button type="button" className="secondary-button justify-self-start" onClick={() => { request.current = null; setConfirming(false); setLines(toLines(partOne.rubrics)); }}>Recopier la partie 1</button>
      </fieldset>
      <h3 className="mt-4 font-bold">Aperçu en {currency}</h3>
      <label className="my-2 grid max-w-xs gap-1 text-sm">Montant net d'un cas social ({currency}, tarif {formatCurrencyMoney(partOne.feeAmountMinor / 100, currency)})<input className="input" inputMode="decimal" aria-label="Montant net du cas social" value={net} onChange={(event) => setNet(event.target.value)}/></label>
      {preview.error ? <p role="status" className="text-sm text-amber-800">{preview.error}</p>
        : <div className="max-w-full overflow-x-auto"><table className="w-full min-w-[420px] text-sm" aria-label="Aperçu partie 1 et partie 2"><thead><tr><th scope="col" className="border-b p-2 text-left">Rubrique</th><th scope="col" className="border-b p-2 text-left">Élève normal (paie {formatCurrencyMoney(partOne.feeAmountMinor / 100, currency)})</th><th scope="col" className="border-b p-2 text-left">Cas social (paie {formatCurrencyMoney(Number(net.replace(",", ".")), currency)})</th></tr></thead>
          <tbody>{preview.rows.map((row) => <tr key={row.rubricId}><td className="border-b p-2">{row.name}</td><td className="border-b p-2">{formatCurrencyMoney(row.normalMinor / 100, currency)}</td><td className="border-b p-2">{formatCurrencyMoney(row.socialMinor / 100, currency)}</td></tr>)}</tbody></table></div>}
      {copy && <p className="mt-2 text-xs text-slate-600">Identique à la partie 1 : les cas sociaux reçoivent exactement les mêmes montants qu'avec la partie 1.</p>}
      {error && <p role="alert" className="my-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="my-3 text-sm text-emerald-700">{notice}</p>}
      {uncertain && <p className="my-2 text-sm">La publication a peut-être abouti. La vérification renvoie exactement la même demande.</p>}
      {canPublish && (confirming || uncertain ? <div className="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm">
          <p>La partie 2 s'appliquera aux cas sociaux dont le <b>premier paiement</b> de ce frais arrivera après la publication. Un cas social dont un paiement de ce frais a déjà été réparti garde la partie 1 pour tout ce frais. Aucun paiement déjà réparti ne change.</p>
          <div className="mt-2 flex flex-wrap gap-2"><button type="button" className="secondary-button" disabled={busy || uncertain} onClick={() => setConfirming(false)}>Revenir</button><Action className="primary-button" busy={busy} onClick={() => void publish()}>{uncertain ? "Vérifier la même demande" : "Confirmer la publication"}</Action></div></div>
        : <div className="mt-4"><button type="button" className="primary-button" disabled={!!entered.error || !!preview.error} onClick={() => setConfirming(true)}>Publier la partie 2</button></div>)}
      {history.length > 0 && <details className="mt-4 text-sm"><summary className="cursor-pointer">Versions de la partie 2</summary><ul className="mt-2 grid gap-1">{history.map((item) => <li key={item.id}>Version {item.version} · {item.status === "published" ? "en service" : "remplacée"} · {item.effectiveFrom.slice(0, 10)}{item.copyOfPartOne ? " · identique à la partie 1" : ""}</li>)}</ul></details>}
    </>}
  </AdminDrawer>;
}
