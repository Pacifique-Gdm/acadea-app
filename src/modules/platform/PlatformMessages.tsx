import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, limit, onSnapshot, query, updateDoc, where, type Firestore } from "@firebase/firestore";
import { db, firebaseReady } from "../../firebase";
import { loadPlatformRecipients, sendPlatformMessage, type PlatformRecipient } from "../../services/schoolMessaging";
import { administrativeSenderDetails } from "../../utils/administrativeSender";
import { activityTimestamp } from "../../utils/activityHistory";
import type { AppNotification, AppUser, Message, School } from "../../types";

const roleLabels: Record<PlatformRecipient["role"], string> = { coordination_admin: "Coordinations", sub_coordination_admin: "Sous-coordinations", school_admin: "Administrateurs d'école" };

/** Lot 23 : messagerie du Super administrateur (coordinations, sous-coordinations,
 * administrateurs d'école) et réception de leurs réponses, en temps réel. */
export function PlatformMessages({ user, schools }: { user: AppUser; schools: School[] }) {
  const [recipients, setRecipients] = useState<PlatformRecipient[]>([]);
  const [role, setRole] = useState<PlatformRecipient["role"]>("coordination_admin");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const attempt = useRef<{ signature: string; key: string } | null>(null);

  useEffect(() => {
    let active = true;
    void loadPlatformRecipients().then((items) => { if (active) setRecipients(items); }).catch((cause) => { if (active) setStatus(cause instanceof Error ? cause.message : "Destinataires indisponibles."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!firebaseReady || !db) return undefined;
    const database = db as unknown as Firestore;
    const unsubscribes = [
      onSnapshot(query(collection(database, "messages"), where("participantIds", "array-contains", user.id), where("platformMessage", "==", true), limit(100)),
        (snapshot) => setMessages(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Message))),
      onSnapshot(query(collection(database, "notifications"), where("recipientUserId", "==", user.id), where("read", "==", false), limit(100)),
        (snapshot) => setNotifications(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as AppNotification))),
    ];
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [user.id]);

  const visible = useMemo(() => recipients.filter((item) => item.role === role), [recipients, role]);
  const sorted = useMemo(() => [...messages].sort((a, b) => activityTimestamp(b.createdAt) - activityTimestamp(a.createdAt)), [messages]);
  const schoolName = (id: string | null) => (id ? schools.find((item) => item.id === id)?.name ?? "" : "");

  async function markRead() {
    const database = db as unknown as Firestore | undefined;
    if (database) await Promise.all(notifications.map((item) => updateDoc(doc(database, "notifications", item.id), { read: true }))).catch(() => undefined);
  }

  async function submit(recipientIds = selectedIds, text = body, title = subject) {
    if (sending || !recipientIds.length || !text.trim() || !title.trim()) return;
    const signature = JSON.stringify([recipientIds, text, title]);
    const key = attempt.current?.signature === signature ? attempt.current.key : crypto.randomUUID();
    attempt.current = { signature, key };
    setSending(true); setStatus("");
    try {
      await sendPlatformMessage({ recipientIds, subject: title.trim(), body: text.trim(), idempotencyKey: key });
      attempt.current = null; setStatus("Message envoyé."); setSubject(""); setBody(""); setSelectedIds([]);
    } catch (cause) { setStatus(cause instanceof Error ? cause.message : "Message non envoyé."); }
    finally { setSending(false); }
  }

  return <section className="grid min-w-0 gap-4">
    <div className="grid gap-3 rounded border bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold">Nouveau message</h2>
      <select className="input" aria-label="Catégorie de destinataires" value={role} onChange={(event) => { setRole(event.target.value as PlatformRecipient["role"]); setSelectedIds([]); }}>
        {Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <fieldset className="grid max-h-64 gap-2 overflow-y-auto rounded border p-3">
        <legend className="px-1 text-sm font-semibold">Destinataires</legend>
        {visible.map((recipient) => <label key={recipient.uid} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={selectedIds.includes(recipient.uid)} onChange={() => setSelectedIds((current) => current.includes(recipient.uid) ? current.filter((id) => id !== recipient.uid) : [...current, recipient.uid])} />
          <span>{recipient.name}</span><span className="text-xs text-slate-500">{schoolName(recipient.schoolId)}</span>
        </label>)}
        {visible.length === 0 && <p className="text-sm text-slate-500">Aucun destinataire disponible.</p>}
      </fieldset>
      <input className="input" placeholder="Objet" value={subject} onChange={(event) => setSubject(event.target.value)} />
      <textarea className="input min-h-32" placeholder="Message" value={body} onChange={(event) => setBody(event.target.value)} />
      <button type="button" className="primary-button justify-center" disabled={sending || !selectedIds.length || !subject.trim() || !body.trim()} onClick={() => void submit()}>{sending ? "Envoi en cours…" : "Envoyer"}</button>
      {status && <p role="status" className="text-sm font-semibold text-slate-600">{status}</p>}
    </div>
    <div className="grid gap-2 rounded border bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Messages et réponses</h2>
        {notifications.length > 0 && <button type="button" className="rounded-full bg-blue-600 px-2 py-1 text-xs font-semibold text-white" onClick={() => void markRead()}>{notifications.length} non lu(s) · marquer comme lus</button>}
      </div>
      {sorted.length === 0 && <p className="text-sm text-slate-500">Aucun message.</p>}
      {sorted.map((message) => {
        const sender = administrativeSenderDetails(message);
        const received = message.senderId !== user.id;
        return <article key={message.id} className={`rounded border p-3 text-sm ${received ? "border-blue-100 bg-blue-50" : "border-slate-100 bg-slate-50"}`}>
          <p className="font-semibold">{received ? `${sender.name} — ${sender.role}` : "Envoyé"}</p>
          <p className="mt-1 font-semibold text-slate-700">{message.subject}</p>
          <p className="mt-1 whitespace-pre-wrap text-slate-600">{message.body}</p>
          {received && <ReplyToSender onSend={(text) => submit([message.senderId], text, `Re : ${message.subject}`)} />}
        </article>;
      })}
    </div>
  </section>;
}

function ReplyToSender({ onSend }: { onSend: (text: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open) return <button type="button" className="secondary-button mt-2 w-fit" onClick={() => setOpen(true)}>Répondre</button>;
  return <div className="mt-2 grid gap-2">
    <textarea aria-label="Votre réponse" className="input min-h-20" value={text} onChange={(event) => setText(event.target.value)} />
    <div className="flex gap-2"><button type="button" className="primary-button" disabled={!text.trim()} onClick={() => void onSend(text).then(() => { setText(""); setOpen(false); })}>Envoyer la réponse</button><button type="button" className="secondary-button" onClick={() => setOpen(false)}>Annuler</button></div>
  </div>;
}
