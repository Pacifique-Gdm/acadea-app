import { useState } from "react";
import type { BillingControls } from "../../services/billingControls";

type BillingControlsDrawerProps = {
  controls: BillingControls;
  loading: boolean;
  error: string;
  updatedBy?: string;
  onSetValvesUploadsEnabled: (enabled: boolean, updatedBy?: string) => Promise<void>;
};

const suspendConfirmation = "SUSPENDRE LES PIECES JOINTES";
const reactivateConfirmation = "REACTIVER LES PIECES JOINTES";

export function BillingControlsDrawer({
  controls,
  loading,
  error,
  updatedBy,
  onSetValvesUploadsEnabled,
}: BillingControlsDrawerProps) {
  const [mode, setMode] = useState<"suspend" | "reactivate" | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const expectedConfirmation = mode === "suspend" ? suspendConfirmation : reactivateConfirmation;
  const actionDisabled = !mode || confirmation !== expectedConfirmation || saving || loading;

  async function confirmAction() {
    if (!mode || actionDisabled) return;
    setSaving(true);
    setFeedback("");
    try {
      await onSetValvesUploadsEnabled(mode === "reactivate", updatedBy);
      setFeedback(mode === "reactivate" ? "Les nouvelles pièces jointes Valves sont réactivées." : "Les nouvelles pièces jointes Valves sont suspendues.");
      setMode(null);
      setConfirmation("");
    } catch (saveError) {
      setFeedback(saveError instanceof Error ? saveError.message : "Action impossible. Veuillez réessayer.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="rounded border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-semibold text-slate-600">État actuel</p>
        <p className={`mt-1 text-lg font-bold ${controls.valvesUploadsEnabled ? "text-emerald-700" : "text-red-700"}`}>
          {controls.valvesUploadsEnabled ? "Autorisé" : "Suspendu"}
        </p>
        {controls.updatedAt && <p className="mt-1 text-xs text-slate-500">Dernière mise à jour : {new Date(controls.updatedAt).toLocaleString("fr-FR")}</p>}
      </div>

      {error && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
      {feedback && <p className="rounded border border-mint/30 bg-mint/10 p-3 text-sm font-semibold text-mint">{feedback}</p>}

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          className="rounded bg-red-50 px-4 py-3 text-sm font-bold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!controls.valvesUploadsEnabled || loading || saving}
          onClick={() => {
            setMode("suspend");
            setConfirmation("");
            setFeedback("");
          }}
        >
          Suspendre les pièces jointes
        </button>
        <button
          type="button"
          className="rounded bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={controls.valvesUploadsEnabled || loading || saving}
          onClick={() => {
            setMode("reactivate");
            setConfirmation("");
            setFeedback("");
          }}
        >
          Réactiver les pièces jointes
        </button>
      </div>

      {mode && (
        <div className="grid gap-3 rounded border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">
            Tapez exactement : <span className="font-extrabold">{expectedConfirmation}</span>
          </p>
          <input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            className="input bg-white"
            placeholder={expectedConfirmation}
            disabled={saving}
          />
          <button
            type="button"
            className="primary-button justify-center disabled:cursor-not-allowed disabled:opacity-50"
            disabled={actionDisabled}
            onClick={() => void confirmAction()}
          >
            {saving ? "Enregistrement..." : mode === "suspend" ? "Confirmer la suspension" : "Confirmer la réactivation"}
          </button>
        </div>
      )}
    </div>
  );
}
