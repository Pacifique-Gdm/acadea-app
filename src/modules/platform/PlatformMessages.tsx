import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, limit, onSnapshot, query, updateDoc, where, type Firestore } from "@firebase/firestore";
import { db, firebaseReady } from "../../firebase";
import { clearPlatformRecipientCache, searchPlatformRecipients, sendPlatformMessage, type PlatformRecipient, type PlatformRecipientPage, type PlatformRecipientRole } from "../../services/schoolMessaging";
import { administrativeSenderDetails } from "../../utils/administrativeSender";
import { activityTimestamp } from "../../utils/activityHistory";
import type { AppNotification, AppUser, Message } from "../../types";
import { userFacingError } from "../../utils/userFacingError";

const roleLabels: Record<PlatformRecipientRole, string> = { coordination_admin: "Coordinations", sub_coordination_admin: "Sous-coordinations", school_admin: "Administrateurs d'école" };
const searchPlaceholders: Record<PlatformRecipientRole, string> = {
  coordination_admin: "Rechercher un nom ou une coordination…",
  sub_coordination_admin: "Rechercher un nom ou une coordination…",
  school_admin: "Rechercher une école (nom, sigle, ville)…",
};
/** Délai avant d'envoyer la recherche pendant la frappe (une seule demande pour un mot tapé d'un trait). */
export const RECIPIENT_SEARCH_DELAY_MS = 300;
/** Le serveur refuse au-delà de 200 destinataires par envoi. */
export const MAX_PLATFORM_RECIPIENTS = 200;

/** Lot 25 puis SA-6 : boîte du Super administrateur, ouverte UNE fois par session.
 * - Les notifications non lues sont écoutées tout le temps (badge de la cloche), une seule écoute.
 * - Les messages ne sont écoutés qu'à la première ouverture de la cloche, puis l'écoute reste en place :
 *   rouvrir la cloche affiche tout de suite les messages, sans nouveau chargement. */
export type PlatformInbox = { unread: AppNotification[]; messages: Message[] | null; start: () => void };

export function usePlatformInbox(userId: string): PlatformInbox {
  const [unread, setUnread] = useState<AppNotification[]>([]);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (!firebaseReady || !db || !userId) return undefined;
    const database = db as unknown as Firestore;
    return onSnapshot(query(collection(database, "notifications"), where("recipientUserId", "==", userId), where("read", "==", false), limit(100)),
      (snapshot) => setUnread(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as AppNotification)), () => setUnread([]));
  }, [userId]);
  useEffect(() => {
    if (!started || !firebaseReady || !db || !userId) return undefined;
    const database = db as unknown as Firestore;
    return onSnapshot(query(collection(database, "messages"), where("participantIds", "array-contains", userId), where("platformMessage", "==", true), limit(100)),
      (snapshot) => setMessages(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Message)), () => setMessages((current) => current ?? []));
  }, [started, userId]);
  const start = useCallback(() => setStarted(true), []);
  return { unread, messages, start };
}

/** Lot SA-6 : destinataires cherchés par le serveur, 25 par page avec « Voir plus ». */
function useRecipientSearch(role: PlatformRecipientRole, text: string, enabled: boolean) {
  const key = `${role}|${text}`;
  const [result, setResult] = useState<{ key: string; pages: PlatformRecipientPage[] }>({ key: "", pages: [] });
  // Page demandée pour CETTE recherche : une nouvelle recherche repart toujours de la première page.
  const [wanted, setWanted] = useState<{ key: string; page: number }>({ key, page: 0 });
  const page = wanted.key === key ? wanted.page : 0;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true); setError("");
      void searchPlatformRecipients(role, text, page)
        .then((next) => { if (active) setResult((current) => ({ key, pages: page === 0 || current.key !== key ? [next] : [...current.pages.slice(0, page), next] })); })
        .catch((cause: unknown) => { if (active) setError(userFacingError(cause, "Destinataires indisponibles.")); })
        .finally(() => { if (active) setLoading(false); });
    }, page === 0 ? RECIPIENT_SEARCH_DELAY_MS : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [key, role, text, page, round, enabled]);
  const pages = result.key === key ? result.pages : [];
  const last = pages[pages.length - 1];
  return {
    recipients: pages.flatMap((item) => item.recipients),
    emptySchools: pages.flatMap((item) => item.emptySchools),
    total: last?.total ?? 0,
    unit: last?.unit ?? "recipients",
    loaded: pages.length > 0,
    hasMore: Boolean(last) && (last.page + 1) * last.pageSize < last.total,
    loading, error,
    loadMore: () => setWanted({ key, page: pages.length }),
    refresh: () => { clearPlatformRecipientCache(); setWanted({ key, page: 0 }); setRound((value) => value + 1); },
  };
}

/** Lot 23 : messagerie du Super administrateur (coordinations, sous-coordinations,
 * administrateurs d'école) et réception de leurs réponses, en temps réel.
 * Lot SA-6a : l'onglet Messages n'affiche QUE « Nouveau message » (section="compose") ;
 * « Messages et réponses » n'est que dans la cloche (section="inbox").
 * Lot SA-6 : destinataires cherchés par nom, page par page ; la boîte de la cloche vient de
 * usePlatformInbox (chargée une seule fois par session). */
export type PlatformMessagesSection = "compose" | "inbox";

export function PlatformMessages({ user, section, inbox }: { user: AppUser; section: PlatformMessagesSection; inbox?: PlatformInbox }) {
  const [role, setRole] = useState<PlatformRecipientRole>("coordination_admin");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<PlatformRecipient[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("");
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const found = useRecipientSearch(role, search, section === "compose");
  const selectedIds = useMemo(() => selected.map((item) => item.uid), [selected]);
  const notifications = inbox?.unread ?? [];
  const sorted = useMemo(() => [...(inbox?.messages ?? [])].sort((a, b) => activityTimestamp(b.createdAt) - activityTimestamp(a.createdAt)), [inbox?.messages]);

  function toggle(recipient: PlatformRecipient) {
    setSelected((current) => current.some((item) => item.uid === recipient.uid)
      ? current.filter((item) => item.uid !== recipient.uid)
      : current.length >= MAX_PLATFORM_RECIPIENTS ? current : [...current, recipient]);
  }

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
      attempt.current = null; setStatus("Message envoyé."); setSubject(""); setBody(""); setSelected([]);
    } catch (cause) { setStatus(userFacingError(cause, "Message non envoyé.")); }
    finally { setSending(false); }
  }

  const foundLabel = found.unit === "schools" ? `${found.total} école(s) trouvée(s)` : `${found.total} destinataire(s) trouvé(s)`;

  return <section className="grid min-w-0 gap-4">
    {section === "compose" && <div className="grid min-w-0 gap-3 rounded border bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold">Nouveau message</h2>
      <select className="input" aria-label="Catégorie de destinataires" value={role} onChange={(event) => { setRole(event.target.value as PlatformRecipientRole); setSearch(""); setSelected([]); }}>
        {Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <input className="input" type="search" aria-label="Rechercher un destinataire" placeholder={searchPlaceholders[role]} value={search} onChange={(event) => setSearch(event.target.value)} />
      {selected.length > 0 && <div className="flex flex-wrap gap-2" aria-label="Destinataires choisis">
        {selected.map((recipient) => <button key={recipient.uid} type="button" className="max-w-full truncate rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700" title="Retirer" onClick={() => toggle(recipient)}>{recipient.name} ×</button>)}
      </div>}
      <fieldset className="grid max-h-72 min-w-0 gap-2 overflow-y-auto rounded border p-3">
        <legend className="px-1 text-sm font-semibold">Destinataires</legend>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>{found.loaded ? foundLabel : "Chargement…"}{selected.length > 0 ? ` · ${selected.length} choisi(s)` : ""}</span>
          <button type="button" className="font-semibold text-blue-700" onClick={found.refresh}>Actualiser la liste</button>
        </div>
        {found.recipients.map((recipient) => <label key={recipient.uid} className="flex min-w-0 items-center gap-2 text-sm">
          <input type="checkbox" checked={selectedIds.includes(recipient.uid)} disabled={!selectedIds.includes(recipient.uid) && selected.length >= MAX_PLATFORM_RECIPIENTS} onChange={() => toggle(recipient)} />
          <span className="min-w-0 break-words">{recipient.name}</span>{recipient.place && <span className="min-w-0 break-words text-xs text-slate-500">{recipient.place}</span>}
        </label>)}
        {found.emptySchools.map((school) => <p key={school.id} className="text-xs text-slate-400">{school.name} : aucun administrateur actif</p>)}
        {found.loaded && found.recipients.length === 0 && found.emptySchools.length === 0 && <p className="text-sm text-slate-500">Aucun destinataire trouvé.</p>}
        {found.error && <p role="alert" className="text-sm font-semibold text-red-700">{found.error}</p>}
        {found.hasMore && <button type="button" className="secondary-button justify-center" disabled={found.loading} onClick={found.loadMore}>{found.loading ? "Chargement…" : "Voir plus"}</button>}
      </fieldset>
      {selected.length >= MAX_PLATFORM_RECIPIENTS && <p className="text-xs text-slate-500">200 destinataires au plus par envoi.</p>}
      <input className="input" placeholder="Objet" value={subject} onChange={(event) => setSubject(event.target.value)} />
      <textarea className="input min-h-32" placeholder="Message" value={body} onChange={(event) => setBody(event.target.value)} />
      <button type="button" className="primary-button justify-center" disabled={sending || !selectedIds.length || !subject.trim() || !body.trim()} onClick={() => void submit()}>{sending ? "Envoi en cours…" : "Envoyer"}</button>
      {status && <p role="status" className="text-sm font-semibold text-slate-600">{status}</p>}
    </div>}
    {section === "inbox" && <div className="grid gap-2 rounded border bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Messages et réponses</h2>
        {notifications.length > 0 && <button type="button" className="rounded-full bg-blue-600 px-2 py-1 text-xs font-semibold text-white" onClick={() => void markRead()}>{notifications.length} non lu(s) · marquer comme lus</button>}
      </div>
      {inbox?.messages === null && <p className="text-sm text-slate-500">Chargement…</p>}
      {inbox?.messages && sorted.length === 0 && <p className="text-sm text-slate-500">Aucun message.</p>}
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
      {status && <p role="status" className="text-sm font-semibold text-slate-600">{status}</p>}
    </div>}
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
