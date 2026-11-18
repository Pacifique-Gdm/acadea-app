import type { Coordination } from "../types";
import type { PlatformSchoolCounts } from "../services/platformStats";

/** Lot SA-3 : répartition des écoles d'après les comptages du serveur (écoles supprimées exclues). */
export function schoolStatusDistribution(counts: PlatformSchoolCounts): PlatformStatusChartItem[] {
  const items: PlatformStatusChartItem[] = [
    { label: "Actives", value: counts.active, className: "bg-mint", textClassName: "text-mint" },
    { label: "Suspendues", value: counts.suspended, className: "bg-red-600", textClassName: "text-red-600" },
    { label: "En attente", value: counts.pending, className: "bg-amber-500", textClassName: "text-amber-700" },
    { label: "Désactivées", value: counts.inactive, className: "bg-slate-500", textClassName: "text-slate-600" },
  ];
  const other = counts.total - counts.active - counts.suspended - counts.pending - counts.inactive;
  if (other > 0) items.push({ label: "Autres", value: other, className: "bg-violet-500", textClassName: "text-violet-700" });
  return items;
}

export type PlatformStatusChartItem = {
  label: string;
  value: number;
  className: string;
  textClassName: string;
};

export function coordinationStatusDistribution(coordinations: Coordination[]): PlatformStatusChartItem[] {
  const count = (status: Coordination["status"]) => coordinations.filter((coordination) => coordination.status === status).length;
  const known = count("active") + count("inactive") + count("archived");
  const items: PlatformStatusChartItem[] = [
    { label: "Actives", value: count("active"), className: "bg-mint", textClassName: "text-mint" },
    { label: "Inactives", value: count("inactive"), className: "bg-slate-500", textClassName: "text-slate-600" },
    { label: "Archivées", value: count("archived"), className: "bg-amber-500", textClassName: "text-amber-700" },
  ];
  const other = coordinations.length - known;
  if (other > 0) items.push({ label: "Autres", value: other, className: "bg-violet-500", textClassName: "text-violet-700" });
  return items;
}
