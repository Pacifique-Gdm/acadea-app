import { useEffect, useMemo, useState } from "react";
import type { School } from "../../types";
import { loadCoordinationRecipients, sendCoordinationMessage, type CoordinationRecipient } from "../../services/coordinationMessaging";
import { SUCCESS_MESSAGE_DURATION_MS, useAutoDismissMessage } from "../../hooks/useAutoDismissMessage";

const roleLabels: Record<string, string> = { school_admin: "Administrateurs", discipline_director: "Directeurs de discipline", study_director: "Directeurs des études", cashier: "Caissiers", teacher: "Enseignants", parent: "Parents", secretary: "Secrétaires" };

export function CoordinationMessage({ schools, schoolId, refreshToken = 0 }: { schools: School[]; schoolId: string; refreshToken?: number }) {
  const [recipients, setRecipients] = useState<CoordinationRecipient[]>([]);
  const [selectedRole, setSelectedRole] = useState("school_admin");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  useAutoDismissMessage(success, () => setSuccess(""), SUCCESS_MESSAGE_DURATION_MS);

  useEffect(() => {
    let cancelled = false; setLoading(true); setError(""); setSelectedIds([]);
    loadCoordinationRecipients(schoolId).then((items) => { if (!cancelled) setRecipients(items); }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Chargement impossible."); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshToken, schoolId]);

  const visible = useMemo(() => recipients.filter((item) => item.role === selectedRole), [recipients, selectedRole]);
  function toggle(uid: string) { setSelectedIds((current) => current.includes(uid) ? current.filter((item) => item !== uid) : [...current, uid]); }
  async function submit() {
    if (sending || !selectedIds.length || !subject.trim() || !body.trim()) return;
    setSending(true); setError(""); setSuccess("");
    try { await sendCoordinationMessage({ schoolId: schoolId || undefined, recipientIds: selectedIds, subject: subject.trim(), body: body.trim(), idempotencyKey: crypto.randomUUID() }); setSuccess("Message envoyé."); setSubject(""); setBody(""); setSelectedIds([]); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Message non envoyé."); }
    finally { setSending(false); }
  }
  return <section className="grid gap-4 rounded border bg-white p-5 shadow-sm"><div><h2 className="text-lg font-bold">Message</h2><p className="text-sm text-slate-600">{schoolId ? schools.find((item) => item.id === schoolId)?.name : "Toutes les écoles actives"}</p></div>{error && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}{success && <p role="status" className="rounded bg-emerald-50 p-3 text-sm text-emerald-700">{success}</p>}<select className="input" aria-label="Catégorie de destinataires" value={selectedRole} onChange={(event) => { setSelectedRole(event.target.value); setSelectedIds([]); }}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><fieldset className="grid max-h-64 gap-2 overflow-y-auto rounded border p-3"><legend className="px-1 text-sm font-semibold">Destinataires</legend>{loading ? <p className="text-sm text-slate-500">Chargement…</p> : visible.map((recipient) => <label key={recipient.uid} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selectedIds.includes(recipient.uid)} onChange={() => toggle(recipient.uid)}/><span>{recipient.name}</span><span className="text-xs text-slate-500">{schools.find((item) => item.id === recipient.schoolId)?.name ?? recipient.schoolId}</span></label>)}{!loading && visible.length === 0 && <p className="text-sm text-slate-500">Aucun destinataire disponible.</p>}</fieldset><input className="input" placeholder="Objet" value={subject} onChange={(event) => setSubject(event.target.value)}/><textarea className="input min-h-32" placeholder="Message" value={body} onChange={(event) => setBody(event.target.value)}/><button type="button" className="primary-button justify-center" disabled={sending || !selectedIds.length || !subject.trim() || !body.trim()} onClick={() => void submit()}>{sending ? "Envoi en cours…" : "Envoyer"}</button></section>;
}
