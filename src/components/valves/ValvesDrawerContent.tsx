import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { deleteDoc, doc } from "firebase/firestore";
import { Edit3, Trash2, Upload } from "lucide-react";
import { Field } from "../ui";
import { AttachmentsList } from "./AttachmentsList";
import type { ValveAttachmentListItem } from "./AttachmentsList";
import { AttachmentViewer } from "./AttachmentViewer";
import { db } from "../../firebase";
import { persistFirestorePatch } from "../../services/firestoreData";
import { deleteValveAttachments, uploadValveAttachments } from "../../services/valvesStorage";
import type {
  AppData,
  AppNotification,
  AppUser,
  AuditLog,
  ParentProfile,
  School,
  SchoolYear,
  Student,
  ValvePublication,
  ValvePublicationAttachment,
  ValvePublicationKind,
  ValveVisibility,
} from "../../types";
import { buildValveClassChoices, formatValveClassChoiceLabel, getValvePublicationParents, normalizeValveVisibility, parentCanViewValvePublication } from "../../utils/valves";
import { prepareValveAttachments } from "../../utils/valvesMedia";

const valveKindLabels: Record<ValvePublicationKind, string> = {
  communique: "Communiqué",
  palmares: "Palmarès",
  points: "Points",
  image: "Image",
  liste: "Liste",
  pdf: "PDF",
  document: "Document",
  autre: "Autre",
};

const valveVisibilityLabels: Record<ValveVisibility, string> = {
  all_parents: "Tous les parents",
  maternelle: "Maternelle",
  primaire: "Primaire",
  secondaire: "Secondaire",
  class: "Classe précise",
};

export type ValveAttachmentDraft = {
  name: string;
  type: string;
  dataUrl?: string;
  url?: string;
  path?: string;
  size: number;
};

type ValvesYearData = {
  parents: ParentProfile[];
  students: Student[];
  valves: ValvePublication[];
};

export function ValvesDrawerContent({
  user,
  data,
  yearData,
  school,
  year,
  updateData,
  canManage,
  valvesUploadsEnabled = true,
  createId,
  createAuditLog,
  getPublicationAttachmentDrafts,
  getPublicationDownloadAttachments,
  getValveAttachmentKey,
  validateValveAttachmentDrafts,
  getValvePublicationErrorMessage,
  getApproximateValveDocumentSize,
  maxValveDocumentBytes,
}: {
  user: AppUser;
  data: AppData;
  yearData: ValvesYearData;
  school: School;
  year: SchoolYear;
  updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void;
  canManage: boolean;
  valvesUploadsEnabled?: boolean;
  createId: (prefix: string) => string;
  createAuditLog: (user: AppUser, schoolId: string, schoolYearId: string, action: string, details: string) => AuditLog;
  getPublicationAttachmentDrafts: (publication: ValvePublication) => ValveAttachmentDraft[];
  getPublicationDownloadAttachments: (publication: ValvePublication) => ValveAttachmentListItem[];
  getValveAttachmentKey: (attachment: Pick<ValveAttachmentDraft, "name" | "size" | "path" | "url">) => string;
  validateValveAttachmentDrafts: (attachments: ValveAttachmentDraft[]) => string;
  getValvePublicationErrorMessage: (error: unknown, fallback: string) => string;
  getApproximateValveDocumentSize: (publication: ValvePublication) => number;
  maxValveDocumentBytes: number;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<ValvePublicationKind>("communique");
  const [visibility, setVisibility] = useState<ValveVisibility>("all_parents");
  const [targetClassKey, setTargetClassKey] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<ValveAttachmentDraft[]>([]);
  const [editingId, setEditingId] = useState("");
  const [modifyConfirmation, setModifyConfirmation] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ValvePublication | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [feedback, setFeedback] = useState("");
  const [isPreparingAttachment, setIsPreparingAttachment] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishProgress, setPublishProgress] = useState("");
  const [selectedAttachment, setSelectedAttachment] = useState<ValveAttachmentListItem | null>(null);
  const attachmentReadIdRef = useRef(0);
  const isPublishingRef = useRef(false);
  const currentParent = user.parentId ? yearData.parents.find((parent) => parent.id === user.parentId) : undefined;
  const valveClassChoices = buildValveClassChoices(yearData.students, targetClassKey);
  const canReadSchoolValves = user.role === "cashier" || user.role === "discipline_director";
  const visiblePublications = [...yearData.valves]
    .filter((publication) => canManage || canReadSchoolValves || (currentParent ? parentCanViewValvePublication(publication, currentParent, yearData.students) : false))
    .sort((first, second) => second.createdAt.localeCompare(first.createdAt));

  function resetForm() {
    attachmentReadIdRef.current += 1;
    setTitle("");
    setKind("communique");
    setVisibility("all_parents");
    setTargetClassKey("");
    setBody("");
    setAttachments([]);
    setIsPreparingAttachment(false);
    setPublishProgress("");
    setEditingId("");
    setModifyConfirmation("");
  }

  function clearAttachment() {
    attachmentReadIdRef.current += 1;
    setAttachments([]);
    setIsPreparingAttachment(false);
  }

  function removeAttachment(index: number) {
    setAttachments((currentAttachments) => currentAttachments.filter((_, itemIndex) => itemIndex !== index));
  }

  async function readAttachments(fileList?: FileList | null) {
    const readId = attachmentReadIdRef.current + 1;
    attachmentReadIdRef.current = readId;
    setFeedback("");
    if (!valvesUploadsEnabled) {
      setFeedback("Les nouvelles pièces jointes sont temporairement suspendues pour maîtriser les coûts de stockage.");
      return;
    }
    const files = Array.from(fileList ?? []);
    if (files.length === 0) {
      setIsPreparingAttachment(false);
      return;
    }
    setIsPreparingAttachment(true);
    try {
      const preparedAttachments = await prepareValveAttachments(files);
      if (attachmentReadIdRef.current !== readId) return;
      setAttachments((currentAttachments) => {
        const nextAttachments = [...currentAttachments];
        for (const preparedAttachment of preparedAttachments) {
          const attachmentKey = getValveAttachmentKey(preparedAttachment);
          if (!nextAttachments.some((attachment) => getValveAttachmentKey(attachment) === attachmentKey)) {
            nextAttachments.push(preparedAttachment);
          }
        }
        const validationError = validateValveAttachmentDrafts(nextAttachments);
        if (validationError) {
          setFeedback(validationError);
          return currentAttachments;
        }
        return nextAttachments;
      });
    } catch (error) {
      if (attachmentReadIdRef.current !== readId) return;
      setFeedback(getValvePublicationErrorMessage(error, "Impossible de lire le fichier joint. Veuillez réessayer."));
    } finally {
      if (attachmentReadIdRef.current === readId) {
        setIsPreparingAttachment(false);
      }
    }
  }

  async function savePublication() {
    if (isPublishingRef.current || isPreparingAttachment) return;
    isPublishingRef.current = true;
    setIsPublishing(true);
    setFeedback("");
    let uploadedAttachmentPathsToRollback: string[] = [];
    try {
      const trimmedTitle = title.trim();
      const trimmedBody = body.trim();
      if (!trimmedTitle || !trimmedBody) {
        setFeedback("Veuillez renseigner le titre et le contenu de la publication.");
        return;
      }
      if (visibility === "class" && !targetClassKey) {
        setFeedback("Veuillez sélectionner une classe précise.");
        return;
      }
      if (editingId && modifyConfirmation !== "MODIFIER LA PUBLICATION") {
        setFeedback("Veuillez saisir exactement MODIFIER LA PUBLICATION pour confirmer la modification.");
        return;
      }
      const now = new Date().toISOString();
      const existingPublication = yearData.valves.find((publication) => publication.id === editingId);
      const publicationId = existingPublication?.id ?? createId("valve");
      const attachmentValidationError = validateValveAttachmentDrafts(attachments);
      if (attachmentValidationError) {
        setFeedback(attachmentValidationError);
        return;
      }
      if (!valvesUploadsEnabled && attachments.some((attachment) => attachment.dataUrl)) {
        setFeedback("Les nouvelles pièces jointes sont temporairement suspendues pour maîtriser les coûts de stockage.");
        return;
      }
      setPublishProgress("Préparation des fichiers");
      const attachmentsToUpload = attachments.filter((attachment) => attachment.dataUrl);
      const retainedAttachments: ValvePublicationAttachment[] = attachments
        .filter((attachment) => attachment.url)
        .map((attachment) => ({
          name: attachment.name,
          type: attachment.type,
          url: attachment.url ?? "",
          path: attachment.path ?? "",
          size: attachment.size,
        }));
      let uploadedAttachments: ValvePublicationAttachment[] = [];
      if (attachmentsToUpload.length > 0) {
        try {
          uploadedAttachments = await uploadValveAttachments({
            schoolId: school.id,
            schoolYearId: year.id,
            publicationId,
            attachments: attachmentsToUpload.map((attachment) => ({
              name: attachment.name,
              type: attachment.type,
              dataUrl: attachment.dataUrl ?? "",
            })),
            onProgress: (progress) => {
              setPublishProgress(`Envoi du fichier ${progress.currentFile} sur ${progress.totalFiles} - ${progress.percent} %`);
            },
          });
        } catch (error) {
          setFeedback(getValvePublicationErrorMessage(error, "Erreur Storage pendant l'envoi du fichier joint. Veuillez réessayer."));
          return;
        }
        uploadedAttachmentPathsToRollback = uploadedAttachments.map((attachment) => attachment.path);
      }
      setPublishProgress("Finalisation de la publication");
      const publicationAttachments = [...retainedAttachments, ...uploadedAttachments];
      const publication: ValvePublication = {
        id: publicationId,
        schoolId: school.id,
        schoolYearId: year.id,
        title: trimmedTitle,
        kind,
        visibility,
        ...(visibility === "class" ? { targetClassKey } : {}),
        body: trimmedBody,
        authorId: existingPublication?.authorId ?? user.id,
        authorName: existingPublication?.authorName ?? user.name,
        createdAt: existingPublication?.createdAt ?? now,
        ...(publicationAttachments.length > 0 ? { attachments: publicationAttachments } : {}),
        ...(existingPublication ? { updatedAt: now } : {}),
      };
      if (getApproximateValveDocumentSize(publication) > maxValveDocumentBytes) {
        if (uploadedAttachmentPathsToRollback.length > 0) {
          await deleteValveAttachments(uploadedAttachmentPathsToRollback).catch((error) => {
            console.warn("Rollback de la pièce jointe Valves indisponible.", error);
          });
        }
        setFeedback("Le fichier joint est trop volumineux pour être publié.");
        return;
      }
      try {
        const valvesPersisted = await persistFirestorePatch({ valves: [publication] }, { throwOnError: true });
        if (!valvesPersisted) {
          throw new Error("Firestore indisponible.");
        }
      } catch (error) {
        if (uploadedAttachmentPathsToRollback.length > 0) {
          await deleteValveAttachments(uploadedAttachmentPathsToRollback).catch((deleteError) => {
            console.warn("Rollback de la pièce jointe Valves indisponible.", deleteError);
          });
        }
        setFeedback(getValvePublicationErrorMessage(error, "Erreur Firestore pendant l'enregistrement de la publication. Veuillez réessayer."));
        return;
      }
      const valveNotifications: AppNotification[] = existingPublication
        ? []
        : [
            ...getValvePublicationParents(publication, yearData.parents, yearData.students).map((parent) => ({
              id: createId("notif"),
              schoolId: school.id,
              schoolYearId: year.id,
              recipientRole: "parent" as const,
              parentId: parent.id,
              type: "valve" as const,
              title: "Nouvelle publication Valves",
              body: trimmedTitle,
              createdAt: now,
              read: false,
            })),
            {
              id: createId("notif"),
              schoolId: school.id,
              schoolYearId: year.id,
              recipientRole: "school",
              schoolRecipient: "cashier",
              type: "valve",
              title: "Nouvelle publication Valves",
              body: trimmedTitle,
              createdAt: now,
              read: false,
            },
          ];
      const auditLog = createAuditLog(user, school.id, year.id, editingId ? "Modification valves" : "Publication valves", trimmedTitle);
      try {
        const sideEffectsPersisted = await persistFirestorePatch({
          notifications: valveNotifications,
          auditLogs: [auditLog],
        }, { throwOnError: true });
        if (!sideEffectsPersisted) {
          throw new Error("Firestore indisponible.");
        }
      } catch (error) {
        if (existingPublication) {
          await persistFirestorePatch({ valves: [existingPublication] }, { throwOnError: true }).catch((rollbackError) => {
            console.warn("Rollback de la publication Valves indisponible.", rollbackError);
          });
        } else if (db) {
          await deleteDoc(doc(db, "valves", publication.id)).catch((rollbackError) => {
            console.warn("Rollback de la publication Valves indisponible.", rollbackError);
          });
        }
        if (uploadedAttachmentPathsToRollback.length > 0) {
          await deleteValveAttachments(uploadedAttachmentPathsToRollback).catch((deleteError) => {
            console.warn("Rollback de la pièce jointe Valves indisponible.", deleteError);
          });
        }
        setFeedback(getValvePublicationErrorMessage(error, "Erreur Firestore pendant l'enregistrement des notifications Valves. Veuillez réessayer."));
        return;
      }
      const nextAttachmentPaths = new Set(publicationAttachments.map((attachment) => attachment.path));
      const oldAttachmentPathsToDelete = [
        ...(existingPublication?.attachments?.map((attachment) => attachment.path) ?? []),
        existingPublication?.attachmentPath,
      ].filter((attachmentPath): attachmentPath is string => typeof attachmentPath === "string" && !nextAttachmentPaths.has(attachmentPath));
      if (oldAttachmentPathsToDelete.length > 0) {
        void deleteValveAttachments(oldAttachmentPathsToDelete).catch((error) => {
          console.warn("Suppression de l'ancienne pièce jointe Valves indisponible.", error);
        });
      }
      const nextValves = editingId ? data.valves.map((item) => (item.id === editingId ? publication : item)) : [publication, ...data.valves];
      updateData(
        {
          valves: nextValves,
          notifications: valveNotifications.length > 0 ? [...valveNotifications, ...data.notifications] : data.notifications,
          auditLogs: [auditLog, ...data.auditLogs],
        },
        { persist: false },
      );
      resetForm();
      setFeedback(editingId ? "Publication modifiée avec succès." : "Publication ajoutée avec succès.");
    } finally {
      isPublishingRef.current = false;
      setIsPublishing(false);
      setPublishProgress("");
    }
  }

  function editPublication(publication: ValvePublication) {
    setEditingId(publication.id);
    setTitle(publication.title);
    setKind(publication.kind);
    setVisibility(normalizeValveVisibility(publication.visibility));
    setTargetClassKey(publication.targetClassKey ?? "");
    setBody(publication.body);
    setAttachments(getPublicationAttachmentDrafts(publication));
    setModifyConfirmation("");
    setFeedback("");
  }

  function openDeletePublication(publication: ValvePublication) {
    setDeleteTarget(publication);
    setDeleteConfirmation("");
    setFeedback("");
  }

  function closeDeletePublication() {
    setDeleteTarget(null);
    setDeleteConfirmation("");
  }

  async function confirmDeletePublication() {
    if (!deleteTarget || deleteConfirmation !== "SUPPRIMER LA PUBLICATION") return;
    const publication = deleteTarget;
    if (!db) {
      setFeedback("Suppression impossible : base de données indisponible.");
      return;
    }
    try {
      await deleteDoc(doc(db, "valves", publication.id));
      const attachmentPaths = [
        ...(publication.attachments?.map((attachment) => attachment.path) ?? []),
        publication.attachmentPath,
      ];
      await deleteValveAttachments(attachmentPaths);
    } catch (error) {
      console.warn("Suppression de la publication Valves impossible.", error);
      setFeedback("Suppression impossible. Veuillez réessayer.");
      return;
    }
    updateData({
      valves: data.valves.filter((item) => item.id !== publication.id),
      auditLogs: [createAuditLog(user, school.id, year.id, "Suppression valves", publication.title), ...data.auditLogs],
    });
    if (editingId === publication.id) resetForm();
    closeDeletePublication();
  }

  const publishDisabled = isPublishing || isPreparingAttachment || (Boolean(editingId) && modifyConfirmation !== "MODIFIER LA PUBLICATION");

  return (
    <div className="grid min-w-0 gap-4">
      {canManage && (
        <>
        {isPublishing && <p className="rounded border border-blue-100 bg-blue-50 p-3 text-sm font-semibold text-blue-700">Publication en cours. Veuillez patienter...</p>}
        <fieldset disabled={isPublishing} aria-busy={isPublishing} className={`grid min-w-0 gap-3 rounded border border-slate-100 bg-slate-50 p-3 transition ${isPublishing ? "pointer-events-none opacity-60 blur-[1px]" : ""}`}>
          <p className="text-sm font-bold text-ink">{editingId ? "Modifier la publication" : "Ajouter une publication"}</p>
          {feedback && <p className="rounded border border-mint/30 bg-mint/10 p-3 text-sm font-semibold text-mint">{feedback}</p>}
          <Field label="Titre" value={title} onChange={setTitle} />
          <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
            Type
            <select value={kind} onChange={(event) => setKind(event.target.value as ValvePublicationKind)} className="input">
              {(Object.keys(valveKindLabels) as ValvePublicationKind[]).map((item) => (
                <option key={item} value={item}>{valveKindLabels[item]}</option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
            Visibilité
            <select
              value={visibility}
              onChange={(event) => {
                const nextVisibility = event.target.value as ValveVisibility;
                setVisibility(nextVisibility);
                if (nextVisibility !== "class") setTargetClassKey("");
              }}
              className="input"
            >
              {(Object.keys(valveVisibilityLabels) as ValveVisibility[]).map((item) => (
                <option key={item} value={item}>{valveVisibilityLabels[item]}</option>
              ))}
            </select>
          </label>
          {visibility === "class" && (
            <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
              Classe précise
              <select value={targetClassKey} onChange={(event) => setTargetClassKey(event.target.value)} className="input">
                <option value="">Sélectionner une classe</option>
                {valveClassChoices.map((choice) => (
                  <option key={choice.value} value={choice.value}>{choice.label}</option>
                ))}
              </select>
            </label>
          )}
          <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
            Contenu
            <textarea value={body} onChange={(event) => setBody(event.target.value)} className="input min-h-28" placeholder="Rédigez la publication" />
          </label>
          <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
            Fichiers joints
            <input
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                void readAttachments(event.target.files);
                event.target.value = "";
              }}
              type="file"
              className="input"
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
              multiple
              disabled={isPublishing || isPreparingAttachment || !valvesUploadsEnabled}
            />
          </label>
          {!valvesUploadsEnabled && (
            <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
              Les nouvelles pièces jointes sont temporairement suspendues pour maîtriser les coûts de stockage.
            </p>
          )}
          {isPreparingAttachment && <p className="text-sm font-semibold text-slate-600">Préparation du fichier...</p>}
          {publishProgress && <p className="text-sm font-semibold text-slate-600">{publishProgress}</p>}
          <AttachmentsList attachments={attachments} onRemove={isPublishing || isPreparingAttachment ? undefined : removeAttachment} />
          {attachments.length > 0 && (
            <button onClick={clearAttachment} type="button" className="w-fit rounded bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50" disabled={isPublishing || isPreparingAttachment}>
              Tout retirer
            </button>
          )}
          {editingId && (
            <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
              Phrase de confirmation
              <input
                value={modifyConfirmation}
                onChange={(event) => setModifyConfirmation(event.target.value)}
                className="input"
                placeholder="MODIFIER LA PUBLICATION"
              />
              {modifyConfirmation && modifyConfirmation !== "MODIFIER LA PUBLICATION" && (
                <span className="text-xs font-semibold text-red-600">Phrase incorrecte. Veuillez saisir exactement : MODIFIER LA PUBLICATION</span>
              )}
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button onClick={savePublication} type="button" className="primary-button disabled:opacity-50" disabled={publishDisabled}>
              <Upload className={`h-4 w-4 ${isPublishing ? "animate-spin" : ""}`} />
              {isPublishing ? "Publication..." : isPreparingAttachment ? "Préparation..." : editingId ? "Enregistrer" : "Publier"}
            </button>
            {editingId && <button onClick={resetForm} type="button" className="secondary-button" disabled={isPublishing}>Annuler</button>}
          </div>
        </fieldset>
        </>
      )}

      <div className="space-y-3">
        {visiblePublications.length === 0 && <p className="rounded border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">Aucune publication disponible.</p>}
        {visiblePublications.map((publication) => (
          <article key={publication.id} className="min-w-0 rounded border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="break-words font-bold text-ink">{publication.title}</h3>
                  <span className="rounded bg-blue-50 px-2 py-1 text-[10px] font-bold uppercase text-blue-700">{valveKindLabels[publication.kind]}</span>
                  {canManage && (
                    <span className="rounded bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase text-slate-500">
                      {publication.visibility === "class" && publication.targetClassKey
                        ? `${valveVisibilityLabels[publication.visibility]} · ${formatValveClassChoiceLabel(publication.targetClassKey)}`
                        : valveVisibilityLabels[normalizeValveVisibility(publication.visibility as ValvePublication["visibility"] | "parents" | "all" | "staff")]}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500">{publication.authorName} · {new Date(publication.createdAt).toLocaleString("fr-FR")}</p>
                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{publication.body}</p>
                <div className="mt-3">
                  <AttachmentsList attachments={getPublicationDownloadAttachments(publication)} onView={setSelectedAttachment} />
                </div>
              </div>
              {canManage && (
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button onClick={() => editPublication(publication)} type="button" className="rounded bg-slate-100 p-2 text-slate-700" title="Modifier">
                    <Edit3 className="h-4 w-4" />
                  </button>
                  <button onClick={() => openDeletePublication(publication)} type="button" className="rounded bg-red-50 p-2 text-red-700" title="Supprimer">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" role="dialog" aria-modal="true" aria-labelledby="valve-delete-title">
          <div className="w-full max-w-md rounded bg-white p-5 shadow-xl">
            <div className="grid gap-4">
              <div>
                <h2 id="valve-delete-title" className="break-words text-lg font-bold text-ink">Supprimer la publication</h2>
                <p className="mt-2 break-words text-sm text-slate-600">
                  Cette action supprimera la publication {deleteTarget.title}. Pour confirmer, saisissez exactement : SUPPRIMER LA PUBLICATION
                </p>
              </div>
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                Phrase de confirmation
                <input
                  value={deleteConfirmation}
                  onChange={(event) => setDeleteConfirmation(event.target.value)}
                  className="input"
                  placeholder="SUPPRIMER LA PUBLICATION"
                />
              </label>
              {deleteConfirmation && deleteConfirmation !== "SUPPRIMER LA PUBLICATION" && (
                <p className="rounded bg-red-50 p-3 text-sm font-semibold text-red-700">
                  Phrase incorrecte. Veuillez saisir exactement : SUPPRIMER LA PUBLICATION
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <button onClick={closeDeletePublication} type="button" className="secondary-button">Annuler</button>
                <button
                  onClick={confirmDeletePublication}
                  type="button"
                  className="rounded bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                  disabled={deleteConfirmation !== "SUPPRIMER LA PUBLICATION"}
                >
                  Supprimer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <AttachmentViewer attachment={selectedAttachment} onClose={() => setSelectedAttachment(null)} />
    </div>
  );
}
