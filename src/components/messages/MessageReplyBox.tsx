import { useRef, useState } from "react";
import type { AppUser, Message } from "../../types";
import { sendMessageReply } from "../../services/schoolMessaging";
import { replyAsCoordination } from "../../services/coordinationMessaging";
import { canReplyToMessage } from "../../utils/messageReplies";

/** Lot 23 : « Répondre » sous un message de la Coordination, de la Sous-coordination
 * ou du Super administrateur, pour les seuls rôles autorisés (jamais les parents). */
export function MessageReplyBox({ message, user, schoolYearId }: { message: Message; user: AppUser; schoolYearId?: string }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("");
  const attempt = useRef<{ body: string; key: string } | null>(null);
  if (!canReplyToMessage(message, user)) return null;

  async function submit() {
    const text = body.trim();
    if (!text || sending) return;
    const key = attempt.current?.body === text ? attempt.current.key : crypto.randomUUID();
    attempt.current = { body: text, key };
    setSending(true); setStatus("");
    try {
      const input = { replyToMessageId: message.id, body: text, subject: `Re : ${message.subject ?? ""}`.trim(), idempotencyKey: key };
      if (user.role === "coordination_admin" || user.role === "sub_coordination_admin") await replyAsCoordination(input);
      else await sendMessageReply({ ...input, schoolYearId });
      attempt.current = null; setBody(""); setOpen(false); setStatus("Réponse envoyée.");
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "Réponse non envoyée.");
    } finally { setSending(false); }
  }

  return <div className="mt-2 grid gap-2">
    {!open ? <button type="button" className="secondary-button w-fit" onClick={() => setOpen(true)}>Répondre</button> : <>
      <textarea aria-label="Votre réponse" className="input min-h-20" value={body} maxLength={5000} onChange={(event) => setBody(event.target.value)} disabled={sending} />
      <div className="flex gap-2">
        <button type="button" className="primary-button" disabled={sending || !body.trim()} onClick={() => void submit()}>{sending ? "Envoi…" : "Envoyer la réponse"}</button>
        <button type="button" className="secondary-button" disabled={sending} onClick={() => setOpen(false)}>Annuler</button>
      </div>
    </>}
    {status && <p role="status" className="text-xs font-semibold text-slate-600">{status}</p>}
  </div>;
}
