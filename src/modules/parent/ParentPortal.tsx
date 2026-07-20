import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ArrowLeft, BookOpen, Clock3, Download, LogOut, MessageSquare, UserRound } from "lucide-react";
import { AdminDrawer, FormPanel, Metric } from "../../components/ui";
import { ValvesDrawerContent } from "../../components/valves/ValvesDrawerContent";
import { db } from "../../firebase";
import { markConversationUnreadCountRead } from "../../services/conversations";
import { canUseFirestoreData } from "../../services/firestoreData";
import { markNotificationsReadTargeted } from "../../services/notificationsPagination";
import { fetchParentMessageQuota, sendParentMessageWithQuota } from "../../services/parentMessaging";
import type { ParentMessageQuota } from "../../services/parentMessaging";
import { buildSchoolYearDataIndexes } from "../../utils/dataIndexes";
import { resolvePaymentCashierName } from "../../utils/finance";
import { nextMessageThreadId } from "../../utils/messageThreads";
import { generateReceiptPdf, money } from "../../utils/pdf";
import { getStudentFeeSummaries } from "../../utils/studentFeeSummary";
import { formatStudentClassName } from "../../utils/studentClasses";
import type { AppData, AppNotification, AppUser, AuditLog, FeeType, Message, ParentProfile, Payment, School, SchoolYear, Student, ValvePublication } from "../../types";

type ParentTab = "children" | "messages" | "menu";

type ParentYearData = {
  students: Student[];
  parents: ParentProfile[];
  feeTypes: FeeType[];
  payments: Payment[];
  notifications: AppNotification[];
  messages: Message[];
  auditLogs: AuditLog[];
  valves: ValvePublication[];
};

type ParentHeaderRenderProps = {
  unreadNotifications: number;
  notificationsOpen: boolean;
  onToggleNotifications: () => void;
  onCloseNotifications: () => void;
  onRealtimeNotifications: (notifications: AppNotification[]) => void;
  onRealtimeMessages: (messages: Message[]) => void;
};

type ParentPortalProps = {
  user: AppUser;
  data: AppData;
  yearData: ParentYearData;
  school: School;
  year: SchoolYear;
  updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void;
  onLogout: () => void;
  renderEnvironmentBanner: () => ReactNode;
  renderHeader: (props: ParentHeaderRenderProps) => ReactNode;
  renderBottomNavigation: (activeTab: ParentTab, onTab: (tab: ParentTab) => void) => ReactNode;
  renderActivityHistory: () => ReactNode;
  createId: (prefix: string) => string;
  mergeNotificationsById: (currentItems: AppNotification[], nextItems: AppNotification[]) => AppNotification[];
  mergeMessagesById: (currentItems: Message[], nextItems: Message[]) => Message[];
  maxValveDocumentBytes: number;
};

export function ParentPortal({
  user,
  data,
  yearData,
  school,
  year,
  updateData,
  onLogout,
  renderEnvironmentBanner,
  renderHeader,
  renderBottomNavigation,
  renderActivityHistory,
  createId,
  mergeNotificationsById,
  mergeMessagesById,
  maxValveDocumentBytes,
}: ParentPortalProps) {
  const [activeParentTab, setActiveParentTab] = useState<ParentTab>("children");
  const [parentAccountOpen, setParentAccountOpen] = useState(false);
  const [parentHistoryOpen, setParentHistoryOpen] = useState(false);
  const [parentValvesOpen, setParentValvesOpen] = useState(false);
  const [parentMessageDrawerOpen, setParentMessageDrawerOpen] = useState(false);
  const [messageRecipient, setMessageRecipient] = useState<"admin" | "cashier" | "both" | "discipline">("admin");
  const [messageSubject, setMessageSubject] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [messageFeedback, setMessageFeedback] = useState("");
  const [selectedParentChildId, setSelectedParentChildId] = useState<string | null>(null);
  const [parentMessageQuota, setParentMessageQuota] = useState<ParentMessageQuota | null>(null);
  const [isParentMessageQuotaLoading, setIsParentMessageQuotaLoading] = useState(false);
  const [isSendingParentMessage, setIsSendingParentMessage] = useState(false);
  const parent = yearData.parents.find((item) => item.id === user.parentId);
  const unread = yearData.notifications.filter((notification) => !notification.read).length;
  const isParentMessageFormComplete = messageSubject.trim().length > 0 && messageBody.trim().length > 0;
  const parentMessageQuotaReached = parentMessageQuota ? parentMessageQuota.messageCount >= parentMessageQuota.limit : false;
  const parentIndexes = useMemo(() => buildSchoolYearDataIndexes(yearData.students, yearData.feeTypes, yearData.payments), [yearData.students, yearData.feeTypes, yearData.payments]);
  const selectedParentChild = yearData.students.find((student) => student.id === selectedParentChildId);
  const recipientLabels = {
    admin: "Administrateur uniquement",
    cashier: "Caissier uniquement",
    both: "Administrateur et Caissier",
    discipline: "Directeur de Discipline",
  } as const;

  function progressBarTone(percent: number) {
    if (percent >= 100) return "bg-mint";
    if (percent >= 75) return "bg-lime-400";
    if (percent >= 50) return "bg-amber-400";
    return "bg-red-500";
  }

  useEffect(() => {
    if (!canUseFirestoreData() || !user.parentId || !year.id) {
      setParentMessageQuota(null);
      return undefined;
    }
    let cancelled = false;
    setIsParentMessageQuotaLoading(true);
    fetchParentMessageQuota(year.id)
      .then((quota) => {
        if (!cancelled) setParentMessageQuota(quota);
      })
      .catch((error) => {
        console.warn("Chargement du quota messages parent impossible.", error);
      })
      .finally(() => {
        if (!cancelled) setIsParentMessageQuotaLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user.parentId, year.id]);

  useEffect(() => {
    if (activeParentTab !== "children") {
      setSelectedParentChildId(null);
    }
  }, [activeParentTab]);

  useEffect(() => {
    if (selectedParentChildId && !yearData.students.some((student) => student.id === selectedParentChildId)) {
      setSelectedParentChildId(null);
    }
  }, [selectedParentChildId, yearData.students]);

  useEffect(() => {
    if (messageFeedback !== "Message envoyé avec succès.") return undefined;
    const timer = window.setTimeout(() => setMessageFeedback(""), 4000);
    return () => window.clearTimeout(timer);
  }, [messageFeedback]);

  useEffect(() => {
    if (!parentMessageQuota?.windowExpiresAt || !user.parentId || !year.id) return undefined;
    const expiresAt = new Date(parentMessageQuota.windowExpiresAt).getTime();
    const delay = expiresAt - Date.now();
    if (!Number.isFinite(delay) || delay <= 0) {
      void fetchParentMessageQuota(year.id).then(setParentMessageQuota).catch(() => undefined);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      void fetchParentMessageQuota(year.id).then(setParentMessageQuota).catch(() => undefined);
    }, delay + 1000);
    return () => window.clearTimeout(timer);
  }, [parentMessageQuota?.windowExpiresAt, user.parentId, year.id]);

  function markNotificationsRead() {
    updateData(
      {
        notifications: data.notifications.map((notification) =>
          notification.parentId === user.parentId && notification.schoolYearId === year.id ? { ...notification, read: true } : notification,
        ),
      },
      { persist: false },
    );
    void markNotificationsReadTargeted(user, school.id, year.id).catch((error) => {
      console.warn("Marquage ciblé des notifications parent impossible.", error);
    });
    void markConversationUnreadCountRead(user, school.id, year.id).catch((error) => {
      console.warn("Remise à zéro des compteurs de conversation impossible.", error);
    });
  }

  function openParentMessagesDrawer() {
    setParentMessageDrawerOpen(true);
  }

  function closeParentMessagesDrawer() {
    setParentMessageDrawerOpen(false);
    markNotificationsRead();
  }

  function toggleParentMessagesDrawer() {
    if (parentMessageDrawerOpen) {
      closeParentMessagesDrawer();
      return;
    }
    openParentMessagesDrawer();
  }

  async function sendParentMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSendingParentMessage) return;
    setMessageFeedback("");
    const subject = messageSubject.trim();
    const body = messageBody.trim();

    if (!user.parentId) {
      setMessageFeedback("Veuillez renseigner le destinataire, l'objet et le message.");
      return;
    }
    if (!subject) {
      setMessageFeedback("L'objet du message est obligatoire. Veuillez le renseigner avant l'envoi.");
      return;
    }
    if (!body) {
      setMessageFeedback("Veuillez renseigner le contenu du message.");
      return;
    }
    if (parentMessageQuotaReached) {
      setMessageFeedback("Vous avez atteint la limite de 3 messages pour 12 heures.");
      return;
    }

    const recipientLabel = recipientLabels[messageRecipient];
    const createdAt = new Date().toISOString();
    const threadId = nextMessageThreadId(yearData.messages, user.id, "school", user.parentId, undefined, createId) ?? createId("thread");
    const message: Message = {
      id: createId("msg"),
      schoolId: school.id,
      schoolYearId: year.id,
      senderId: user.id,
      recipientParentId: "school",
      schoolRecipient: messageRecipient,
      threadParentId: user.parentId,
      threadId,
      subject: `${recipientLabel} - ${subject}`,
      body,
      createdAt,
    };
    const notification: AppNotification = {
      id: createId("notif"),
      schoolId: school.id,
      schoolYearId: year.id,
      recipientRole: "school",
      schoolRecipient: messageRecipient,
      messageId: message.id,
      type: "message",
      title: `Nouveau message parent - ${recipientLabel}`,
      body: `${parent?.fullName ?? user.name} : ${subject}`,
      createdAt,
      read: false,
    };

    if (canUseFirestoreData()) {
      if (!db) {
        setMessageFeedback("Message non envoyé. Veuillez réessayer.");
        return;
      }
      setIsSendingParentMessage(true);
      try {
        const result = await sendParentMessageWithQuota({
          schoolYearId: year.id,
          recipient: messageRecipient,
          subject,
          body,
        });

        updateData(
          { messages: [result.message, ...data.messages], notifications: [result.notification, ...data.notifications] },
          { persist: false },
        );
        setParentMessageQuota(result.quota);
      } catch (error) {
        console.warn("Envoi du message parent impossible.", error);
        const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
        if (code === "quota-exceeded") {
          setMessageFeedback("Vous avez atteint la limite de 3 messages pour 12 heures.");
          void fetchParentMessageQuota(year.id).then(setParentMessageQuota).catch(() => undefined);
        } else if (code === "api-unavailable") {
          setMessageFeedback("Service d'envoi indisponible dans cet environnement. Lancez Acadéa avec npx vercel dev.");
        } else if (code === "not-authorized") {
          setMessageFeedback("Votre session ou vos permissions ne permettent pas cet envoi. Reconnectez-vous.");
        } else if (code === "server-error") {
          setMessageFeedback("Une erreur serveur empêche l'envoi. Veuillez réessayer.");
        } else if (code === "network-error") {
          setMessageFeedback("Connexion indisponible. Veuillez réessayer.");
        } else {
          setMessageFeedback("Message non envoyé. Veuillez réessayer.");
        }
        return;
      } finally {
        setIsSendingParentMessage(false);
      }
    } else {
      updateData({ messages: [message, ...data.messages], notifications: [notification, ...data.notifications] });
    }
    setMessageSubject("");
    setMessageBody("");
    setMessageRecipient("admin");
    setMessageFeedback("Message envoyé avec succès.");
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f6f8fb]">
      {renderEnvironmentBanner()}
      {renderHeader({
        unreadNotifications: unread,
        notificationsOpen: parentMessageDrawerOpen,
        onToggleNotifications: toggleParentMessagesDrawer,
        onCloseNotifications: closeParentMessagesDrawer,
        onRealtimeNotifications: (notifications: AppNotification[]) => {
          if (notifications.length === 0) return;
          updateData({ notifications: mergeNotificationsById(data.notifications, notifications) }, { persist: false });
        },
        onRealtimeMessages: (messages: Message[]) => {
          if (messages.length === 0) return;
          updateData({ messages: mergeMessagesById(data.messages, messages) }, { persist: false });
        },
      })}
      <main className="mx-auto grid w-full max-w-7xl min-w-0 flex-1 gap-4 overflow-y-auto px-3 py-5 pb-28 sm:px-6 sm:pb-32 lg:px-8">
        {activeParentTab === "children" && !selectedParentChild && (
          <section className="min-w-0 rounded border border-slate-200 bg-white p-4">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h1 className="text-2xl font-bold text-ink">Mes enfants</h1>
                <p className="break-words text-sm text-slate-500">Consultation limitée aux élèves rattachés à ce parent.</p>
              </div>
            </div>
          </section>
        )}

        <section className="grid min-w-0 gap-4">
          {activeParentTab === "children" && (
          <div className="grid min-w-0 gap-4">
            {selectedParentChild && (
              <section className="min-w-0 rounded border border-slate-200 bg-white p-4">
                <button
                  onClick={() => setSelectedParentChildId(null)}
                  className="inline-flex items-center gap-2 rounded bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
                  type="button"
                >
                  <ArrowLeft className="h-4 w-4" /> Retour aux enfants
                </button>
                <div className="mt-4 min-w-0">
                  <h2 className="break-words text-xl font-bold text-ink">
                    {selectedParentChild.nom} {selectedParentChild.postnom} {selectedParentChild.prenom}
                  </h2>
                  <p className="break-words text-sm text-slate-500">Fiche détaillée et historique des paiements.</p>
                </div>
              </section>
            )}
            {(selectedParentChild ? [selectedParentChild] : yearData.students).map((student) => {
              const feeSummaries = getStudentFeeSummaries(student, yearData.feeTypes, yearData.payments, parentIndexes);
              const feeTotals = feeSummaries.reduce(
                (totals, summary) => ({
                  expected: totals.expected + summary.expected,
                  paid: totals.paid + summary.paid,
                  remaining: totals.remaining + summary.remaining,
                }),
                { expected: 0, paid: 0, remaining: 0 },
              );
              const progress = feeTotals.expected > 0 ? Math.min(100, Math.round((feeTotals.paid / feeTotals.expected) * 100)) : 0;
              const progressTone = progressBarTone(progress);
              const payments = [...(parentIndexes.paymentsByStudentId.get(student.id) ?? [])].sort((first, second) => {
                const firstTime = new Date(first.createdAt ?? first.paidAt).getTime();
                const secondTime = new Date(second.createdAt ?? second.paidAt).getTime();
                return (Number.isNaN(secondTime) ? 0 : secondTime) - (Number.isNaN(firstTime) ? 0 : firstTime);
              });
              if (selectedParentChild) {
                return (
                  <article key={student.id} className="min-w-0 rounded border border-slate-200 bg-white p-4">
                    <p className="mb-2 text-sm font-semibold text-ink">Historique des paiements</p>
                    <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1 scrollbar-thin">
                      {payments.length === 0 && <p className="text-sm text-slate-500">Aucun paiement enregistré.</p>}
                      {payments.map((payment) => {
                        const fee = parentIndexes.feeTypesById.get(payment.feeTypeId);
                        return (
                          <div key={payment.id} className="min-w-0 rounded bg-slate-50 p-3 text-sm">
                            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0">
                                <span className="font-semibold text-ink">${payment.amount}</span>
                                <span className="break-words text-slate-500"> | {fee?.name ?? "Frais"} | {payment.paidAt}</span>
                              </div>
                              <button
                                onClick={() => fee && generateReceiptPdf(payment, student, fee, school, resolvePaymentCashierName(payment, yearData.auditLogs))}
                                disabled={!fee}
                                className="inline-flex w-full items-center justify-center gap-2 rounded bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                                title="Télécharger le reçu PDF"
                                type="button"
                              >
                                <Download className="h-4 w-4" /> PDF
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                );
              }
              return (
                <article key={student.id} className="min-w-0 rounded border border-slate-200 bg-white p-4">
                  <div className="flex min-w-0 flex-col gap-4 md:flex-row">
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded bg-slate-100 text-xl font-bold text-ink">
                      {student.photoUrl ? <img src={student.photoUrl} alt="" className="h-full w-full object-cover" /> : student.prenom.slice(0, 1)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <button
                            onClick={() => setSelectedParentChildId(student.id)}
                            className="break-words text-left text-xl font-bold text-ink transition hover:text-mint"
                            type="button"
                          >
                            {student.nom} {student.postnom} {student.prenom}
                          </button>
                          <p className="break-words text-sm text-slate-500">{formatStudentClassName(student)} | {year.name}</p>
                        </div>
                        <span className="shrink-0 rounded bg-mint/10 px-2 py-1 text-xs font-semibold text-mint">{progress}% payé</span>
                      </div>
                      <div className="mt-4 h-3 overflow-hidden rounded bg-slate-100">
                        <div className={`h-full rounded transition-colors ${progressTone}`} style={{ width: `${progress}%` }} />
                      </div>
                      <div className="mt-4 grid gap-2 sm:grid-cols-3">
                        <Metric label="Total frais" value={money(feeTotals.expected)} />
                        <Metric label="Total payé" value={money(feeTotals.paid)} />
                        <Metric label="Solde" value={money(feeTotals.remaining)} />
                      </div>
                      <div className="mt-4 rounded border border-slate-100 bg-slate-50 p-3">
                        <p className="mb-3 text-sm font-semibold text-ink">Progression par type de frais</p>
                        <div className="grid gap-3">
                          {feeSummaries.length === 0 && <p className="text-sm text-slate-500">Aucun frais défini pour cette classe.</p>}
                          {feeSummaries.map((summary) => {
                            const summaryProgress = summary.expected > 0 ? Math.min(100, Math.round((summary.paid / summary.expected) * 100)) : 0;
                            const summaryProgressTone = progressBarTone(summaryProgress);
                            return (
                              <div key={summary.feeTypeId} className="min-w-0 rounded bg-white p-3 shadow-sm">
                                <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                  <p className="break-words text-sm font-bold text-ink">{summary.feeName}</p>
                                  <p className="break-words text-xs font-semibold text-slate-500">
                                    {money(summary.paid)} / {money(summary.expected)}
                                  </p>
                                </div>
                                <div className="mt-2 h-2 overflow-hidden rounded bg-slate-100">
                                  <div className={`h-full rounded transition-colors ${summaryProgressTone}`} style={{ width: `${summaryProgress}%` }} />
                                </div>
                                <div className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
                                  <span>Attendu : <strong>{money(summary.expected)}</strong></span>
                                  <span>Payé : <strong>{money(summary.paid)}</strong></span>
                                  <span>Solde : <strong>{money(summary.remaining)}</strong></span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          )}

          {activeParentTab === "messages" && (
            <FormPanel title="Message">
              <form onSubmit={sendParentMessage} className="grid min-w-0 gap-4">
                <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
                  Destinataire
                  <select
                    value={messageRecipient}
                    onChange={(event) => setMessageRecipient(event.target.value as "admin" | "cashier" | "both" | "discipline")}
                    className="min-w-0 rounded border border-slate-200 px-3 py-2 text-sm"
                  >
                    <option value="admin">Administrateur uniquement</option>
                    <option value="cashier">Caissier uniquement</option>
                    <option value="both">Administrateur et Caissier</option>
                    <option value="discipline">Directeur de Discipline</option>
                  </select>
                </label>
                <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
                  Objet
                  <input
                    value={messageSubject}
                    onChange={(event) => setMessageSubject(event.target.value)}
                    className="min-w-0 rounded border border-slate-200 px-3 py-2 text-sm"
                    placeholder="Objet du message"
                  />
                </label>
                <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
                  Message
                  <textarea
                    value={messageBody}
                    onChange={(event) => setMessageBody(event.target.value)}
                    className="min-h-36 min-w-0 rounded border border-slate-200 px-3 py-2 text-sm"
                    placeholder="Rédigez votre message"
                  />
                </label>
                {messageFeedback && (
                  <p
                    className={`rounded px-3 py-2 text-sm font-semibold ${
                      messageFeedback === "Message envoyé avec succès." ? "bg-mint/10 text-mint" : "border border-red-200 bg-red-50 text-red-700"
                    }`}
                  >
                    {messageFeedback}
                  </p>
                )}
                <div className="grid gap-1 rounded bg-slate-50 p-3 text-sm text-slate-600">
                  <p className="font-semibold">
                    Messages envoyés sur 12 heures : {parentMessageQuota ? parentMessageQuota.messageCount : 0}/3
                    {isParentMessageQuotaLoading ? " · Chargement..." : ""}
                  </p>
                  {parentMessageQuotaReached && (
                    <p className="text-red-600">Vous avez atteint la limite de 3 messages pour 12 heures. L'envoi sera de nouveau possible à la fin de cette période.</p>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={!isParentMessageFormComplete || parentMessageQuotaReached || isSendingParentMessage}
                  className="primary-button transition disabled:cursor-not-allowed disabled:opacity-50 disabled:blur-[0.2px]"
                >
                  <MessageSquare className="h-4 w-4" /> {isSendingParentMessage ? "Envoi..." : "Envoyer"}
                </button>
              </form>
            </FormPanel>
          )}
        </section>

        {activeParentTab === "menu" && (
          <section className="grid min-w-0 gap-4">
            <div className="mt-2 grid gap-3">
              <button
                onClick={() => setParentValvesOpen(true)}
                className="min-w-0 rounded border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-mint"
                type="button"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-100 text-ink">
                    <BookOpen className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="break-words font-bold text-ink">Valves</h2>
                    <p className="mt-1 break-words text-sm text-slate-500">Consulter les communiqués et documents publiés par l'école.</p>
                  </div>
                </div>
              </button>
              <button
                onClick={() => setParentAccountOpen(true)}
                className="min-w-0 rounded border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-mint"
                type="button"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-100 text-ink">
                    <UserRound className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="break-words font-bold text-ink">Compte parent</h2>
                    <p className="mt-1 break-words text-sm text-slate-500">Consulter les informations du compte parent.</p>
                  </div>
                </div>
              </button>
              <button
                onClick={() => setParentHistoryOpen(true)}
                className="min-w-0 rounded border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-mint"
                type="button"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-100 text-ink">
                    <Clock3 className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="break-words font-bold text-ink">Historique</h2>
                    <p className="mt-1 break-words text-sm text-slate-500">Activités et messages liés à ce compte parent.</p>
                  </div>
                </div>
              </button>
              <button onClick={onLogout} className="inline-flex w-full items-center justify-center gap-2 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 transition hover:bg-red-100" type="button">
                <LogOut className="h-4 w-4" /> Déconnexion
              </button>
            </div>
          </section>
        )}
      </main>

      {parentAccountOpen && (
        <AdminDrawer title="Compte parent" onClose={() => setParentAccountOpen(false)} closeLabel="Fermer le compte parent">
          <div className="rounded border border-slate-200 bg-white p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Metric label="Parent" value={parent?.fullName ?? user.name} />
              <Metric label="Email" value={user.email} />
              <Metric label="École" value={school.name} />
              <Metric label="Année scolaire" value={year.name} />
              <Metric label="Enfant(s)" value={String(yearData.students.length)} />
              <Metric label="Notification(s)" value={String(unread)} />
            </div>
          </div>
        </AdminDrawer>
      )}
      {parentHistoryOpen && (
        <AdminDrawer title="Historique" onClose={() => setParentHistoryOpen(false)} closeLabel="Fermer l'historique">
          {renderActivityHistory()}
        </AdminDrawer>
      )}
      {parentValvesOpen && (
        <AdminDrawer title="Valves" onClose={() => setParentValvesOpen(false)} closeLabel="Fermer les valves">
          <ValvesDrawerContent
            user={user}
            data={data}
            yearData={yearData}
            school={school}
            year={year}
            updateData={updateData}
            canManage={false}
            createId={createId}
            maxValveDocumentBytes={maxValveDocumentBytes}
          />
        </AdminDrawer>
      )}

      {renderBottomNavigation(activeParentTab, (tab: ParentTab) => {
          closeParentMessagesDrawer();
          setActiveParentTab(tab);
        })}
    </div>
  );
}
