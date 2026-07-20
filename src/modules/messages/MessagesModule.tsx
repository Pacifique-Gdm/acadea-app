import { useEffect, useState } from "react";
import { MessageSquare, Search, X } from "lucide-react";
import { FormPanel } from "../../components/ui";
import { db } from "../../firebase";
import { persistMessageWithConversation } from "../../services/conversations";
import { canUseFirestoreData } from "../../services/firestoreData";
import { nextMessageThreadId } from "../../utils/messageThreads";
import { formatStudentClassName, getClassSection } from "../../utils/studentClasses";
import type { AppData, AppNotification, AppUser, Message, ParentProfile, School, SchoolClass, SchoolSection, SchoolYear, Student } from "../../types";

type MessagesYearData = {
  parents: ParentProfile[];
  students: Student[];
  messages: Message[];
};

type MessagesModuleProps = {
  user: AppUser;
  data: AppData;
  yearData: MessagesYearData;
  school: School;
  year: SchoolYear;
  updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void;
  createId: (prefix: string) => string;
};

export function MessagesModule({
  user,
  data,
  yearData,
  school,
  year,
  updateData,
  createId,
}: MessagesModuleProps) {
  const [recipientParentId, setRecipientParentId] = useState<string>("");
  const [adminRecipientMode, setAdminRecipientMode] = useState<"all" | "parents" | "sections" | "classes">("all");
  const [selectedAdminParentIds, setSelectedAdminParentIds] = useState<string[]>([]);
  const [selectedAdminSection, setSelectedAdminSection] = useState<SchoolSection | "">("");
  const [selectedAdminClass, setSelectedAdminClass] = useState<SchoolClass | "">("");
  const [selectedDisciplineParentIds, setSelectedDisciplineParentIds] = useState<string[]>([]);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [messageFeedback, setMessageFeedback] = useState("");
  const canSend = user.role !== "parent" && year.status !== "archived";
  const isSchoolAdmin = user.role === "school_admin";
  const isCashier = user.role === "cashier";
  const isDisciplineDirector = user.role === "discipline_director";
  const disciplineMessageSubjects = ["Avertissement disciplinaire", "Convocation", "Décision disciplinaire", "Notification de fin de sanction"];
  const sameSchoolParents = yearData.parents.filter((parent) => parent.schoolId === school.id);
  const sameSchoolStudents = yearData.students.filter((student) => student.schoolId === school.id);
  const sectionLabels: Record<SchoolSection, string> = {
    maternelle: "Maternelle",
    primaire: "Primaire",
    secondaire: "Secondaire",
  };
  const adminSectionChoices = Array.from(new Set(sameSchoolStudents.map((student) => getClassSection(student.className))));
  const adminClassChoices = Array.from(new Set(sameSchoolStudents.map((student) => student.className))).sort((first, second) => first.localeCompare(second, "fr"));
  const recipientCandidates = sameSchoolParents.map((parent) => ({
    parent,
    children: sameSchoolStudents.filter((student) => student.parentId === parent.id || parent.studentIds.includes(student.id)),
  }));
  const disciplineRecipientCandidates = recipientCandidates.filter(({ children }) => children.length > 0);
  const recipientResults = recipientCandidates.filter(({ parent, children }) => {
      const search = recipientSearch.trim().toLowerCase();
      if (!search) return false;
      const studentText = children.map((student) => `${student.nom} ${student.postnom} ${student.prenom} ${student.matricule} ${formatStudentClassName(student)}`).join(" ");
      return `${parent.fullName} ${parent.phone} ${parent.email} ${parent.address} ${studentText}`.toLowerCase().includes(search);
    });
  const disciplineRecipientResults = disciplineRecipientCandidates.filter(({ parent, children }) => {
      const search = recipientSearch.trim().toLowerCase();
      if (!search) return false;
      const studentText = children.map((student) => `${student.nom} ${student.postnom} ${student.prenom} ${student.matricule}`).join(" ");
      return `${parent.fullName} ${studentText}`.toLowerCase().includes(search);
    });
  const hasRecipientSearch = recipientSearch.trim().length > 0;
  const selectedParent = yearData.parents.find((parent) => parent.id === recipientParentId);
  const selectedAdminParents = sameSchoolParents.filter((parent) => selectedAdminParentIds.includes(parent.id));
  const selectedDisciplineParents = yearData.parents.filter((parent) => selectedDisciplineParentIds.includes(parent.id));

  function uniqueParents(parents: ParentProfile[]) {
    return Array.from(new Map(parents.filter((parent) => parent.schoolId === school.id).map((parent) => [parent.id, parent])).values());
  }

  function parentForStudent(student: Student) {
    const directParent = student.parentId ? sameSchoolParents.find((parent) => parent.id === student.parentId) : undefined;
    return directParent ?? sameSchoolParents.find((parent) => parent.studentIds.includes(student.id));
  }

  function resolveParentsForStudents(students: Student[]) {
    return uniqueParents(students.map(parentForStudent).filter((parent): parent is ParentProfile => Boolean(parent)));
  }

  function resolveAdminRecipientParents() {
    if (adminRecipientMode === "all") return uniqueParents(sameSchoolParents);
    if (adminRecipientMode === "parents") return uniqueParents(selectedAdminParents);
    if (adminRecipientMode === "sections") {
      if (!selectedAdminSection) return [];
      return resolveParentsForStudents(sameSchoolStudents.filter((student) => getClassSection(student.className) === selectedAdminSection));
    }
    if (!selectedAdminClass) return [];
    return resolveParentsForStudents(sameSchoolStudents.filter((student) => student.className === selectedAdminClass));
  }

  const adminResolvedParents = isSchoolAdmin ? resolveAdminRecipientParents() : [];

  useEffect(() => {
    if (!isDisciplineDirector || !messageFeedback) return undefined;
    const persistentErrorMarkers = ["Impossible", "Échec", "Echec", "non envoyé", "permission", "connexion indisponible"];
    if (persistentErrorMarkers.some((marker) => messageFeedback.includes(marker))) return undefined;
    const timer = window.setTimeout(() => setMessageFeedback(""), 4000);
    return () => window.clearTimeout(timer);
  }, [isDisciplineDirector, messageFeedback]);

  function toggleDisciplineParent(parentId: string) {
    setSelectedDisciplineParentIds((current) =>
      current.includes(parentId) ? current.filter((id) => id !== parentId) : [...current, parentId],
    );
  }

  function removeDisciplineParent(parentId: string) {
    setSelectedDisciplineParentIds((current) => current.filter((id) => id !== parentId));
  }

  function changeAdminRecipientMode(mode: "all" | "parents" | "sections" | "classes") {
    setAdminRecipientMode(mode);
    setRecipientSearch("");
    setSelectedAdminParentIds([]);
    setSelectedAdminSection("");
    setSelectedAdminClass("");
  }

  function toggleAdminParent(parentId: string) {
    setSelectedAdminParentIds((current) =>
      current.includes(parentId) ? current.filter((id) => id !== parentId) : [...current, parentId],
    );
  }

  function removeAdminParent(parentId: string) {
    setSelectedAdminParentIds((current) => current.filter((id) => id !== parentId));
  }

  async function sendMessage() {
    setMessageFeedback("");
    if (isSchoolAdmin && adminRecipientMode === "parents" && selectedAdminParentIds.length === 0) {
      setMessageFeedback("Message non envoyé. Aucun parent sélectionné.");
      return;
    }
    if (isSchoolAdmin && adminRecipientMode === "sections" && !selectedAdminSection) {
      setMessageFeedback("Message non envoyé. Aucune section sélectionnée.");
      return;
    }
    if (isSchoolAdmin && adminRecipientMode === "classes" && !selectedAdminClass) {
      setMessageFeedback("Message non envoyé. Aucune classe sélectionnée.");
      return;
    }
    const recipientParents = isSchoolAdmin
      ? adminResolvedParents
      : isDisciplineDirector
      ? selectedDisciplineParents
      : yearData.parents.filter((parent) => parent.id === recipientParentId && parent.schoolId === school.id);
    if (recipientParents.length === 0) {
      setMessageFeedback("Aucun parent destinataire n'a été trouvé pour cette sélection.");
      return;
    }
    const createdAt = new Date().toISOString();
    const schoolRecipient = user.role === "school_admin" ? "admin" : user.role === "cashier" ? "cashier" : user.role === "discipline_director" ? "discipline" : undefined;
    const visibleSchoolRecipients =
      user.role === "school_admin"
        ? ["admin", "both"]
        : user.role === "cashier"
          ? ["cashier", "both"]
          : user.role === "discipline_director"
            ? ["discipline"]
            : [];
    const threadMessages = schoolRecipient
      ? yearData.messages.filter((message) => !message.schoolRecipient || visibleSchoolRecipients.includes(message.schoolRecipient))
      : yearData.messages;
    const messages: Message[] = recipientParents.map((parent) => {
      const threadId = nextMessageThreadId(threadMessages, user.id, parent.id, parent.id, undefined, createId) ?? createId("thread");
      const existingThreadRecipient = threadMessages.find(
        (message) =>
          message.threadId === threadId &&
          message.threadParentId === parent.id &&
          message.schoolRecipient &&
          visibleSchoolRecipients.includes(message.schoolRecipient),
      )?.schoolRecipient;
      const message: Message = {
        id: createId("msg"),
        schoolId: school.id,
        schoolYearId: year.id,
        senderId: user.id,
        recipientParentId: parent.id,
        threadParentId: parent.id,
        threadId,
        subject,
        body,
        createdAt,
      };
      if (schoolRecipient) {
        message.schoolRecipient = existingThreadRecipient ?? schoolRecipient;
      }
      return message;
    });
    const notifications: AppNotification[] = messages.map((message) => ({
      id: createId("notif"),
      schoolId: school.id,
      schoolYearId: year.id,
      recipientRole: "parent",
      parentId: message.threadParentId,
      messageId: message.id,
      type: "message",
      title: user.role === "discipline_director" ? "Nouveau message discipline" : "Nouveau message de l'école",
      body: `${school.name}: ${subject}`,
      createdAt,
      read: false,
    }));
    if (canUseFirestoreData()) {
      if (!db) {
        setMessageFeedback("Message non envoyé. Veuillez réessayer.");
        return;
      }
      if (isDisciplineDirector) {
        const savedMessages: Message[] = [];
        const savedNotifications: AppNotification[] = [];
        const failedParentIds: string[] = [];
        for (const message of messages) {
          const notification = notifications.find((item) => item.messageId === message.id);
          if (!notification) continue;
          const parentName = recipientParents.find((parent) => parent.id === message.threadParentId)?.fullName;
          try {
            const savedMessage = await persistMessageWithConversation({ user, message, notification, parentName });
            savedMessages.push(savedMessage);
            savedNotifications.push(notification);
          } catch (error) {
            console.warn("Envoi du message discipline impossible pour un parent.", { parentId: message.threadParentId, error });
            if (message.threadParentId) failedParentIds.push(message.threadParentId);
          }
        }
        if (savedMessages.length > 0) {
          updateData(
            { messages: [...savedMessages, ...data.messages], notifications: [...savedNotifications, ...data.notifications] },
            { persist: false },
          );
        }
        if (failedParentIds.length === 0) {
          setSubject("");
          setBody("");
          setSelectedDisciplineParentIds([]);
          setMessageFeedback(`${savedMessages.length} message(s) envoyé(s).`);
          return;
        }
        setSelectedDisciplineParentIds(failedParentIds);
        setMessageFeedback(
          savedMessages.length > 0
            ? `${savedMessages.length} message(s) envoyé(s), ${failedParentIds.length} échec(s).`
            : "Message non envoyé. Veuillez réessayer.",
        );
        return;
      }
      try {
        const savedMessages: Message[] = [];
        for (const message of messages) {
          const notification = notifications.find((item) => item.messageId === message.id);
          if (notification) {
            const parentName = recipientParents.find((parent) => parent.id === message.threadParentId)?.fullName;
            const savedMessage = await persistMessageWithConversation({ user, message, notification, parentName });
            savedMessages.push(savedMessage);
          }
        }
        updateData(
          { messages: [...savedMessages, ...data.messages], notifications: [...notifications, ...data.notifications] },
          { persist: false },
        );
      } catch (error) {
        console.warn("Envoi du message impossible.", error);
        setMessageFeedback("Message non envoyé. Veuillez réessayer.");
        return;
      }
    } else {
      updateData({ messages: [...messages, ...data.messages], notifications: [...notifications, ...data.notifications] });
    }
    setSubject("");
    setBody("");
    if (isDisciplineDirector) {
      setSelectedDisciplineParentIds([]);
      setMessageFeedback(`${messages.length} message(s) envoyé(s).`);
      return;
    }
    if (isSchoolAdmin) {
      setSelectedAdminParentIds([]);
      setRecipientSearch("");
    }
    setMessageFeedback("Message envoyé avec succès.");
  }

  function clearSelectedRecipient() {
    setRecipientParentId("");
    setRecipientSearch("");
  }

  return (
    <section className="grid min-w-0 gap-4">
      {canSend && (
        <FormPanel title="Envoyer un message">
          <div className="grid min-w-0 gap-2">
            {isSchoolAdmin ? (
              <>
                <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
                  Destinataires
                  <select value={adminRecipientMode} onChange={(event) => changeAdminRecipientMode(event.target.value as "all" | "parents" | "sections" | "classes")} className="input">
                    <option value="all">Tous les parents</option>
                    <option value="parents">Sélection parent</option>
                    <option value="sections">Sections</option>
                    <option value="classes">Classes</option>
                  </select>
                </label>
                {adminRecipientMode === "parents" && (
                  <>
                    <label className="flex min-w-0 items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
                      <Search className="h-4 w-4 shrink-0 text-slate-400" />
                      <input
                        value={recipientSearch}
                        onChange={(event) => setRecipientSearch(event.target.value)}
                        className="min-w-0 flex-1 outline-none"
                        placeholder="Rechercher parent, téléphone ou email"
                      />
                    </label>
                    <div className="max-h-60 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
                      {hasRecipientSearch &&
                        recipientResults.map(({ parent, children }) => {
                          const selected = selectedAdminParentIds.includes(parent.id);
                          return (
                            <button
                              key={parent.id}
                              onClick={() => toggleAdminParent(parent.id)}
                              type="button"
                              className={`w-full rounded border p-3 text-left text-sm transition ${selected ? "border-blue-200 bg-blue-50" : "border-slate-100 bg-slate-50 hover:border-slate-200"}`}
                            >
                              <p className="font-semibold text-ink">{parent.fullName}</p>
                              <p className="text-xs text-slate-500">{parent.phone || "Téléphone non renseigné"} | {parent.email || "Email non renseigné"}</p>
                              <p className="text-xs text-slate-500">
                                {children.length
                                  ? children.map((student) => `${student.nom} ${student.prenom}${student.matricule ? ` | ${student.matricule}` : ""}`).join(" • ")
                                  : "Aucun enfant associé"}
                              </p>
                            </button>
                          );
                        })}
                      {!hasRecipientSearch && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Saisissez un nom, téléphone ou email pour rechercher un parent.</p>}
                      {hasRecipientSearch && recipientResults.length === 0 && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucun parent trouvé.</p>}
                    </div>
                  </>
                )}
                {adminRecipientMode === "sections" && (
                  <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
                    Section
                    <select value={selectedAdminSection} onChange={(event) => setSelectedAdminSection(event.target.value as SchoolSection | "")} className="input">
                      <option value="">Sélectionner une section</option>
                      {adminSectionChoices.map((section) => (
                        <option key={section} value={section}>{sectionLabels[section]}</option>
                      ))}
                    </select>
                  </label>
                )}
                {adminRecipientMode === "classes" && (
                  <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
                    Classe
                    <select value={selectedAdminClass} onChange={(event) => setSelectedAdminClass(event.target.value as SchoolClass | "")} className="input">
                      <option value="">Sélectionner une classe</option>
                      {adminClassChoices.map((className) => (
                        <option key={className} value={className}>{className}</option>
                      ))}
                    </select>
                  </label>
                )}
                {selectedAdminParents.length > 0 && (
                  <div className="grid gap-2 rounded bg-blue-50 p-3 text-sm font-semibold text-blue-700">
                    <p>{selectedAdminParents.length} parent(s) sélectionné(s)</p>
                    <div className="flex flex-wrap gap-2">
                      {selectedAdminParents.map((parent) => (
                        <span key={parent.id} className="inline-flex max-w-full items-center gap-2 rounded-full bg-white px-3 py-1 text-xs text-blue-700">
                          <span className="min-w-0 truncate">{parent.fullName}</span>
                          <button
                            type="button"
                            onClick={() => removeAdminParent(parent.id)}
                            className="shrink-0 rounded-full p-0.5 transition hover:bg-blue-100"
                            aria-label={`Retirer ${parent.fullName}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <p className="rounded bg-slate-50 p-3 text-sm font-semibold text-slate-600">
                  {adminResolvedParents.length} parent{adminResolvedParents.length > 1 ? "s" : ""} destinataire{adminResolvedParents.length > 1 ? "s" : ""}
                </p>
              </>
            ) : (
              <>
                <label className="flex min-w-0 items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
                  <Search className="h-4 w-4 shrink-0 text-slate-400" />
                  <input
                    value={recipientSearch}
                    onChange={(event) => setRecipientSearch(event.target.value)}
                    className="min-w-0 flex-1 outline-none"
                    placeholder={isCashier ? "Saisissez le nom d'un parent, d'un enfant ou un matricule." : "Rechercher parent, enfant ou matricule"}
                  />
                </label>
                <div className="max-h-60 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
                  {(isDisciplineDirector ? disciplineRecipientResults : hasRecipientSearch ? recipientResults : []).map(({ parent, children }) => {
                    const selected = isDisciplineDirector ? selectedDisciplineParentIds.includes(parent.id) : recipientParentId === parent.id;
                    return (
                      <button
                        key={parent.id}
                        onClick={() => (isDisciplineDirector ? toggleDisciplineParent(parent.id) : setRecipientParentId(parent.id))}
                        type="button"
                        className={`w-full rounded border p-3 text-left text-sm transition ${selected ? "border-blue-200 bg-blue-50" : "border-slate-100 bg-slate-50 hover:border-slate-200"}`}
                      >
                        <p className="font-semibold text-ink">{parent.fullName}</p>
                        <p className="text-xs text-slate-500">
                          {children.length
                            ? children.map((student) => `${student.nom} ${student.prenom}${student.matricule ? ` | ${student.matricule}` : ""} | ${formatStudentClassName(student)}`).join(" • ")
                            : "Aucun enfant associé"}
                        </p>
                      </button>
                    );
                  })}
                  {!hasRecipientSearch && !isDisciplineDirector && !isCashier && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Saisissez le nom d'un parent, d'un enfant ou un matricule.</p>}
                  {hasRecipientSearch && recipientResults.length === 0 && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucun parent trouvé.</p>}
                </div>
              </>
            )}
            {isDisciplineDirector && selectedDisciplineParents.length > 0 && (
              <div className="grid gap-2 rounded bg-blue-50 p-3 text-sm font-semibold text-blue-700">
                <p>{selectedDisciplineParents.length} parent(s) sélectionné(s)</p>
                <div className="flex flex-wrap gap-2">
                  {selectedDisciplineParents.map((parent) => (
                    <span key={parent.id} className="inline-flex max-w-full items-center gap-2 rounded-full bg-white px-3 py-1 text-xs text-blue-700">
                      <span className="min-w-0 truncate">{parent.fullName}</span>
                      <button
                        type="button"
                        onClick={() => removeDisciplineParent(parent.id)}
                        className="shrink-0 rounded-full p-0.5 transition hover:bg-blue-100"
                        aria-label={`Retirer ${parent.fullName}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {!isSchoolAdmin && !isDisciplineDirector && selectedParent && (
              <div className="flex min-w-0 items-center justify-between gap-3 rounded bg-blue-50 p-3 text-sm font-semibold text-blue-700">
                <p className="min-w-0 truncate">Destinataire : {selectedParent.fullName}</p>
                <button
                  type="button"
                  onClick={clearSelectedRecipient}
                  className="shrink-0 rounded-full p-1 text-blue-600 transition hover:bg-blue-100 hover:text-blue-800"
                  aria-label="Retirer le destinataire"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
          {user.role === "discipline_director" ? (
            <select value={subject} onChange={(event) => setSubject(event.target.value)} className="input">
              <option value="">Choisir le type de message</option>
              {disciplineMessageSubjects.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          ) : (
            <input value={subject} onChange={(event) => setSubject(event.target.value)} className="input" placeholder="Objet" />
          )}
          <textarea value={body} onChange={(event) => setBody(event.target.value)} className="input min-h-32" placeholder="Message" />
          {messageFeedback && (
            <p
              className={`rounded px-3 py-2 text-sm font-semibold ${
                messageFeedback === "Message envoyé avec succès." || messageFeedback.endsWith("message(s) envoyé(s).")
                  ? "bg-mint/10 text-mint"
                  : messageFeedback.includes("échec")
                    ? "border border-amber-200 bg-amber-50 text-amber-700"
                    : "border border-red-200 bg-red-50 text-red-700"
              }`}
            >
              {messageFeedback}
            </p>
          )}
          <button onClick={sendMessage} disabled={!subject || !body || (isDisciplineDirector && selectedDisciplineParentIds.length === 0) || (isCashier && !recipientParentId)} className="primary-button disabled:opacity-50">
            <MessageSquare className="h-4 w-4" /> Envoyer
          </button>
        </FormPanel>
      )}
    </section>
  );
}
