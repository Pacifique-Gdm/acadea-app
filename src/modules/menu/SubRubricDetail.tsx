import { useState } from "react";
import { AdminDrawer } from "../../components/ui";
import { ErrorNotice } from "../../components/ui/ErrorNotice";
import { allocationRequest } from "../../services/feeAllocation";
import { userFacingError } from "../../utils/userFacingError";
import { unbreakableMoney, type AllocationRow, type AllocationSubLine } from "../../utils/feeAllocationView";
import { BUTTON_ROW } from "./FeeAllocationSharing";

/** « Répartir le Reste » (décision de l'utilisateur du 28/11/2026) : phrase à taper exactement (même texte que le serveur). */
export const SUB_REST_PHRASE = "RÉPARTIR CE RESTE";
type PreviewLine = { subRubricId: string; name: string; amountMinor: number };
type Preview = { restMinor: number; totalMinor: number; remainingMinor: number; lines: PreviewLine[] };

/** « Reste réparti le 28/11/2026 à 10:15 par l'administrateur ». */
export const restRedistributedText = (at: string) => {
  const date = new Date(at);
  const day = date.toLocaleDateString("fr-FR"), time = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `Reste réparti le ${day} à ${time} par l'administrateur.`;
};

/** Détail d'une ligne « ↳ » (présenté comme celui d'une rubrique). Le bouton « Répartir le Reste » n'apparaît que dans
 * le détail de « ↳ Reste », pour l'Administrateur, une seule fois par rubrique, quand « Reste » a de l'argent. */
export function SubRubricDetail({ row, sub, filterLabel, schoolId, canRedistribute, restAvailableMinor, redistributedAt, onClose, onDone }: {
  row: AllocationRow; sub: AllocationSubLine; filterLabel: string; schoolId: string; canRedistribute: boolean;
  restAvailableMinor: number; redistributedAt?: string; onClose: () => void; onDone: () => void;
}) {
  const rest = sub.id === "UNALLOCATED";
  const money = (minor: number | null | undefined) => minor === null || minor === undefined ? "—" : unbreakableMoney(minor, row.currency);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [requestId] = useState(() => `subrest-${crypto.randomUUID()}`);
  async function open() {
    if (busy) return;
    setBusy(true); setError("");
    try { setPreview((await allocationRequest<{ preview: Preview }>("preview-sub-rest", { schoolId, rubricId: row.rubricId })).preview); setTyped(""); }
    catch (cause) { setError(userFacingError(cause, "Aperçu de la répartition indisponible.")); } finally { setBusy(false); }
  }
  async function confirm() {
    if (busy || typed !== SUB_REST_PHRASE) return;
    setBusy(true); setError("");
    try { await allocationRequest("redistribute-sub-rest", { schoolId, rubricId: row.rubricId, confirmation: typed, requestId }); setPreview(null); onDone(); }
    catch (cause) { setError(userFacingError(cause, "Reste non réparti.")); } finally { setBusy(false); }
  }
  const fields: [string, string][] = [
    ...(rest ? [["Contenu", "ce qui n'a pas de %, et l'argent reçu avant la création des sous-rubriques"] as [string, string]] : []),
    ["Établissement", row.schoolName], ["Périmètre du prévu", filterLabel], ["Année", row.yearName],
    ["Prévu de l'année", money(sub.plannedMinor)], ["Encaissé selon le filtre", money(sub.receivedMinor)], ["Ouverture", money(sub.openingMinor)],
    ["Encaissé (cumul)", money(sub.cumulativeReceivedMinor)], ["Dépensé (cumul)", money(sub.cumulativeSpentMinor)], ["Disponible", money(sub.availableMinor)],
  ];
  const exact = typed === SUB_REST_PHRASE;
  return <AdminDrawer title={`↳ ${sub.name}`} closeLabel="Fermer le détail de sous-rubrique" onClose={onClose}><div className="grid gap-3 text-justify" data-justified data-sub-rubric-detail>
    <p className="text-sm text-slate-600">Sous-rubrique de « {row.rubricName} »</p>
    <ErrorNotice error={error} />
    <dl className="grid gap-2 text-sm">{fields.map(([label, value]) => <div key={label}><dt className="font-semibold">{label}</dt><dd className="break-words">{value}</dd></div>)}</dl>
    {rest && redistributedAt && <p role="status" className="rounded border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800" data-rest-redistributed>{restRedistributedText(redistributedAt)} Le total de la rubrique n'a pas changé.</p>}
    {rest && !redistributedAt && canRedistribute && restAvailableMinor > 0 && !preview
      && <button type="button" className="primary-button min-h-11 w-full justify-center" disabled={busy} onClick={() => void open()} data-redistribute-rest>Répartir le Reste</button>}
    {rest && preview && <section className="grid gap-2 rounded border border-indigo-200 p-3 text-sm" aria-label="Confirmer la répartition du Reste" data-redistribute-confirm>
      <h4 className="font-semibold">Répartir le Reste de « {row.rubricName} »</h4>
      <p>Les {money(preview.restMinor)} de « Reste » seront partagés <strong>une seule fois</strong>, selon le % de chaque sous-rubrique :</p>
      <ul className="grid gap-1">{preview.lines.map((line) => <li key={line.subRubricId} className="flex justify-between gap-2"><span>{line.name}</span><span className="whitespace-nowrap font-semibold text-emerald-700">+ {money(line.amountMinor)}</span></li>)}
        <li className="flex justify-between gap-2 italic text-slate-600"><span>Reste (ce qui n'a pas de %)</span><span className="whitespace-nowrap">{money(preview.remainingMinor)} restent</span></li></ul>
      <p>Un mouvement daté sera enregistré. Les anciens mouvements ne changent pas.</p>
      <label className="grid gap-1">Tapez exactement « {SUB_REST_PHRASE} » :
        <input className="input" value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} aria-label={`Tapez exactement « ${SUB_REST_PHRASE} »`} /></label>
      <p className={`text-xs ${exact ? "text-emerald-700" : "text-red-700"}`}>{exact ? "Texte exact : « Répartir » est activé." : "Le texte n'est pas exact : « Répartir » reste désactivé."}</p>
      <div className={BUTTON_ROW}>
        <button type="button" className="secondary-button min-h-11 w-full justify-center" disabled={busy} onClick={() => { setPreview(null); setTyped(""); }}>Annuler</button>
        <button type="button" className="primary-button min-h-11 w-full justify-center" disabled={busy || !exact} onClick={() => void confirm()}>Répartir</button>
      </div>
    </section>}
  </div></AdminDrawer>;
}
