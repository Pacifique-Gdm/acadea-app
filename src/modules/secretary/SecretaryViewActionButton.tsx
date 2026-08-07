import { Eye } from "lucide-react";

export const secretaryViewActionClassName = "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700 transition hover:bg-slate-200 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2";

export function SecretaryViewActionButton({ onClick }: { onClick: () => void }) {
  return <button type="button" title="Voir" aria-label="Voir" className={secretaryViewActionClassName} onClick={onClick}><Eye aria-hidden="true" className="h-4 w-4" /></button>;
}
