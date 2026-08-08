import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArchiveRestore, Download, Eye, FileText, Plus, Search, Trash2 } from "lucide-react";
import { AdminDrawer, SectionTitle } from "../../components/ui";
import { archiveCorrespondence, createCorrespondence, deleteCorrespondencePermanently, replaceCorrespondenceAttachment, subscribeToCorrespondences, unarchiveCorrespondence, updateCorrespondence } from "../../services/secretaryCorrespondence";
import { escapePdfHtml, pdfInfoGrid, pdfSection, renderAcadPdfPreview } from "../../utils/pdf";
import { refreshErrorMessage } from "../../utils/refreshErrors";
import type { AppUser, School, SchoolYear } from "../../types";
import type { Correspondence, CorrespondenceDirection, CorrespondenceStatus } from "./secretaryTypes";
import { OutgoingCorrespondenceForm, type OutgoingSaveRequest } from "./OutgoingCorrespondenceForm";
import { SecretaryViewActionButton } from "./SecretaryViewActionButton";
import { previewOutgoingCorrespondence } from "./outgoingCorrespondencePdf";
import { filterSecretaryCorrespondences } from "./secretaryListFilters";
import { exportCorrespondenceListPdf } from "./secretaryListPdf";
import { CORRESPONDENCE_DELIVERY_MODES, correspondenceDeliveryModeLabel } from "./correspondenceOptions";

const initialInput = { direction: "incoming" as CorrespondenceDirection, date: new Date().toISOString().slice(0, 10), subject: "", sender: "", recipient: "", content: "", copiePourInformation: "", status: "received" as CorrespondenceStatus };

function correspondencePdfSections(item: Correspondence) {
  const safeContent = escapePdfHtml(item.content?.trim() || "Contenu non renseigné.").replaceAll("\n", "<br />");
  const sections = [
    pdfInfoGrid([
      { label: "Référence", value: item.referenceNumber },
      { label: "Date", value: item.date },
      { label: "Expéditeur", value: item.sender },
      { label: "Destinataire", value: item.recipient },
    ]),
    pdfSection("Objet", `<p><strong>${escapePdfHtml(item.subject)}</strong></p>`),
    pdfSection("Courrier", `<div style="line-height:1.65;text-align:justify;white-space:normal">${safeContent}</div>`),
  ];
  if (item.copiePourInformation?.trim()) sections.push(pdfSection("Copie pour information", `<p>${escapePdfHtml(item.copiePourInformation)}</p>`));
  return sections;
}

function correspondenceErrorMessage(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code.includes("permission-denied")) return "Votre session ne permet pas d'enregistrer ce courrier.";
  if (code.startsWith("storage/")) return "Le courrier a été enregistré, mais la pièce jointe n'a pas pu être téléversée.";
  return error instanceof Error && error.message ? error.message : "Impossible d'enregistrer le courrier pour le moment.";
}

export function SecretaryCorrespondenceModule({ user, users = [], school, year }: { user: AppUser; users?: AppUser[]; school: School; year: SchoolYear }) {
  const [items, setItems] = useState<Correspondence[]>([]);
  const [queryText, setQueryText] = useState("");
  const [direction, setDirection] = useState<"all" | CorrespondenceDirection>("all");
  const [outgoingType, setOutgoingType] = useState("all");
  const [priority, setPriority] = useState("all");
  const [deliveryMode, setDeliveryMode] = useState("all");
  const [archiveView, setArchiveView] = useState<"active" | "archived">("active");
  const [editing, setEditing] = useState<Correspondence | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [input, setInput] = useState(initialInput);
  const [selectedDirection, setSelectedDirection] = useState<"" | CorrespondenceDirection>("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [sensitiveAction, setSensitiveAction] = useState<{ kind: "delete"; target: Correspondence } | null>(null);
  const [confirmationText, setConfirmationText] = useState("");
  const [confirmationError, setConfirmationError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [pdfBusyId, setPdfBusyId] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const saveLock = useRef(false);

  useEffect(() => subscribeToCorrespondences({ user, schoolId: school.id, schoolYearId: year.id, onData: setItems, onError: (error) => setMessage(refreshErrorMessage(error)) }), [school.id, user, year.id]);
  useEffect(() => { if (!message) return; const timer = window.setTimeout(() => setMessage(""), 4000); return () => window.clearTimeout(timer); }, [message]);
  const filtered = useMemo(() => filterSecretaryCorrespondences(items, queryText, direction, outgoingType, priority, deliveryMode).filter((item) => archiveView === "archived" ? item.status === "archived" : item.status !== "archived"), [archiveView, deliveryMode, direction, items, outgoingType, priority, queryText]);

  function finishSuccessfulSave(successMessage: string) {
    setEditing(null);
    setInput(initialInput);
    setSelectedDirection("");
    setFile(null);
    setQueryText("");
    setDirection("all");
    setMessage(successMessage);
    setFormOpen(false);
  }

  async function save() {
    if (saveLock.current) return;
    if (!input.date || !input.subject.trim() || !input.sender.trim() || !input.recipient.trim()) {
      setMessage("Renseignez la date, l'objet, l'expéditeur et le destinataire du courrier.");
      return;
    }
    saveLock.current = true;
    setBusy(true); setMessage("");
    try {
      const payload = {
        ...input,
        copiePourInformation: input.direction === "outgoing" && input.copiePourInformation.trim() ? input.copiePourInformation.trim() : undefined,
      };
      const item = editing
        ? (await updateCorrespondence(user, editing, payload), { ...editing, ...payload })
        : await createCorrespondence({ user, schoolId: school.id, schoolYearId: year.id, input: payload });
      if (input.direction === "incoming" && file) {
        try {
          await replaceCorrespondenceAttachment(user, item, file);
        } catch (uploadError) {
          console.error("Échec du téléversement de la pièce jointe du courrier", uploadError);
          finishSuccessfulSave("Courrier enregistré, mais la pièce jointe n'a pas pu être téléversée.");
          return;
        }
      }
      if (input.direction === "outgoing") {
        try {
          await printCorrespondence({ ...item, ...input, attachment: undefined });
        } catch {
          finishSuccessfulSave("Courrier enregistré, mais le PDF n'a pas pu être généré. Vous pouvez le générer depuis la liste.");
          return;
        }
      }
      finishSuccessfulSave("Courrier enregistré.");
    } catch (error) { console.error("Échec de l'enregistrement du courrier", error); setMessage(correspondenceErrorMessage(error)); }
    finally { saveLock.current = false; setBusy(false); }
  }

  async function saveOutgoing(request: OutgoingSaveRequest) {
    if (saveLock.current) return;
    saveLock.current = true; setBusy(true); setMessage("");
    let persisted: Correspondence | null = null;
    try {
      const payload = { ...request.item, status: request.status };
      const saved = editing
        ? (await updateCorrespondence(user, editing, { date: payload.date, subject: payload.subject, sender: payload.sender, recipient: payload.recipient, content: payload.content, status: request.status, outgoing: payload.outgoing, pdfSettings: payload.pdfSettings }), { ...editing, ...payload })
        : await createCorrespondence({ user, schoolId: school.id, schoolYearId: year.id, input: { direction: "outgoing", date: payload.date, subject: payload.subject, sender: payload.sender, recipient: payload.recipient, content: payload.content, status: request.status, outgoing: payload.outgoing, pdfSettings: payload.pdfSettings } });
      persisted = saved;
      finishSuccessfulSave(request.status === "draft" ? "Brouillon enregistré." : request.status === "pending_validation" ? "Courrier soumis à validation." : "Courrier finalisé.");
    } catch (error) {
      console.error("Échec de l'enregistrement du courrier sortant", error);
      if (persisted) {
        setEditing(persisted);
        setMessage("Le courrier est enregistré, mais un fichier n’a pas pu être téléversé. Corrigez le fichier puis réessayez sans créer de doublon.");
      } else setMessage(correspondenceErrorMessage(error));
    } finally { saveLock.current = false; setBusy(false); }
  }

  async function printCorrespondence(item: Correspondence) {
    if (item.direction === "outgoing" && item.outgoing) return previewOutgoingCorrespondence(item, school, year);
    if (!item.referenceNumber?.trim()) throw new Error("Référence du courrier absente.");
    await renderAcadPdfPreview({ filename: `${item.referenceNumber}.pdf`, title: "Courrier administratif", school, year, subtitle: item.referenceNumber, sections: correspondencePdfSections(item) });
  }

  async function showCorrespondencePdf(item: Correspondence) {
    if (pdfBusyId) return;
    setPdfBusyId(item.id); setMessage("");
    try { await printCorrespondence(item); }
    catch (error) { console.error("Échec de génération du PDF du courrier", error); setMessage(error instanceof Error ? error.message : "Impossible d'afficher le PDF du courrier."); }
    finally { setPdfBusyId(""); }
  }

  async function exportFilteredCorrespondences() {
    if (exportBusy || filtered.length === 0) return;
    setExportBusy(true); setMessage("");
    const filters = [queryText.trim() ? `Recherche : ${queryText.trim()}` : "", direction !== "all" ? `Sens : ${direction === "incoming" ? "Entrant" : "Sortant"}` : "", outgoingType !== "all" ? `Type : ${outgoingType}` : "", priority !== "all" ? `Priorité : ${priority}` : "", deliveryMode !== "all" ? `Mode d’acheminement : ${correspondenceDeliveryModeLabel(deliveryMode)}` : ""].filter(Boolean).join(" · ");
    try { await exportCorrespondenceListPdf({ rows: filtered, school, year, filters, typeLabel: (item) => item.direction === "incoming" ? "Courrier entrant" : correspondenceTypeLabel(item.outgoing?.correspondenceType) }); }
    catch (error) { console.error("Échec de l'export PDF des courriers", error); setMessage(error instanceof Error ? error.message : "Export PDF des courriers impossible."); }
    finally { setExportBusy(false); }
  }

  function closeSensitiveAction() { if (actionBusy) return; setSensitiveAction(null); setConfirmationText(""); setConfirmationError(""); }

  async function changeArchiveState(item: Correspondence, action: "archive" | "restore") {
    if (actionBusy) return;
    setActionBusy(true); setMessage("");
    try {
      if (action === "archive") await archiveCorrespondence(user, item); else await unarchiveCorrespondence(user, item);
      setMessage(action === "archive" ? "Courrier archivé." : "Courrier restauré.");
    } catch (error) { console.error("Échec de l’archivage du courrier", error); setMessage(correspondenceErrorMessage(error)); }
    finally { setActionBusy(false); }
  }

  async function executeSensitiveAction() {
    if (!sensitiveAction || actionBusy) return;
    const expected = "SUPPRIMER DÉFINITIVEMENT";
    if (confirmationText !== expected) { setConfirmationError("Le texte de confirmation est incorrect."); return; }
    setActionBusy(true); setConfirmationError("");
    try {
      const cleanup = await deleteCorrespondencePermanently(user, sensitiveAction.target, confirmationText);
      setItems((current) => current.filter((item) => item.id !== sensitiveAction.target.id));
      setMessage(cleanup.storageCleanupSucceeded ? "Courrier supprimé définitivement." : "Courrier supprimé. Le nettoyage des fichiers doit être vérifié.");
      setSensitiveAction(null); setConfirmationText("");
    } catch (error) { console.error("Échec de l'action sur le courrier", error); setMessage(correspondenceErrorMessage(error)); }
    finally { setActionBusy(false); }
  }

  return <section className="grid gap-4">
    <SectionTitle title="Courriers" subtitle="Courriers administratifs entrants et sortants." />
    {message && <p className="rounded border border-slate-200 bg-white p-3 text-sm">{message}</p>}
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-8">
      <button type="button" className="primary-button justify-center" onClick={() => { setEditing(null); setInput(initialInput); setSelectedDirection(""); setFormOpen(true); }}><Plus className="h-4 w-4" /> Nouveau courrier</button>
      <label className="flex items-center gap-2 rounded border bg-white px-3"><Search className="h-4 w-4" /><input className="min-w-0 flex-1 py-2 outline-none" value={queryText} onChange={(event) => setQueryText(event.target.value)} placeholder="Rechercher" /></label>
      <select className="input" value={direction} onChange={(event) => setDirection(event.target.value as typeof direction)}><option value="all">Tous les sens</option><option value="incoming">Entrant</option><option value="outgoing">Sortant</option></select>
      <select className="input" value={outgoingType} onChange={(event) => setOutgoingType(event.target.value)}><option value="all">Tous les types</option><option value="administrative_letter">Lettre administrative</option><option value="official_request">Demande officielle</option><option value="administrative_response">Réponse administrative</option><option value="transmission_letter">Lettre de transmission</option><option value="summons">Convocation</option><option value="notification">Notification</option><option value="formal_notice">Mise en demeure</option><option value="information_letter">Lettre d’information</option><option value="other">Autre</option></select>
      <select className="input" value={priority} onChange={(event) => setPriority(event.target.value)}><option value="all">Toutes les priorités</option><option value="normal">Normale</option><option value="important">Importante</option><option value="urgent">Urgente</option><option value="very_urgent">Très urgente</option></select>
      <select className="input" aria-label="Mode d’acheminement" value={deliveryMode} onChange={(event) => setDeliveryMode(event.target.value)}><option value="all">Tous les modes</option>{CORRESPONDENCE_DELIVERY_MODES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select className="input" aria-label="État d’archivage" value={archiveView} onChange={(event) => setArchiveView(event.target.value as typeof archiveView)}><option value="active">Courriers actifs</option><option value="archived">Archives</option></select>
      <button type="button" className="pdf-export-button" disabled={exportBusy || filtered.length === 0} onClick={() => void exportFilteredCorrespondences()}><Download className="h-4 w-4" /> {exportBusy ? "Export en cours…" : "Exporter PDF"}</button>
    </div>
    <div className="max-w-full overflow-x-auto rounded border bg-white"><table className="w-full min-w-[860px] table-fixed text-sm"><thead className="bg-slate-50 text-left"><tr><th className="w-[15%] p-3">Référence</th><th className="w-[11%]">Date</th><th className="w-[14%]">Type</th><th className="w-[14%]">Expéditeur</th><th className="w-[14%]">Destinataire</th><th className="w-[20%]">Objet</th><th className="w-[12%] text-center">Actions</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id} className="border-t"><TableCell value={item.referenceNumber} strong /><TableCell value={item.date} /><TableCell value={item.direction === "incoming" ? "Courrier entrant" : correspondenceTypeLabel(item.outgoing?.correspondenceType)} /><TableCell value={item.sender || school.name} /><TableCell value={item.recipient} /><TableCell value={item.subject} /><td className="p-2"><div className="flex items-center justify-center gap-1.5 whitespace-nowrap"><SecretaryViewActionButton onClick={() => { setEditing(item); setInput({ direction: item.direction, date: item.date, subject: item.subject, sender: item.sender, recipient: item.recipient, content: item.content, copiePourInformation: item.copiePourInformation ?? "", status: item.status }); setSelectedDirection(item.direction); setFormOpen(true); }} /><CorrespondenceActionButton label="Afficher le PDF" icon={FileText} disabled={Boolean(pdfBusyId)} loading={pdfBusyId === item.id} onClick={() => void showCorrespondencePdf(item)} />{item.status === "archived" ? <><CorrespondenceActionButton label="Restaurer" icon={ArchiveRestore} disabled={actionBusy} onClick={() => void changeArchiveState(item, "restore")} />{item.createdBy === user.id && item.archivedFromStatus === "draft" && <CorrespondenceActionButton label="Supprimer définitivement" icon={Trash2} danger disabled={actionBusy} onClick={() => setSensitiveAction({ kind: "delete", target: item })} />}</> : <CorrespondenceActionButton label="Archiver" icon={Archive} disabled={actionBusy} onClick={() => void changeArchiveState(item, "archive")} />}</div></td></tr>)}</tbody></table>{filtered.length === 0 && <p className="p-6 text-center text-sm text-slate-500">Aucun courrier correspondant aux filtres actifs.</p>}</div>
    {formOpen && <AdminDrawer title={editing ? (input.direction === "outgoing" ? "Courrier sortant" : "Courrier entrant") : selectedDirection === "outgoing" ? "Nouveau courrier sortant" : selectedDirection === "incoming" ? "Nouveau courrier entrant" : "Nouveau courrier"} onClose={() => !busy && setFormOpen(false)} closeLabel="Fermer">
      {!editing && <label className="mb-4 grid gap-1 text-sm"><span>Type de courrier</span><select className="input" value={selectedDirection} onChange={(event) => { const nextDirection = event.target.value as "" | CorrespondenceDirection; setSelectedDirection(nextDirection); if (nextDirection) setInput({ ...input, direction: nextDirection, copiePourInformation: "" }); setFile(null); }}><option value="" disabled>Sélectionner le type</option><option value="incoming">Entrant</option><option value="outgoing">Sortant</option></select></label>}
      {(editing || selectedDirection) && (input.direction === "outgoing" ? <OutgoingCorrespondenceForm user={user} users={users} school={school} year={year} current={editing} busy={busy} onCancel={() => setFormOpen(false)} onSave={saveOutgoing} onPreview={printCorrespondence} /> : <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      {editing && <p className="font-semibold">{editing.referenceNumber}</p>}
      <input className="input" type="date" value={input.date} disabled={editing?.status === "archived"} onChange={(event) => setInput({ ...input, date: event.target.value })} />
      <input className="input" placeholder="Objet" value={input.subject} disabled={editing?.status === "archived"} onChange={(event) => setInput({ ...input, subject: event.target.value })} />
      <input className="input" placeholder="Expéditeur" value={input.sender} disabled={editing?.status === "archived"} onChange={(event) => setInput({ ...input, sender: event.target.value })} />
      <input className="input" placeholder="Destinataire" value={input.recipient} disabled={editing?.status === "archived"} onChange={(event) => setInput({ ...input, recipient: event.target.value })} />
      {input.direction === "incoming" && <>
        <input aria-label="Pièce jointe" type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" disabled={editing?.status === "archived"} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        {editing?.attachment && <a className="text-blue-700 underline" href={editing.attachment.url} target="_blank" rel="noreferrer">Voir la pièce jointe</a>}
      </>}
      {editing?.status !== "archived" && <button className="primary-button justify-center" disabled={busy} type="submit">{busy ? "Enregistrement…" : "Enregistrer"}</button>}
    </form>)}</AdminDrawer>}
    {sensitiveAction && <SensitiveActionDialog action="delete" value={confirmationText} error={confirmationError} busy={actionBusy} onValueChange={(value) => { setConfirmationText(value); setConfirmationError(value && value !== "SUPPRIMER DÉFINITIVEMENT" ? "Le texte de confirmation est incorrect." : ""); }} onCancel={closeSensitiveAction} onConfirm={() => void executeSensitiveAction()} />}
  </section>;
}

function TableCell({ value, strong = false }: { value?: string; strong?: boolean }) { return <td className={`truncate p-3 ${strong ? "font-semibold" : ""}`} title={value || "-"}>{value || "-"}</td>; }

function CorrespondenceActionButton({ label, icon: Icon, onClick, danger = false, disabled = false, loading = false }: { label: string; icon: typeof Eye; onClick: () => void; danger?: boolean; disabled?: boolean; loading?: boolean }) { return <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled} className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-50 ${danger ? "bg-red-50 text-red-700 hover:bg-red-100" : "bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-950"}`}><Icon aria-hidden="true" className={`h-4 w-4 ${loading ? "animate-pulse" : ""}`} /></button>; }

function SensitiveActionDialog({ value, error, busy, onValueChange, onCancel, onConfirm }: { action: "delete"; value: string; error: string; busy: boolean; onValueChange: (value: string) => void; onCancel: () => void; onConfirm: () => void }) {
  const expected = "SUPPRIMER DÉFINITIVEMENT";
  const title = "SUPPRIMER LE COURRIER";
  const message = "Cette opération est définitive. Le courrier sera supprimé de manière irréversible.";
  const actionLabel = "Supprimer définitivement";
  return <div role="dialog" aria-modal="true" aria-labelledby="sensitive-action-title" aria-describedby="sensitive-action-description" className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/50 p-4"><form className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl" onSubmit={(event) => { event.preventDefault(); if (value === expected && !busy) onConfirm(); }}><h3 id="sensitive-action-title" className="text-lg font-extrabold">{title}</h3><p id="sensitive-action-description" className="mt-3 text-sm text-slate-700">{message}<br /><br />Pour confirmer, saisissez exactement :<br /><strong>{expected}</strong></p><label className="mt-4 grid gap-1 text-sm font-semibold">Texte de confirmation<input autoFocus className="input" value={value} disabled={busy} aria-invalid={Boolean(error)} aria-describedby={error ? "sensitive-action-error" : undefined} onChange={(event) => onValueChange(event.target.value)} /></label>{error && <p id="sensitive-action-error" role="alert" className="mt-2 text-sm font-semibold text-red-700">{error}</p>}<div className="mt-5 flex justify-end gap-2"><button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>Annuler</button><button type="submit" className="rounded bg-red-700 px-4 py-2 font-semibold text-white disabled:opacity-50" disabled={busy || value !== expected}>{busy ? "Traitement…" : actionLabel}</button></div></form></div>;
}

function correspondenceTypeLabel(value?: string) {
  return ({ administrative_letter: "Lettre administrative", official_request: "Demande officielle", administrative_response: "Réponse administrative", transmission_letter: "Lettre de transmission", summons: "Convocation", notification: "Notification", formal_notice: "Mise en demeure", information_letter: "Lettre d’information", other: "Autre courrier sortant" } as Record<string, string>)[value ?? ""] ?? "Courrier sortant";
}
