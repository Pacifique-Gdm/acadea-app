import { useState } from "react";
import { formatCurrencyMoney } from "../utils/currency";
import { userFacingError } from "../utils/userFacingError";
import { ErrorNotice } from "./ui/ErrorNotice";

/** Lot « 3 étapes » : justifications des écritures (motif écrit, photo, preuve Acadéa), consultables plus tard.
 * Montrées à l'Administrateur de l'école et au Super administrateur ; le serveur vérifie le rôle et signe les photos (10 minutes). */
export type AllocationJustification = {
  id: string; decidedAt: string | null; decision: "accepted" | "rejected"; kind: "declaration" | "proof";
  reason: string | null; refusal: string | null; nature: string; amount: number | null; currency: "USD" | "CDF" | null;
  receiptNumber: string | null; entryDate: string | null; actorName: string; hasPhoto: boolean; photoUrl: string | null;
};
export type AllocationJustificationsResult = { rows: AllocationJustification[]; truncated: boolean; photoUrlMinutes: number };

export function parseJustifications(value: unknown): AllocationJustificationsResult {
  const data = value as Partial<AllocationJustificationsResult> | null;
  if (!data || !Array.isArray(data.rows) || typeof data.truncated !== "boolean") throw new Error("Justifications incomplètes.");
  return { rows: data.rows, truncated: data.truncated, photoUrlMinutes: Number(data.photoUrlMinutes) || 10 };
}

const day = (value: string | null) => (value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString("fr-FR") : "date inconnue");

export function AllocationJustifications({ load }: { load: () => Promise<AllocationJustificationsResult> }) {
  const [result, setResult] = useState<AllocationJustificationsResult | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function refresh() {
    setBusy(true); setError("");
    try { setResult(await load()); } catch (cause) { setError(userFacingError(cause, "Justifications indisponibles.")); } finally { setBusy(false); }
  }
  return <details className="text-sm" data-justifications onToggle={(event) => { if ((event.target as HTMLDetailsElement).open && !result && !busy) void refresh(); }}>
    <summary className="cursor-pointer">Voir les justifications</summary>
    <div className="mt-2 grid gap-2 text-justify">
      {busy && <p role="status">Chargement...</p>}
      <ErrorNotice error={error} onRetry={() => void refresh()} />
      {result && !result.rows.length && <p>Aucune justification enregistrée pour cette année.</p>}
      {result?.rows.map((row) => <article key={row.id} className="grid gap-1 rounded border p-2" data-justification>
        <p className="font-semibold">{row.nature}{row.receiptNumber ? ` · reçu ${row.receiptNumber}` : ""} · {day(row.entryDate)}{row.amount !== null && row.currency ? ` · ${formatCurrencyMoney(row.amount, row.currency)}` : ""}</p>
        <p>{row.decision === "accepted" ? (row.kind === "declaration" ? "Justifiée par un motif écrit" : "Justifiée par une preuve Acadéa") : "Justification refusée"} — {row.actorName}, le {day(row.decidedAt)}.</p>
        {row.reason && <p>Motif : « {row.reason} »</p>}
        {row.refusal && <p className="text-amber-800">Raison du refus : {row.refusal}</p>}
        {row.photoUrl ? <a className="secondary-button justify-self-start" href={row.photoUrl} target="_blank" rel="noopener noreferrer" data-justification-photo>Voir la photo</a>
          : row.hasPhoto ? <p>Photo jointe, momentanément indisponible : actualisez.</p> : null}
      </article>)}
      {result && <p className="text-xs text-slate-600">Le lien de chaque photo est valable {result.photoUrlMinutes} minutes ; rouvrez la liste pour en obtenir un nouveau.{result.truncated ? " Seules les 200 plus récentes sont affichées." : ""}</p>}
      {result && <button type="button" className="secondary-button justify-self-start" disabled={busy} onClick={() => void refresh()}>Actualiser la liste</button>}
    </div>
  </details>;
}
