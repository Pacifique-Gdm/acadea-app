import { useMemo, useState } from "react";
import { ArrowUpDown, Banknote, Bell, Clock3, MessageSquare, Search, ShieldCheck } from "lucide-react";
import type { AppData, AppUser } from "../../types";
import { buildActivityHistoryItems } from "../../utils/activityHistory";
import type { ActivityHistoryItem, ActivityHistoryYearData } from "../../utils/activityHistory";

export function ActivityHistoryContent({
  user,
  data,
  yearData,
  role,
}: {
  user: AppUser;
  data: AppData;
  yearData: ActivityHistoryYearData;
  role: "admin" | "cashier" | "parent";
}) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | ActivityHistoryItem["type"]>("all");
  const items = useMemo(() => buildActivityHistoryItems(user, data, yearData, role), [data, role, user, yearData]);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredItems = items.filter((item) => {
    const matchesType = typeFilter === "all" || item.type === typeFilter;
    const text = `${item.title} ${item.actorName} ${item.details}`.toLowerCase();
    return matchesType && (!normalizedQuery || text.includes(normalizedQuery));
  });
  const historyTypeLabels: Record<ActivityHistoryItem["type"], string> = {
    activity: "Activité",
    message: "Message",
    warning: "Avertissement",
    payment: "Paiement",
    expense: "Dépense",
    discipline: "Sanction",
  };

  function historyIconTone(type: ActivityHistoryItem["type"]) {
    if (type === "message") return "bg-blue-50 text-blue-700";
    if (type === "warning") return "bg-amber-100 text-amber-700";
    if (type === "payment") return "bg-mint/10 text-mint";
    if (type === "expense") return "bg-red-50 text-red-700";
    if (type === "discipline") return "bg-purple-50 text-purple-700";
    return "bg-slate-100 text-slate-600";
  }

  function historyIcon(type: ActivityHistoryItem["type"]) {
    if (type === "message") return <MessageSquare className="h-4 w-4" />;
    if (type === "warning") return <Bell className="h-4 w-4" />;
    if (type === "payment") return <Banknote className="h-4 w-4" />;
    if (type === "expense") return <ArrowUpDown className="h-4 w-4" />;
    if (type === "discipline") return <ShieldCheck className="h-4 w-4" />;
    return <Clock3 className="h-4 w-4" />;
  }

  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_160px]">
        <label className="flex min-w-0 items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 outline-none"
            placeholder="Rechercher dans l'historique"
          />
        </label>
        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)} className="input">
          <option value="all">Tout</option>
          <option value="activity">Activités</option>
          <option value="message">Messages</option>
          {role !== "parent" && <option value="warning">Avertissements</option>}
          {role === "admin" && <option value="payment">Paiements</option>}
          {role === "admin" && <option value="expense">Dépenses</option>}
          {role === "admin" && <option value="discipline">Sanctions</option>}
        </select>
      </div>

      <div className="space-y-2">
        {filteredItems.length === 0 && (
          <p className="rounded border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">Aucun historique trouvé.</p>
        )}
        {filteredItems.map((item) => (
          <article key={item.id} className="min-w-0 rounded border border-slate-200 bg-white p-3 text-sm">
            <div className="flex min-w-0 items-start gap-3">
              <div className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded ${historyIconTone(item.type)}`}>
                {historyIcon(item.type)}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="break-words font-semibold text-ink">{item.title}</p>
                  <span className="rounded bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase text-slate-500">
                    {historyTypeLabels[item.type]}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {item.actorName} · {new Date(item.createdAt).toLocaleString("fr-FR")}
                </p>
                {item.details && <p className="mt-2 break-words leading-6 text-slate-700">{item.details}</p>}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
