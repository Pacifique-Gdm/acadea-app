import { useRef, useState } from "react";
import { MoneyInput } from "../ui";
import { createCashInflowTransaction } from "../../services/financialTransactions";
import { toMoneyMinor } from "../../utils/money";
import { cashInflowCategoryLabel } from "../../utils/cashInflowCategory";
import type { CashInflow, SchoolYear } from "../../types";

const categories: CashInflow["category"][] = ["Subvention", "Don", "Frais de fonctionnement", "Autres"];

export function OtherCashInflowForm({ year, onRecorded }: { year: SchoolYear; onRecorded: (inflow: CashInflow) => void }) {
  const [category, setCategory] = useState<CashInflow["category"]>("Subvention");
  const [amount, setAmount] = useState("");
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [source, setSource] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const attempt = useRef<{ signature: string; id: string } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    setError("");
    const numericAmount = Number(amount.replace(",", "."));
    try {
      if (!Number.isFinite(numericAmount) || toMoneyMinor(numericAmount) <= 0) throw new Error("Saisissez un montant strictement positif.");
      if (!entryDate || !source.trim() || !paymentMethod.trim() || description.trim().length < 10 || description.length > 1000) {
        throw new Error("Renseignez la date, la provenance, le mode et une description d'au moins 10 caractères.");
      }
      const payload = { schoolYearId: year.id, category, amount: numericAmount, entryDate,
        source: source.trim(), paymentMethod: paymentMethod.trim(), description: description.trim(), reference: reference.trim() };
      const signature = JSON.stringify(payload);
      const requestId = attempt.current?.signature === signature ? attempt.current.id : crypto.randomUUID();
      attempt.current = { signature, id: requestId };
      submitting.current = true;
      setSaving(true);
      const inflow = await createCashInflowTransaction({ ...payload, ...(payload.reference ? { reference: payload.reference } : {}), clientRequestId: requestId });
      attempt.current = null;
      onRecorded(inflow);
      setAmount(""); setSource(""); setPaymentMethod(""); setDescription(""); setReference("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enregistrement impossible. Réessayez après vérification de la connexion.");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return <form onSubmit={(event) => void submit(event)} className="grid min-w-0 gap-3" aria-label="Autres entrées de caisse">
    <p className="text-sm text-slate-600">Cette recette n'est confirmée qu'après validation par le serveur Acadéa.</p>
    <label className="grid gap-1 text-sm font-semibold">Nature de l'entrée
      <select aria-label="Nature de l'entrée" className="input w-full" value={category} onChange={(event) => setCategory(event.target.value as CashInflow["category"])} disabled={saving}>
        {categories.map((value) => <option key={value} value={value}>{cashInflowCategoryLabel(value)}</option>)}
      </select>
    </label>
    <label className="grid gap-1 text-sm font-semibold">Montant
      <MoneyInput value={amount} onChange={setAmount} disabled={saving} className="input w-full" />
    </label>
    <label className="grid gap-1 text-sm font-semibold">Date de l'entrée
      <input aria-label="Date de l'entrée" type="date" className="input w-full" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} disabled={saving} required />
    </label>
    <label className="grid gap-1 text-sm font-semibold">Provenance des fonds
      <input aria-label="Provenance des fonds" className="input w-full" maxLength={200} value={source} onChange={(event) => setSource(event.target.value)} disabled={saving} required />
    </label>
    <label className="grid gap-1 text-sm font-semibold">Mode de paiement
      <input aria-label="Mode de paiement" className="input w-full" maxLength={100} value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} disabled={saving} required />
    </label>
    <label className="grid gap-1 text-sm font-semibold">Description
      <textarea aria-label="Description" className="input min-h-24 w-full" minLength={10} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} disabled={saving} required />
    </label>
    <label className="grid gap-1 text-sm font-semibold">Référence de l'opération (facultative)
      <input aria-label="Référence de l'opération" className="input w-full" maxLength={160} value={reference} onChange={(event) => setReference(event.target.value)} disabled={saving} />
    </label>
    {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
    <button type="submit" disabled={saving || year.status !== "active"} className="primary-button w-full justify-center disabled:opacity-50">{saving ? "Enregistrement…" : "Enregistrer cette entrée"}</button>
  </form>;
}
