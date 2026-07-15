import type { LucideIcon } from "lucide-react";

export function IconButton({ label, onClick, icon: Icon, danger = false }: { label: string; onClick: () => void; icon: LucideIcon; danger?: boolean }) {
  return (
    <button onClick={onClick} title={label} className={`rounded p-2 ${danger ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-700"}`}>
      <Icon className="h-4 w-4" />
    </button>
  );
}
