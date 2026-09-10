import type { Coordination } from "../types";

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
