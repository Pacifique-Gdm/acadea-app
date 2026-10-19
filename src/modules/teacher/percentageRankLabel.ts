const percent = new Intl.NumberFormat("fr", { maximumFractionDigits: 2 });

export function percentageRankLabel(percentage: number | null, rank: number | null) {
  if (percentage === null || rank === null) return "—";
  return `${percent.format(percentage)} % / ${rank}${rank === 1 ? "er" : "ème"}`;
}
