import type { School } from "../../types";

export function StatusBadge({ status }: { status: School["status"] }) {
  return (
    <span className={`rounded px-2 py-1 text-xs font-semibold ${status === "active" ? "bg-mint/10 text-mint" : "bg-red-50 text-red-700"}`}>
      {status === "active" ? "Active" : "Suspendue"}
    </span>
  );
}
