import type { ReactNode } from "react";
import type { AppData, AppNotification, AppUser, AuditLog, Message, ParentProfile, School, Student } from "../../types";

type MessageDrawerYearData = {
  auditLogs: AuditLog[];
  messages: Message[];
  notifications: AppNotification[];
  parents: ParentProfile[];
  students: Student[];
  users: AppUser[];
};

type NotificationFeedItem = {
  key: string;
  type: "notification";
  notification: AppNotification;
  title: string;
  preview: string;
  createdAt: string;
  unread?: boolean;
  tone?: "warning" | "payment" | "attendance";
  notificationSenderLabel?: string;
};

type MessageFeedItem = {
  key: string;
  type: "message";
  message: Message;
  createdAt: string;
};

type FeedItem = NotificationFeedItem | MessageFeedItem;

export function MessageDrawerContent({
  user,
  data,
  yearData,
  school,
  notifications: paginatedNotifications,
  realtimeMessages = [],
  notificationPagination,
  roleLabels,
}: {
  user: AppUser;
  data: AppData;
  yearData: MessageDrawerYearData;
  school: School;
  notifications?: AppNotification[];
  realtimeMessages?: Message[];
  notificationPagination?: ReactNode;
  roleLabels: Record<AppUser["role"], string>;
}) {
  const isParent = user.role === "parent";

  function messageTimestamp(value?: string) {
    if (!value) return 0;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function formatFeedDate(value?: string) {
    const timestamp = messageTimestamp(value);
    return timestamp > 0 ? new Date(timestamp).toLocaleString("fr-FR") : "Date non renseignée";
  }

  const notifications = [...(paginatedNotifications ?? yearData.notifications)].sort((a, b) => messageTimestamp(b.createdAt) - messageTimestamp(a.createdAt));
  const notificationReadState = new Map(yearData.notifications.map((notification) => [notification.id, notification.read]));

  function getParentForMessage(message: Message) {
    const senderParentId = data.users.find((item) => item.id === message.senderId)?.parentId;
    const parentId = message.threadParentId ?? senderParentId ?? (message.recipientParentId !== "all" && message.recipientParentId !== "school" ? message.recipientParentId : undefined);
    return parentId ? yearData.parents.find((item) => item.id === parentId) : undefined;
  }

  function parentChildren(parentProfile?: ParentProfile) {
    if (!parentProfile) return [];
    return yearData.students.filter((student) => student.parentId === parentProfile.id || parentProfile.studentIds.includes(student.id));
  }

  function isParentDisciplineMessage(message: Message) {
    return isParent && message.schoolRecipient === "discipline" && message.recipientParentId !== "school";
  }

  function senderDetails(message: Message) {
    if (isParentDisciplineMessage(message)) {
      return {
        type: "school" as const,
        name: "Directeur de Discipline",
        role: "École",
        children: [],
      };
    }
    const sender = data.users.find((item) => item.id === message.senderId) ?? yearData.users.find((item) => item.id === message.senderId);
    const senderParent = sender?.parentId ? yearData.parents.find((item) => item.id === sender.parentId) : getParentForMessage(message);
    if (sender?.role === "parent" || (!sender && senderParent && message.recipientParentId === "school")) {
      return {
        type: "parent" as const,
        name: senderParent?.fullName ?? sender?.name ?? "Parent",
        role: "Parent",
        children: parentChildren(senderParent),
      };
    }
    return {
        type: "school" as const,
        name: sender?.name ?? school.name,
        role: sender ? roleLabels[sender.role] : "École",
        children: [],
      };
  }

  function canShowMessageInConversation(message: Message) {
    if (isParent) return true;
    if (message.schoolRecipient) {
      if (user.role === "school_admin") return message.schoolRecipient === "admin" || message.schoolRecipient === "both";
      if (user.role === "cashier") return message.schoolRecipient === "cashier" || message.schoolRecipient === "both";
      if (user.role === "discipline_director") return message.schoolRecipient === "discipline";
      return true;
    }
    const sender = data.users.find((item) => item.id === message.senderId) ?? yearData.users.find((item) => item.id === message.senderId);
    if (sender?.role === "school_admin") return user.role === "school_admin";
    if (sender?.role === "cashier") return user.role === "cashier";
    if (sender?.role === "discipline_director") return user.role === "discipline_director";
    return true;
  }

  function canShowMessageInFeed(message: Message) {
    if (!canShowMessageInConversation(message)) return false;
    if (!isParent) return true;
    return message.senderId === user.id || message.threadParentId === user.parentId || message.recipientParentId === user.parentId || message.recipientParentId === "all";
  }

  const notificationItems: NotificationFeedItem[] = notifications
    .filter((notification) => notification.type !== "message")
    .map((notification) => {
      const tone = messageTextTone(notification.title, notification.body);
      return {
        key: `notification-${notification.id}`,
        type: "notification" as const,
        notification,
        title: notification.title,
        preview: notification.body,
        createdAt: notification.createdAt,
        unread: !(notificationReadState.get(notification.id) ?? notification.read),
        direction: "received" as const,
        tone,
        notificationSenderLabel: tone === "warning" ? warningNotificationSenderLabel(notification) : undefined,
      };
    });
  const messages = Array.from(new Map<string, Message>([...yearData.messages, ...realtimeMessages].map((message) => [message.id, message])).values());
  const messageItems: MessageFeedItem[] = messages
    .filter(canShowMessageInFeed)
    .map((message) => ({
      key: `message-${message.id}`,
      type: "message" as const,
      message,
      createdAt: message.createdAt,
    }));
  const feedItems = Array.from(new Map<string, FeedItem>([...messageItems, ...notificationItems].map((item) => [item.key, item])).values()).sort(
    (a, b) => messageTimestamp(b.createdAt) - messageTimestamp(a.createdAt),
  );

  function messageTextTone(title?: string, preview?: string): NotificationFeedItem["tone"] {
    const text = `${title ?? ""} ${preview ?? ""}`.toLowerCase();
    if (text.includes("présence enregistrée")) return "attendance";
    if (text.includes("avertissement de paiement")) return "warning";
    if (text.includes("paiement enregistré")) return "payment";
    return undefined;
  }

  function notificationItemClassName(item: NotificationFeedItem) {
    if (item.tone === "warning") return "border-red-200 bg-red-50";
    if (item.tone === "payment") return "border-emerald-200 bg-emerald-50";
    if (item.tone === "attendance") return "border-blue-200 bg-blue-50";
    return item.unread ? "border-blue-200 bg-blue-50" : "border-slate-100 bg-slate-50";
  }

  function warningNotificationSenderLabel(notification: AppNotification) {
    const notificationTime = messageTimestamp(notification.createdAt);
    const matchingWarningLog = yearData.auditLogs
      .filter((log) => log.action === "Avertissement paiement")
      .map((log) => ({ log, delta: Math.abs(messageTimestamp(log.createdAt) - notificationTime) }))
      .filter((item) => item.delta <= 15000)
      .sort((a, b) => a.delta - b.delta)[0]?.log;
    if (!matchingWarningLog) return undefined;

    const actor = data.users.find((item) => item.id === matchingWarningLog.actorId) ?? yearData.users.find((item) => item.id === matchingWarningLog.actorId);
    let roleLabel = actor?.role === "cashier" ? "Caissier" : actor?.role === "school_admin" ? "Administrateur" : "";
    if (!roleLabel) {
      try {
        const details = JSON.parse(matchingWarningLog.details ?? "{}") as { actorRole?: string };
        roleLabel = details.actorRole ?? "";
      } catch {
        roleLabel = "";
      }
    }
    if (!roleLabel || !matchingWarningLog.actorName) return undefined;
    return `${roleLabel} : ${matchingWarningLog.actorName}`;
  }

  function cleanMessageSubject(subject?: string) {
    const trimmed = (subject ?? "").trim();
    const recipientLabelsToHide = ["Administrateur uniquement", "Caissier uniquement", "Administrateur et Caissier", "Directeur de Discipline"];
    const hiddenLabel = recipientLabelsToHide.find((label) => trimmed.toLowerCase().startsWith(label.toLowerCase()));
    if (!hiddenLabel) return trimmed;
    let cleaned = trimmed.slice(hiddenLabel.length).trimStart();
    while (cleaned.startsWith("-") || cleaned.startsWith(":") || cleaned.startsWith("–") || cleaned.startsWith("—")) {
      cleaned = cleaned.slice(1).trimStart();
    }
    return cleaned.trim();
  }

  function childShortName(student: Student) {
    return `${student.prenom} ${student.nom}`.trim();
  }

  function renderMessage(message: Message) {
    const sender = senderDetails(message);
    const senderIsParent = sender.type === "parent";
    const parentDisciplineMessage = isParentDisciplineMessage(message);
    const messageSubject = cleanMessageSubject(message.subject) || "Sans objet";
    const messageCardClassName = parentDisciplineMessage
      ? "border-red-200 bg-red-50"
      : senderIsParent
        ? "border-slate-700 bg-slate-800"
        : "border-slate-100 bg-slate-50";
    return (
      <article className={`rounded border p-3 text-sm ${messageCardClassName}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={`break-words font-semibold ${senderIsParent ? "text-white" : "text-ink"}`}>
              {sender.role && sender.role !== "École" ? `${sender.role} : ${sender.name}` : sender.name}
            </p>
            {sender.children.length > 0 && (
              <p className={`break-words text-xs font-semibold ${senderIsParent ? "text-slate-200" : "text-slate-500"}`}>
                Parent de : {sender.children.map(childShortName).join(", ")}
              </p>
            )}
          </div>
          <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${message.senderId === user.id ? "bg-ink text-white" : "bg-white text-slate-600"}`}>
            {message.senderId === user.id ? "Envoyé" : "Reçu"}
          </span>
        </div>
        <p className={`mt-3 break-words text-sm font-semibold ${senderIsParent ? "text-white" : "text-slate-700"}`}>
          {senderIsParent || parentDisciplineMessage ? `Objet : ${messageSubject}` : messageSubject}
        </p>
        <p className={`mt-1 whitespace-pre-wrap break-words text-sm leading-6 ${senderIsParent ? "text-slate-100" : "text-slate-600"}`}>{message.body}</p>
        <p className={`mt-2 text-xs ${senderIsParent ? "text-slate-300" : "text-slate-500"}`}>{formatFeedDate(message.createdAt)}</p>
      </article>
    );
  }

  function renderNotification(item: NotificationFeedItem) {
    return (
      <article className={`rounded border p-3 text-sm ${notificationItemClassName(item)}`}>
        <div className="flex items-start justify-between gap-3">
          <p className="break-words font-semibold text-slate-700">{item.title}</p>
          <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${item.unread ? "bg-blue-600 text-white" : "bg-white text-slate-500"}`}>
            {item.unread ? "Non lu" : "Lu"}
          </span>
        </div>
        {item.notificationSenderLabel && <p className="mt-1 break-words text-sm font-semibold text-slate-700">{item.notificationSenderLabel}</p>}
        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{item.preview}</p>
        <p className="mt-2 text-xs text-slate-500">{formatFeedDate(item.createdAt)}</p>
      </article>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded border border-slate-200 bg-white shadow-sm">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 p-3">
          <h3 className="text-sm font-bold text-ink">Messages et notifications</h3>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-500">{feedItems.length}</span>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 pr-2 scrollbar-thin">
          {feedItems.length === 0 && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucun message ou notification à afficher.</p>}
          {feedItems.map((item) => (
            <div key={item.key}>{item.type === "message" ? renderMessage(item.message) : renderNotification(item)}</div>
          ))}
          {notificationPagination}
        </div>
      </section>
    </div>
  );
}
