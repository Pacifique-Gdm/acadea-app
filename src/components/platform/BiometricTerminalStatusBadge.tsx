import type { BiometricTerminalStatus } from "../../types";

export function BiometricTerminalStatusBadge({ status }: { status: BiometricTerminalStatus }) {
  const labels: Record<BiometricTerminalStatus, string> = {
    unconfigured: "Non configuré",
    connected: "Connecté",
    offline: "Hors ligne",
    disabled: "Désactivé",
  };
  const classNames: Record<BiometricTerminalStatus, string> = {
    unconfigured: "bg-amber-100 text-amber-700",
    connected: "bg-mint/10 text-mint",
    offline: "bg-slate-100 text-slate-600",
    disabled: "bg-red-50 text-red-700",
  };
  return <span className={`rounded px-2 py-1 text-xs font-semibold ${classNames[status]}`}>{labels[status]}</span>;
}
