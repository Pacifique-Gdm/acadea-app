import { useEffect, useMemo, useState } from "react";
import { ArrowUpDown, Banknote, Bell, Clock3, MessageSquare, Search, ShieldCheck, UserPen } from "lucide-react";
import type { AppData, AppUser, AuditLog } from "../../types";
import { listPedagogicalHistory, type PedagogicalHistoryCursor } from "../../services/pedagogicalHistory";
import { ACTIVITY_HISTORY_PAGE_SIZE, activityHistoryActors, buildActivityHistoryItems, filterActivityHistoryItems, formatActivityDateTime } from "../../utils/activityHistory";
import type { ActivityHistoryItem, ActivityHistoryYearData } from "../../utils/activityHistory";
import { ErrorNotice } from "../ui/ErrorNotice";
import { useLoadRetry } from "../../hooks/useLoadRetry";

export function ActivityHistoryContent({
  user,
  data,
  yearData,
  role,
  loading = false,
  error = "",
  schoolYearId,
}: {
  user: AppUser;
  data: AppData;
  yearData: ActivityHistoryYearData;
  role: "admin" | "cashier" | "parent" | "secretary" | "teacher" | "study_director";
  loading?: boolean;
  error?: string;
  schoolYearId?: string;
}) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | ActivityHistoryItem["type"]>("all");
  const [actorFilter, setActorFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [visibleCount, setVisibleCount] = useState(ACTIVITY_HISTORY_PAGE_SIZE);
  const [pedagogicalLogs, setPedagogicalLogs] = useState<AuditLog[]>([]);
  const [pedagogicalCursor, setPedagogicalCursor] = useState<PedagogicalHistoryCursor | null>(null);
  const [pedagogicalLoading, setPedagogicalLoading] = useState(false);
  const [pedagogicalError, setPedagogicalError] = useState("");
  const [pedagogicalErrorLoad, setPedagogicalErrorLoad] = useState("");
  const pedagogicalErrorLoadRetry = useLoadRetry(Boolean(pedagogicalErrorLoad), () => setPedagogicalErrorLoad(""));
  const scopedYearId = schoolYearId || user.activeSchoolYearId || data.schools.find((school) => school.id === user.schoolId)?.activeSchoolYearId || data.schoolYears.find((year) => year.schoolId === user.schoolId && year.status === "active")?.id || "";
  useEffect(() => {
    if (!["teacher", "study_director", "admin"].includes(role) || !user.schoolId || !scopedYearId) return;
    let active = true;
    setPedagogicalLogs([]);
    setPedagogicalCursor(null);
    setPedagogicalLoading(true);
    setPedagogicalErrorLoad("");
    void listPedagogicalHistory(user.schoolId, scopedYearId).then((page) => {
      if (active) { setPedagogicalLogs(page.items); setPedagogicalCursor(page.nextCursor); }
    }).catch(() => { if (active) setPedagogicalErrorLoad("Impossible de charger les activités pédagogiques. Veuillez réessayer."); })
      .finally(() => { if (active) setPedagogicalLoading(false); });
    return () => { active = false; };
  }, [role, scopedYearId, user.schoolId, pedagogicalErrorLoadRetry.token]);
  const combinedYearData = useMemo(() => ({ ...yearData, auditLogs: [...yearData.auditLogs, ...pedagogicalLogs] }), [yearData, pedagogicalLogs]);
  const items = useMemo(() => buildActivityHistoryItems(user, data, combinedYearData, role), [data, role, user, combinedYearData]);
  async function loadMorePedagogical() {
    if (!pedagogicalCursor || !user.schoolId || !scopedYearId || pedagogicalLoading) return;
    setPedagogicalLoading(true);
    setPedagogicalError("");
    try {
      const page = await listPedagogicalHistory(user.schoolId, scopedYearId, pedagogicalCursor);
      setPedagogicalLogs((current) => [...current, ...page.items]);
      setPedagogicalCursor(page.nextCursor);
    } catch { setPedagogicalError("Impossible de charger les activités pédagogiques. Veuillez réessayer."); }
    finally { setPedagogicalLoading(false); }
  }
  const filteredItems = filterActivityHistoryItems(items, { query, type: typeFilter, actor: actorFilter, from: fromDate, to: toDate });
  const actors = useMemo(() => activityHistoryActors(items), [items]);
  // Toute nouvelle recherche ou tout nouveau filtre repart de la première page.
  useEffect(() => { setVisibleCount(ACTIVITY_HISTORY_PAGE_SIZE); }, [query, typeFilter, actorFilter, fromDate, toDate]);
  const shownItems = filteredItems.slice(0, visibleCount);
  const historyTypeLabels: Record<ActivityHistoryItem["type"], string> = {
    activity: "Activité",
    message: "Message",
    warning: "Avertissement",
    payment: "Paiement",
    expense: "Dépense",
    discipline: "Sanction",
    student: "Élève",
  };

  function historyIconTone(type: ActivityHistoryItem["type"]) {
    if (type === "message") return "bg-blue-50 text-blue-700";
    if (type === "warning") return "bg-amber-100 text-amber-700";
    if (type === "payment") return "bg-mint/10 text-mint";
    if (type === "expense") return "bg-red-50 text-red-700";
    if (type === "discipline") return "bg-purple-50 text-purple-700";
    if (type === "student") return "bg-sky-50 text-sky-700";
    return "bg-slate-100 text-slate-600";
  }

  function historyIcon(type: ActivityHistoryItem["type"]) {
    if (type === "message") return <MessageSquare className="h-4 w-4" />;
    if (type === "warning") return <Bell className="h-4 w-4" />;
    if (type === "payment") return <Banknote className="h-4 w-4" />;
    if (type === "expense") return <ArrowUpDown className="h-4 w-4" />;
    if (type === "discipline") return <ShieldCheck className="h-4 w-4" />;
    if (type === "student") return <UserPen className="h-4 w-4" />;
    return <Clock3 className="h-4 w-4" />;
  }

  return (
    <div className="grid w-full min-w-0 max-w-full gap-4">
      {loading && <p role="status" className="rounded bg-slate-50 p-5 text-center text-sm text-slate-600">Chargement de l’historique…</p>}
      {!loading && error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">Impossible de charger l’historique. Veuillez réessayer.</p>}
      {!loading && !error && <>
      <ErrorNotice error={pedagogicalErrorLoad} onRetry={pedagogicalErrorLoadRetry.retry} /><ErrorNotice error={pedagogicalError} />
      {pedagogicalLoading && <p role="status" className="text-sm text-slate-500">Chargement des activités pédagogiques…</p>}
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
        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)} className="input min-w-0 max-w-full">
          <option value="all">Tout</option>
          <option value="activity">Activités</option>
          <option value="message">Messages</option>
          {role !== "parent" && <option value="warning">Avertissements</option>}
          {(role === "admin" || role === "cashier") && <option value="payment">Paiements</option>}
          {(role === "admin" || role === "cashier") && <option value="expense">Dépenses</option>}
          {role === "admin" && <option value="discipline">Sanctions</option>}
          {role === "admin" && <option value="student">Élèves (ajouts et modifications)</option>}
        </select>
      </div>
      {role === "admin" && <div className="grid min-w-0 gap-2 sm:grid-cols-3">
        <label className="grid min-w-0 gap-1 text-xs font-semibold text-slate-600">
          Utilisateur
          <select aria-label="Filtrer par utilisateur" value={actorFilter} onChange={(event) => setActorFilter(event.target.value)} className="input min-w-0 max-w-full">
            <option value="">Tous les utilisateurs</option>
            {actors.map((actor) => <option key={actor} value={actor}>{actor}</option>)}
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-xs font-semibold text-slate-600">
          Du
          <input type="date" aria-label="Début de la période" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="input min-w-0 max-w-full" />
        </label>
        <label className="grid min-w-0 gap-1 text-xs font-semibold text-slate-600">
          Au
          <input type="date" aria-label="Fin de la période" value={toDate} onChange={(event) => setToDate(event.target.value)} className="input min-w-0 max-w-full" />
        </label>
      </div>}

      <div className="min-w-0 max-w-full space-y-2">
        {filteredItems.length === 0 && (
          <p className="rounded border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">Aucune activité disponible.</p>
        )}
        {shownItems.map((item) => (
          <article key={item.id} className="box-border w-full min-w-0 max-w-full rounded border border-slate-200 bg-white p-3 text-sm">
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
                <p className="mt-1 break-words text-xs text-slate-500">
                  {item.actorName} · {formatActivityDateTime(item.createdAt)}
                </p>
                {item.details && <p className="mt-2 break-words leading-6 text-slate-700">{item.details}</p>}
              </div>
            </div>
          </article>
        ))}
      </div>
      {filteredItems.length > shownItems.length && <button type="button" className="secondary-button justify-center" onClick={() => setVisibleCount((count) => count + ACTIVITY_HISTORY_PAGE_SIZE)}>Voir plus ({filteredItems.length - shownItems.length} restantes)</button>}
      {pedagogicalCursor && <button type="button" className="secondary-button justify-center" disabled={pedagogicalLoading} onClick={() => void loadMorePedagogical()}>Afficher plus d’activités pédagogiques</button>}
      </>}
    </div>
  );
}
