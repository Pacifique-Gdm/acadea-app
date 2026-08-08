import { useEffect, useMemo, useRef, useState } from "react";
import { FilePlus2, MessageSquare, Search, X } from "lucide-react";
import { FormPanel, SectionTitle } from "../../components/ui";
import { deletePendingMessageAttachments, uploadPendingMessageAttachments } from "../../services/messageStorage";
import { loadSchoolMessageRecipients, sendSchoolMessage, type SchoolMessageRecipient, type SchoolMessageRecipientRole } from "../../services/schoolMessaging";
import type { AppData, AppUser, School, SchoolYear } from "../../types";
import { formatMessageAttachmentSize, MAX_MESSAGE_ATTACHMENTS_TOTAL_SIZE, MESSAGE_ATTACHMENT_ACCEPT, validateMessageAttachments } from "../../utils/messageAttachments";

type RecipientKind = "administrative" | "parents";
const administrativeRoles: Array<{ role: SchoolMessageRecipientRole; label: string }> = [
  { role: "school_admin", label: "Administrateur" },
  { role: "cashier", label: "Caissier" },
  { role: "discipline_director", label: "Directeur de Discipline" },
];

export function SecretaryMessagesModule({ user, data, school, year, updateData }: { user: AppUser; data: AppData; school: School; year: SchoolYear; updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void }) {
  const [recipientKind, setRecipientKind] = useState<RecipientKind>("administrative");
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [feedback, setFeedback] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [directory, setDirectory] = useState<SchoolMessageRecipient[]>([]);
  const [isLoadingRecipients, setIsLoadingRecipients] = useState(true);
  const [recipientError, setRecipientError] = useState("");
  const requestKeyRef = useRef(crypto.randomUUID());

  useEffect(() => {
    let active = true;
    setIsLoadingRecipients(true);
    setRecipientError("");
    loadSchoolMessageRecipients()
      .then((recipients) => { if (active) setDirectory(recipients); })
      .catch((error) => { if (active) setRecipientError(error instanceof Error ? error.message : "Destinataires indisponibles. Veuillez réessayer."); })
      .finally(() => { if (active) setIsLoadingRecipients(false); });
    return () => { active = false; };
  }, [user.id]);

  const administrativeUsers = useMemo(() => directory.filter((candidate) => administrativeRoles.some(({ role }) => role === candidate.role)), [directory]);
  const parentUsers = useMemo(() => directory.filter((candidate) => candidate.role === "parent" && candidate.name.toLowerCase().includes(search.trim().toLowerCase())), [directory, search]);
  const recipients = recipientKind === "administrative" ? administrativeUsers : parentUsers;
  const selected = recipients.filter((candidate) => recipientIds.includes(candidate.uid));
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  function changeRecipientKind(kind: RecipientKind) {
    setRecipientKind(kind);
    setRecipientIds([]);
    setSearch("");
  }

  function toggleRecipient(id: string) {
    setRecipientIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files, ...Array.from(list)];
    const error = validateMessageAttachments(next);
    if (error) {
      setFeedback(error);
      return;
    }
    setFiles(next);
    setFeedback("");
  }

  async function submit() {
    if (isSending) return;
    if (!recipientIds.length || !subject.trim() || !body.trim()) {
      setFeedback("Sélectionnez au moins un destinataire, puis renseignez l'objet et le message.");
      return;
    }
    const attachmentError = validateMessageAttachments(files);
    if (attachmentError) {
      setFeedback(attachmentError);
      return;
    }
    setIsSending(true);
    setFeedback("");
    const draftId = crypto.randomUUID();
    let uploaded: Awaited<ReturnType<typeof uploadPendingMessageAttachments>> = [];
    try {
      uploaded = await uploadPendingMessageAttachments({ schoolId: school.id, schoolYearId: year.id, senderId: user.id, draftId, files });
      const recipientRoles = [...new Set(selected.map((recipient) => recipient.role as SchoolMessageRecipientRole))];
      const message = await sendSchoolMessage({ schoolYearId: year.id, recipientRoles, recipientIds, subject: subject.trim(), body: body.trim(), draftId, attachments: uploaded, idempotencyKey: requestKeyRef.current });
      updateData({ messages: [message, ...data.messages.filter((item) => item.id !== message.id)] }, { persist: false });
      setRecipientIds([]);
      setSubject("");
      setBody("");
      setFiles([]);
      requestKeyRef.current = crypto.randomUUID();
      setFeedback("Message envoyé avec succès.");
    } catch (error) {
      await deletePendingMessageAttachments(uploaded);
      console.error("Envoi du message Secrétaire impossible.", error);
      setFeedback(error instanceof Error ? error.message : "Message non envoyé. Veuillez réessayer.");
    } finally {
      setIsSending(false);
    }
  }

  return <section className="grid min-w-0 gap-4">
    <SectionTitle title="Messages" subtitle="Échanges sécurisés avec les utilisateurs autorisés de l'établissement." />
    <FormPanel title="Envoyer un message">
      <label className="grid gap-1 text-sm font-semibold text-slate-700">Type de destinataire
        <select className="input" value={recipientKind} onChange={(event) => changeRecipientKind(event.target.value as RecipientKind)}>
          <option value="parents">Parents d'élèves</option><option value="administrative">Administratifs</option>
        </select>
      </label>
      {recipientKind === "parents" && <label className="flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2"><Search className="h-4 w-4 text-slate-400" /><input className="min-w-0 flex-1 outline-none" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher un parent" /></label>}
      <div className="grid max-h-60 gap-2 overflow-y-auto sm:grid-cols-2">
        {recipients.map((recipient) => <label key={recipient.uid} className="flex min-h-11 cursor-pointer items-center gap-3 rounded border border-slate-200 px-3 py-2 hover:bg-slate-50"><input type="checkbox" checked={recipientIds.includes(recipient.uid)} onChange={() => toggleRecipient(recipient.uid)} /><span><strong className="block text-sm text-slate-800">{recipient.name}</strong><span className="text-xs text-slate-500">{administrativeRoles.find(({ role }) => role === recipient.role)?.label ?? "Parent"}</span></span></label>)}
      </div>
      {isLoadingRecipients && <p className="text-sm text-slate-500">Chargement des destinataires…</p>}
      {!isLoadingRecipients && !recipients.length && !recipientError && <p className="text-sm text-slate-500">Aucun destinataire autorisé disponible.</p>}
      {recipientError && <p className="rounded bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{recipientError}</p>}
      <input className="input" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Objet" maxLength={200} />
      <textarea className="input min-h-32" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Message" maxLength={5000} />
      <label className="secondary-button w-full cursor-pointer justify-center"><FilePlus2 className="h-4 w-4" /> Joindre des fichiers<input className="sr-only" type="file" multiple accept={MESSAGE_ATTACHMENT_ACCEPT} onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = ""; }} /></label>
      <p className={`text-xs font-semibold ${totalBytes > MAX_MESSAGE_ATTACHMENTS_TOTAL_SIZE ? "text-red-600" : "text-slate-500"}`}>Pièces jointes : {formatMessageAttachmentSize(totalBytes)} / 10 Mo</p>
      {files.map((file, index) => <div key={`${file.name}-${index}`} className="flex items-center justify-between gap-3 rounded bg-slate-50 px-3 py-2 text-sm"><span className="min-w-0 truncate">{file.name} · {formatMessageAttachmentSize(file.size)}</span><button type="button" className="rounded p-1 hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600" aria-label={`Retirer ${file.name}`} onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X className="h-4 w-4" /></button></div>)}
      {feedback && <p className={`rounded px-3 py-2 text-sm font-semibold ${feedback === "Message envoyé avec succès." ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{feedback}</p>}
      <button type="button" onClick={submit} disabled={isSending || !recipientIds.length || !subject.trim() || !body.trim()} className="primary-button w-full justify-center disabled:opacity-50"><MessageSquare className="h-4 w-4" />{isSending ? "Envoi en cours…" : "Envoyer"}</button>
    </FormPanel>
  </section>;
}
