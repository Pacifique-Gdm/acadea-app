import { Search, X } from "lucide-react";
import type { SchoolMessageRecipient } from "../../services/schoolMessaging";
import {
  administrativeRoleLabel,
  filterAdministrativeRecipients,
  toggleAdministrativeRecipient,
  type AdministrativeRecipientMode,
} from "./administrativeRecipientSelection";

type AdministrativeRecipientSelectorProps = {
  mode: AdministrativeRecipientMode;
  onModeChange: (mode: AdministrativeRecipientMode) => void;
  search: string;
  onSearchChange: (search: string) => void;
  recipients: SchoolMessageRecipient[];
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  isLoading: boolean;
  error: string;
};

export function AdministrativeRecipientSelector({
  mode,
  onModeChange,
  search,
  onSearchChange,
  recipients,
  selectedIds,
  onSelectedIdsChange,
  isLoading,
  error,
}: AdministrativeRecipientSelectorProps) {
  const selectedRecipients = recipients.filter((recipient) => selectedIds.includes(recipient.uid));
  const searchResults = filterAdministrativeRecipients(recipients, search);

  function changeMode(nextMode: AdministrativeRecipientMode) {
    onModeChange(nextMode);
    onSearchChange("");
    onSelectedIdsChange([]);
  }

  return (
    <>
      <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
        Filtre des administratifs
        <select value={mode} onChange={(event) => changeMode(event.target.value as AdministrativeRecipientMode)} className="input">
          <option value="all">Tous les administratifs</option>
          <option value="selection">Sélection administratif</option>
        </select>
      </label>
      {mode === "all" ? (
        <p className="rounded bg-slate-50 p-3 text-sm font-semibold text-slate-600">
          {recipients.length} administratif{recipients.length > 1 ? "s" : ""} destinataire{recipients.length > 1 ? "s" : ""}
        </p>
      ) : (
        <>
          <label className="flex min-w-0 items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <input value={search} onChange={(event) => onSearchChange(event.target.value)} className="min-w-0 flex-1 outline-none" placeholder="Rechercher par nom ou fonction" />
          </label>
          {selectedRecipients.length > 0 && (
            <div className="flex min-w-0 flex-wrap gap-2 rounded bg-blue-50 p-3" aria-label="Administratifs sélectionnés">
              {selectedRecipients.map((recipient) => (
                <span key={recipient.uid} className="inline-flex max-w-full items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-blue-700">
                  <span className="min-w-0 truncate">{recipient.name} — {administrativeRoleLabel(recipient.role)}</span>
                  <button type="button" onClick={() => onSelectedIdsChange(selectedIds.filter((id) => id !== recipient.uid))} className="shrink-0 rounded-full p-0.5 transition hover:bg-blue-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600" aria-label={`Retirer ${recipient.name}`}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          {search.trim() ? (
            <div className="grid max-h-60 min-w-0 gap-2 overflow-y-auto pr-1 scrollbar-thin sm:grid-cols-2">
              {searchResults.map((recipient) => (
                <label key={recipient.uid} className="flex min-h-11 min-w-0 cursor-pointer items-center gap-3 rounded border border-slate-200 px-3 py-2 transition hover:bg-slate-50 focus-within:ring-2 focus-within:ring-blue-600">
                  <input type="checkbox" checked={selectedIds.includes(recipient.uid)} onChange={() => onSelectedIdsChange(toggleAdministrativeRecipient(selectedIds, recipient.uid))} />
                  <span className="min-w-0"><strong className="block break-words text-sm text-slate-800">{recipient.name}</strong><span className="text-xs text-slate-500">{administrativeRoleLabel(recipient.role)}</span></span>
                </label>
              ))}
              {!searchResults.length && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500 sm:col-span-2">Aucun administratif trouvé.</p>}
            </div>
          ) : <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Recherchez un administratif par nom ou fonction.</p>}
        </>
      )}
      {isLoading && <p className="text-sm text-slate-500">Chargement des administratifs…</p>}
      {!isLoading && !recipients.length && !error && <p className="text-sm text-slate-500">Aucun administratif actif disponible.</p>}
      {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
    </>
  );
}
