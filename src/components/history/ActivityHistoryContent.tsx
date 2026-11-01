import { useEffect, useMemo, useState } from "react";
import { ArrowUpDown, Banknote, Bell, Clock3, MessageSquare, Search, ShieldCheck } from "lucide-react";
import type { AppData, AppUser, AuditLog, CashInflow, Expense, Payment } from "../../types";
import { listPedagogicalHistory, type PedagogicalHistoryCursor } from "../../services/pedagogicalHistory";
import { loadControlHistoryPage, type ControlHistoryCursor, type ControlHistoryKind } from "../../services/controlHistory";
import { buildSectionFinancialHistoryItems } from "../../utils/sectionFinancialHistory";
import { isSectionAdministratorRole } from "../../utils/sectionAdministratorYearScope";
import { buildActivityHistoryItems, formatActivityDateTime } from "../../utils/activityHistory";
import type { ActivityHistoryItem, ActivityHistoryYearData } from "../../utils/activityHistory";

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
  const [pedagogicalLogs, setPedagogicalLogs] = useState<AuditLog[]>([]);
  const [pedagogicalCursor, setPedagogicalCursor] = useState<PedagogicalHistoryCursor | null>(null);
  const [pedagogicalLoading, setPedagogicalLoading] = useState(false);
  const [pedagogicalError, setPedagogicalError] = useState("");
  const sectionRole = isSectionAdministratorRole(user.role);
  const [sectionRecords, setSectionRecords] = useState<{ payments: Payment[]; expenses: Expense[]; cashInflows: CashInflow[] }>({ payments: [], expenses: [], cashInflows: [] });
  const [sectionCursors, setSectionCursors] = useState<Partial<Record<ControlHistoryKind, ControlHistoryCursor | null>>>({});
  const [sectionLoading, setSectionLoading] = useState(false);
  const [sectionError, setSectionError] = useState("");
  const scopedYearId = schoolYearId || user.activeSchoolYearId || data.schools.find((school) => school.id === user.schoolId)?.activeSchoolYearId || data.schoolYears.find((year) => year.schoolId === user.schoolId && year.status === "active")?.id || "";
  useEffect(() => {
    if (sectionRole || !["teacher", "study_director", "admin"].includes(role) || !user.schoolId || !scopedYearId) return;
    let active = true;
    setPedagogicalLogs([]);
    setPedagogicalCursor(null);
    setPedagogicalLoading(true);
    setPedagogicalError("");
    void listPedagogicalHistory(user.schoolId, scopedYearId).then((page) => {
      if (active) { setPedagogicalLogs(page.items); setPedagogicalCursor(page.nextCursor); }
    }).catch(() => { if (active) setPedagogicalError("Impossible de charger les activités pédagogiques. Veuillez réessayer."); })
      .finally(() => { if (active) setPedagogicalLoading(false); });
    return () => { active = false; };
  }, [role, scopedYearId, sectionRole, user.schoolId]);
  useEffect(() => {
    if (!sectionRole || !user.schoolId || !scopedYearId) return;
    let active = true;
    setSectionRecords({ payments: [], expenses: [], cashInflows: [] });
    setSectionCursors({});
    setSectionError("");
    setSectionLoading(true);
    void Promise.all([
      loadControlHistoryPage<Payment>("payments", user.schoolId, scopedYearId, user),
      loadControlHistoryPage<Expense>("expenses", user.schoolId, scopedYearId, user),
      loadControlHistoryPage<CashInflow>("cashInflows", user.schoolId, scopedYearId, user),
    ]).then(([payments, expenses, cashInflows]) => {
      if (!active) return;
      setSectionRecords({ payments: payments.items, expenses: expenses.items, cashInflows: cashInflows.items });
      setSectionCursors({ payments: payments.lastVisible, expenses: expenses.lastVisible, cashInflows: cashInflows.lastVisible });
    }).catch(() => { if (active) setSectionError("Historique financier indisponible. Veuillez réessayer."); })
      .finally(() => { if (active) setSectionLoading(false); });
    return () => { active = false; };
  }, [scopedYearId, sectionRole, user]);
  const combinedYearData = useMemo(() => ({ ...yearData, auditLogs: [...yearData.auditLogs, ...pedagogicalLogs] }), [yearData, pedagogicalLogs]);
  const items = useMemo(() => sectionRole
    ? buildSectionFinancialHistoryItems(sectionRecords, yearData.students)
    : buildActivityHistoryItems(user, data, combinedYearData, role), [combinedYearData, data, role, sectionRecords, sectionRole, user, yearData.students]);
  async function loadMoreSectionHistory(kind: ControlHistoryKind) {
    if (!user.schoolId || !scopedYearId || !sectionCursors[kind] || sectionLoading) return;
    setSectionLoading(true);
    setSectionError("");
    try {
      const page = await loadControlHistoryPage<Payment & Expense & CashInflow>(kind, user.schoolId, scopedYearId, user, sectionCursors[kind]);
      setSectionRecords((current) => ({ ...current, [kind]: [...current[kind], ...page.items] }));
      setSectionCursors((current) => ({ ...current, [kind]: page.lastVisible }));
    } catch { setSectionError("Suite de l'historique indisponible. Veuillez réessayer."); }
    finally { setSectionLoading(false); }
  }
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
    <div className="grid w-full min-w-0 max-w-full gap-4">
      {loading && <p role="status" className="rounded bg-slate-50 p-5 text-center text-sm text-slate-600">Chargement de l’historique…</p>}
      {!loading && error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">Impossible de charger l’historique. Veuillez réessayer.</p>}
      {!loading && !error && <>
      {pedagogicalError && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{pedagogicalError}</p>}
      {pedagogicalLoading && <p role="status" className="text-sm text-slate-500">Chargement des activités pédagogiques…</p>}
      {sectionError && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{sectionError}</p>}
      {sectionLoading && <p role="status" className="text-sm text-slate-500">Chargement de l'historique financier…</p>}
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
        </select>
      </div>

      <div className="min-w-0 max-w-full space-y-2">
        {filteredItems.length === 0 && !sectionLoading && !sectionError && (
          <p className="rounded border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">Aucune activité disponible.</p>
        )}
        {filteredItems.map((item) => (
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
      {pedagogicalCursor && <button type="button" className="secondary-button justify-center" disabled={pedagogicalLoading} onClick={() => void loadMorePedagogical()}>Afficher plus d’activités pédagogiques</button>}
      {sectionRole && (Object.keys(sectionCursors) as ControlHistoryKind[]).filter((kind) => sectionCursors[kind]).map((kind) => <button key={kind} type="button" className="secondary-button justify-center" disabled={sectionLoading} onClick={() => void loadMoreSectionHistory(kind)}>Afficher plus : {kind === "payments" ? "paiements" : kind === "expenses" ? "dépenses" : "autres entrées"}</button>)}
      </>}
    </div>
  );
}
