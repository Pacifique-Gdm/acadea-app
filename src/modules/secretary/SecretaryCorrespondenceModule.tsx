import { useEffect, useMemo, useState } from "react";
import { Archive, FileText, Plus, Search } from "lucide-react";
import { AdminDrawer, SectionTitle } from "../../components/ui";
import { archiveCorrespondence, createCorrespondence, replaceCorrespondenceAttachment, subscribeToCorrespondences, updateCorrespondence } from "../../services/secretaryCorrespondence";
import { escapePdfHtml, pdfInfoGrid, pdfSection, renderAcadPdfPreview } from "../../utils/pdf";
import type { AppUser, School, SchoolYear } from "../../types";
import type { Correspondence, CorrespondenceDirection, CorrespondenceStatus } from "./secretaryTypes";

const initialInput = { direction: "incoming" as CorrespondenceDirection, date: new Date().toISOString().slice(0, 10), subject: "", sender: "", recipient: "", content: "", status: "received" as CorrespondenceStatus };

export function SecretaryCorrespondenceModule({ user, school, year }: { user: AppUser; school: School; year: SchoolYear }) {
  const [items, setItems] = useState<Correspondence[]>([]);
  const [queryText, setQueryText] = useState("");
  const [direction, setDirection] = useState<"all" | CorrespondenceDirection>("all");
  const [status, setStatus] = useState<"all" | CorrespondenceStatus>("all");
  const [editing, setEditing] = useState<Correspondence | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [input, setInput] = useState(initialInput);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => subscribeToCorrespondences({ user, schoolId: school.id, schoolYearId: year.id, onData: setItems, onError: () => setMessage("Impossible d'actualiser les correspondances pour le moment.") }), [school.id, user, year.id]);
  const filtered = useMemo(() => items.filter((item) => {
    const text = `${item.referenceNumber} ${item.subject} ${item.sender} ${item.recipient}`.toLowerCase();
    return text.includes(queryText.toLowerCase()) && (direction === "all" || item.direction === direction) && (status === "all" || item.status === status);
  }), [direction, items, queryText, status]);

  async function save() {
    if (busy || !input.subject.trim() || !input.sender.trim() || !input.recipient.trim()) return;
    setBusy(true); setMessage("");
    try {
      const item = editing
        ? (await updateCorrespondence(user, editing, input), editing)
        : await createCorrespondence({ user, schoolId: school.id, schoolYearId: year.id, input });
      if (file) await replaceCorrespondenceAttachment(user, item, file);
      setFormOpen(false); setEditing(null); setInput(initialInput); setFile(null); setMessage("Correspondance enregistrée.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Enregistrement impossible."); }
    finally { setBusy(false); }
  }

  function openEdit(item: Correspondence) {
    setEditing(item); setInput({ direction: item.direction, date: item.date, subject: item.subject, sender: item.sender, recipient: item.recipient, content: item.content, status: item.status }); setFile(null); setFormOpen(true);
  }

  async function printCorrespondence(item: Correspondence) {
    await renderAcadPdfPreview({ filename: `${item.referenceNumber}.pdf`, title: "Correspondance administrative", school, year, subtitle: item.referenceNumber, sections: [pdfInfoGrid([{ label: "Date", value: item.date }, { label: "Objet", value: item.subject }, { label: "Expéditeur", value: item.sender }, { label: "Destinataire", value: item.recipient }, { label: "Statut", value: item.status }]), pdfSection("Contenu", `<p>${escapePdfHtml(item.content)}</p>`)] });
  }

  return <section className="grid gap-4">
    <SectionTitle title="Correspondance" subtitle="Courriers administratifs entrants et sortants." />
    {message && <p className="rounded border border-slate-200 bg-white p-3 text-sm">{message}</p>}
    <div className="grid gap-2 sm:grid-cols-4">
      <button type="button" className="primary-button justify-center" onClick={() => { setEditing(null); setInput(initialInput); setFormOpen(true); }}><Plus className="h-4 w-4" /> Nouveau courrier</button>
      <label className="flex items-center gap-2 rounded border bg-white px-3"><Search className="h-4 w-4" /><input className="min-w-0 flex-1 py-2 outline-none" value={queryText} onChange={(event) => setQueryText(event.target.value)} placeholder="Rechercher" /></label>
      <select className="input" value={direction} onChange={(event) => setDirection(event.target.value as typeof direction)}><option value="all">Tous les sens</option><option value="incoming">Entrant</option><option value="outgoing">Sortant</option></select>
      <select className="input" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">Tous les statuts</option><option value="draft">Brouillon</option><option value="sent">Envoyé</option><option value="received">Reçu</option><option value="archived">Archivé</option></select>
    </div>
    <div className="overflow-x-auto rounded border bg-white"><table className="min-w-[800px] w-full text-sm"><thead className="bg-slate-50 text-left"><tr><th className="p-3">Référence</th><th>Objet</th><th>Sens</th><th>Date</th><th>Statut</th><th>Actions</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id} className="border-t"><td className="p-3 font-semibold">{item.referenceNumber}</td><td>{item.subject}</td><td>{item.direction === "incoming" ? "Entrant" : "Sortant"}</td><td>{item.date}</td><td>{item.status}</td><td><div className="flex gap-2"><button className="secondary-button" type="button" onClick={() => openEdit(item)}><FileText className="h-4 w-4" /> Consulter</button><button className="secondary-button" type="button" onClick={() => void printCorrespondence(item)}>PDF</button>{item.status !== "archived" && <button className="secondary-button" type="button" onClick={() => void archiveCorrespondence(user, item)}><Archive className="h-4 w-4" /> Archiver</button>}</div></td></tr>)}</tbody></table>{filtered.length === 0 && <p className="p-6 text-center text-sm text-slate-500">Aucune correspondance.</p>}</div>
    {formOpen && <AdminDrawer title={editing ? "Correspondance" : "Nouvelle correspondance"} onClose={() => !busy && setFormOpen(false)} closeLabel="Fermer"><form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      {editing && <p className="font-semibold">{editing.referenceNumber}</p>}
      <select className="input" value={input.direction} disabled={editing?.status === "archived"} onChange={(event) => setInput({ ...input, direction: event.target.value as CorrespondenceDirection })}><option value="incoming">Entrant</option><option value="outgoing">Sortant</option></select>
      <input className="input" type="date" value={input.date} disabled={editing?.status === "archived"} onChange={(event) => setInput({ ...input, date: event.target.value })} />
      <input className="input" placeholder="Objet" value={input.subject} disabled={editing?.status === "archived"} onChange={(event) => setInput({ ...input, subject: event.target.value })} />
      <input className="input" placeholder="Expéditeur" value={input.sender} disabled={editing?.status === "archived"} onChange={(event) => setInput({ ...input, sender: event.target.value })} />
      <input className="input" placeholder="Destinataire" value={input.recipient} disabled={editing?.status === "archived"} onChange={(event) => setInput({ ...input, recipient: event.target.value })} />
      <textarea className="input min-h-32" placeholder="Contenu" value={input.content} disabled={editing?.status === "archived"} onChange={(event) => setInput({ ...input, content: event.target.value })} />
      <input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" disabled={editing?.status === "archived"} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      {editing?.attachment && <a className="text-blue-700 underline" href={editing.attachment.url} target="_blank" rel="noreferrer">Voir la pièce jointe</a>}
      {editing?.status !== "archived" && <button className="primary-button justify-center" disabled={busy} type="submit">{busy ? "Enregistrement…" : "Enregistrer"}</button>}
    </form></AdminDrawer>}
  </section>;
}
