export type SecretaryDeletableDocumentKind = "correspondence" | "report";

function secretaryDocumentDeleteConfirmation(kind: SecretaryDeletableDocumentKind) {
  return kind === "correspondence" ? "SUPPRIMER COURRIER" : "SUPPRIMER RAPPORT";
}

export function SecretaryDocumentDeleteDialog({ kind, value, busy, onValueChange, onCancel, onConfirm }: {
  kind: SecretaryDeletableDocumentKind;
  value: string;
  busy: boolean;
  onValueChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const expected = secretaryDocumentDeleteConfirmation(kind);
  const label = kind === "correspondence" ? "courrier" : "rapport";
  return <div role="dialog" aria-modal="true" aria-labelledby="secretary-delete-title" aria-describedby="secretary-delete-description" className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/50 p-4">
    <form className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl" onSubmit={(event) => { event.preventDefault(); if (value === expected && !busy) onConfirm(); }}>
      <h3 id="secretary-delete-title" className="text-lg font-extrabold">Supprimer définitivement le {label}</h3>
      <p id="secretary-delete-description" className="mt-3 text-sm text-slate-700">Cette action supprimera définitivement ce {label}. Pour confirmer, saisissez exactement :<br /><strong>{expected}</strong></p>
      <label className="mt-4 grid gap-1 text-sm font-semibold">Texte de confirmation<input autoFocus className="input" value={value} disabled={busy} aria-invalid={Boolean(value && value !== expected)} onChange={(event) => onValueChange(event.target.value)} /></label>
      {value && value !== expected && <p role="alert" className="mt-2 text-sm font-semibold text-red-700">Le texte de confirmation est incorrect.</p>}
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" className="secondary-button justify-center" disabled={busy} onClick={onCancel}>Annuler</button><button type="submit" className="rounded bg-red-700 px-4 py-2 font-semibold text-white transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy || value !== expected}>{busy ? "Suppression…" : "Supprimer"}</button></div>
    </form>
  </div>;
}
