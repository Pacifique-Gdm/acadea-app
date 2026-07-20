import { useEffect, useMemo, useRef } from "react";
import { Bell, RefreshCw } from "lucide-react";
import { MessageDrawerContent } from "../messages/MessageDrawerContent";
import { AdminDrawer } from "../ui";
import { usePaginatedNotifications } from "../../hooks/usePaginatedNotifications";
import { useRealtimeMessageFeed } from "../../hooks/useRealtimeMessageFeed";
import type { AppData, AppNotification, AppUser, Message, School, SchoolYear } from "../../types";

type HeaderYearData = Pick<AppData, "auditLogs" | "messages" | "notifications" | "parents" | "students" | "users">;

type HeaderProps = {
  user: AppUser;
  data: AppData;
  yearData: HeaderYearData;
  school: School;
  year: SchoolYear;
  unreadNotifications: number;
  notificationsOpen: boolean;
  isRefreshing?: boolean;
  refreshError?: string;
  onRefresh: () => void;
  onToggleNotifications: () => void;
  onCloseNotifications?: () => void;
  onRealtimeNotifications?: (notifications: AppNotification[]) => void;
  onRealtimeMessages?: (messages: Message[]) => void;
  roleLabels: Record<AppUser["role"], string>;
};

export function Header({
  user,
  data,
  yearData,
  school,
  year,
  unreadNotifications,
  notificationsOpen,
  isRefreshing,
  refreshError,
  onRefresh,
  onToggleNotifications,
  onCloseNotifications,
  onRealtimeNotifications,
  onRealtimeMessages,
  roleLabels,
}: HeaderProps) {
  const schoolLogoUrl = school.logoUrl?.trim();
  const userDisplayName = user.name.trim();
  const schoolMotto = school.motto?.trim();
  const refreshStatus = isRefreshing ? "Actualisation..." : refreshError;
  const notificationHistory = usePaginatedNotifications({
    user,
    schoolId: school.id,
    schoolYearId: year.id,
    enabled: notificationsOpen,
    messages: data.messages,
  });
  const realtimeMessages = useRealtimeMessageFeed({
    user,
    schoolId: school.id,
    schoolYearId: year.id,
    enabled: notificationsOpen,
  });
  const realtimeHandlersRef = useRef({ onRealtimeNotifications, onRealtimeMessages });
  useEffect(() => {
    realtimeHandlersRef.current = { onRealtimeNotifications, onRealtimeMessages };
  }, [onRealtimeMessages, onRealtimeNotifications]);
  const pushedRealtimeSignatureRef = useRef("");
  const realtimeSignature = useMemo(() => {
    const notificationSignature = notificationHistory.items
      .map((notification) => `${notification.id}:${notification.read ? "1" : "0"}:${notification.createdAt ?? ""}`)
      .join("|");
    const messageSignature = realtimeMessages.messages
      .map((message) => `${message.id}:${message.createdAt ?? ""}`)
      .join("|");
    return `${notificationSignature}::${messageSignature}`;
  }, [notificationHistory.items, realtimeMessages.messages]);

  useEffect(() => {
    if (!realtimeSignature || pushedRealtimeSignatureRef.current === realtimeSignature) return;
    pushedRealtimeSignatureRef.current = realtimeSignature;
    realtimeHandlersRef.current.onRealtimeNotifications?.(notificationHistory.items);
    realtimeHandlersRef.current.onRealtimeMessages?.(realtimeMessages.messages);
  }, [notificationHistory.items, realtimeMessages.messages, realtimeSignature]);
  const displayedUnreadNotifications = user.role === "discipline_director" ? (notificationHistory.unreadCount ?? 0) : (notificationHistory.unreadCount ?? unreadNotifications);
  const markPaginatedNotificationsRead = notificationHistory.markAllRead;

  useEffect(() => {
    if (user.role !== "discipline_director" && notificationsOpen && unreadNotifications === 0 && notificationHistory.unreadCount === 0) {
      markPaginatedNotificationsRead();
    }
  }, [markPaginatedNotificationsRead, notificationHistory.unreadCount, notificationsOpen, unreadNotifications, user.role]);

  const notificationPagination = (
    <div className="grid gap-2">
      <p className="rounded bg-slate-50 p-3 text-xs font-semibold text-slate-500">
        Notifications chargées par pages de 30 éléments, du plus récent au plus ancien.
      </p>
      {notificationHistory.isInitialLoading && <p className="rounded bg-blue-50 p-3 text-sm font-semibold text-blue-700">Chargement des notifications...</p>}
      {notificationHistory.loadError && (
        <div className="grid gap-2 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p className="font-semibold">{notificationHistory.loadError}</p>
          <button onClick={() => void notificationHistory.loadFirstPage()} className="secondary-button w-fit" type="button">Réessayer</button>
        </div>
      )}
      {realtimeMessages.error && <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-700">{realtimeMessages.error}</p>}
      {notificationHistory.hasMore && (
        <button
          onClick={() => void notificationHistory.loadMore()}
          disabled={notificationHistory.isLoadingMore}
          className="secondary-button w-full justify-center disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
        >
          {notificationHistory.isLoadingMore ? "Chargement..." : "Charger plus de notifications"}
        </button>
      )}
    </div>
  );

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-ink font-bold text-white">
              {schoolLogoUrl ? <img src={schoolLogoUrl} alt="" className="h-full w-full object-cover" /> : "A"}
            </div>
            <div className="min-w-0">
              <p className="truncate text-lg font-bold text-ink">{userDisplayName ? `Bonjour, ${userDisplayName}` : "Bonjour !"}</p>
              <p className="text-xs text-slate-500">{roleLabels[user.role]}</p>
              <p className="mt-1 truncate text-sm font-semibold text-ink">{school.name}</p>
              {schoolMotto && <p className="truncate text-xs italic text-slate-500">{schoolMotto}</p>}
              <div className="mt-1 flex max-w-full flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium leading-4 text-slate-500">
                {school.address && <span className="max-w-full truncate">{school.address}</span>}
                {school.phone && <span className="shrink-0">{school.phone}</span>}
                {school.email && <span className="max-w-full break-all">{school.email}</span>}
              </div>
            </div>
          </div>
          <div className="relative flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex items-center justify-end gap-3">
            <span className="rounded bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600">Année scolaire : {year.name}</span>
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="inline-flex h-8 w-8 items-center justify-center text-slate-500 transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              title="Actualiser"
              aria-label="Actualiser"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            </button>
            {refreshStatus && (
              <span className={`text-xs font-semibold ${refreshError ? "text-red-600" : "text-slate-500"}`}>
                {refreshStatus}
              </span>
            )}
            <button onClick={onToggleNotifications} className="relative inline-flex h-8 w-8 items-center justify-center text-slate-500 transition hover:text-ink" title="Boîte à Messagerie" aria-label="Boîte à Messagerie">
              <Bell className="h-4 w-4" />
              {displayedUnreadNotifications > 0 && (
                <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1 text-center text-[11px] font-bold text-white">
                  {displayedUnreadNotifications}
                </span>
              )}
            </button>
            </div>
          </div>
        </div>
      </div>
      {notificationsOpen && (
        <AdminDrawer title="Boîte à Messagerie" onClose={onCloseNotifications ?? onToggleNotifications} closeLabel="Fermer la boîte à messagerie" notificationPanel>
          <MessageDrawerContent
            user={user}
            data={data}
            yearData={yearData}
            school={school}
            notifications={notificationHistory.items}
            realtimeMessages={realtimeMessages.messages}
            notificationPagination={notificationPagination}
            roleLabels={roleLabels}
          />
        </AdminDrawer>
      )}
    </header>
  );
}
