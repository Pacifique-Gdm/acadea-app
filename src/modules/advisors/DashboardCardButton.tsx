// Lot H : carte de Dashboard qu'on peut toucher pour ouvrir l'onglet ou la rubrique correspondante.
// Même apparence que DashboardCard (la carte est simplement placée dans un bouton).
import type { ComponentType, ReactNode } from "react";
import { DashboardCard } from "../../components/ui";

export function DashboardCardButton({ title, value, icon, tone, onClick, children }: { title: string; value?: ReactNode; icon: ComponentType<{ className?: string }>; tone?: string; onClick: () => void; children?: ReactNode }) {
  return <button type="button" onClick={onClick} aria-label={`${title} : ouvrir`} className="grid min-w-0 rounded text-left transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-blue-600">
    <DashboardCard title={title} value={value} icon={icon} tone={tone}>{children}</DashboardCard>
  </button>;
}
