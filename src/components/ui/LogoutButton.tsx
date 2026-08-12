import { LogOut } from "lucide-react";

export const logoutButtonClassName = "inline-flex w-full items-center justify-center gap-2 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2";

export function LogoutButton({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} className={logoutButtonClassName} type="button"><LogOut className="h-4 w-4" /> Déconnexion</button>;
}
