export type DashboardTransactionPeriod = "today" | "last5" | "week";

function toDateKey(date: Date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

export function getTransactionPeriodDates(period: DashboardTransactionPeriod, now = new Date()) {
  if (period === "today") return [toDateKey(now)];
  if (period === "last5") {
    return Array.from({ length: 5 }, (_, index) => {
      const date = new Date(now);
      date.setDate(now.getDate() - (4 - index));
      return toDateKey(date);
    });
  }
  const monday = new Date(now);
  const day = monday.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  monday.setDate(now.getDate() + mondayOffset);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return toDateKey(date);
  });
}

export function formatChartDate(dateKey: string) {
  return new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "2-digit" }).format(new Date(`${dateKey}T12:00:00`));
}
