import { useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, Download, FilePlus2, FileText, Trash2 } from "lucide-react";
import { AdminDrawer, SectionTitle } from "../../components/ui";
import { archiveSecretaryReport, createSecretaryReport, deleteSecretaryReportPermanently, restoreSecretaryReport, subscribeToSecretaryReports, updateSecretaryReport } from "../../services/secretaryReports";
import { escapePdfHtml, pdfInfoGrid, pdfSection, renderAcadPdfPreview } from "../../utils/pdf";
import { refreshErrorMessage } from "../../utils/refreshErrors";
import type { AppUser, School, SchoolYear } from "../../types";
import type { SecretaryReport, SecretaryReportType } from "./secretaryTypes";
import { SecretaryAiAssistant } from "./SecretaryAiAssistant";
import { applyReportAiSections, buildReportAiSections, MEETING_MINUTES_SECTION_LABELS, MEETING_MINUTES_SECTION_ORDER, reportAiSectionLabels, REPORT_AI_SECTION_DEFINITIONS } from "./reportAiSections";
import { normalizeReportSignatories, prepareReportSignatories, reportSignatoriesPdfHtml, type ReportSignatory } from "./reportSignatories";
import { PdfSettingsFields } from "../../components/pdf/PdfSettingsFields";
import { DEFAULT_PDF_SETTINGS, normalizePdfSettings, pdfEditorStyle, readStoredPdfSettings, type PdfGenerationSettings } from "../../utils/pdfSettings";
import { filterSecretaryReports } from "./secretaryListFilters";
import { exportSecretaryReportListPdf } from "./secretaryListPdf";
import { SignatoriesEditor } from "./SignatoriesEditor";
import { SecretaryDocumentFormActions } from "./SecretaryDocumentFormActions";
import { SecretaryViewActionButton } from "./SecretaryViewActionButton";

const reportFields: Record<SecretaryReportType, string[]> = {
  meeting_minutes: MEETING_MINUTES_SECTION_ORDER.filter((field) => field !== "signatures"),
  activity_report: REPORT_AI_SECTION_DEFINITIONS.activity_report.map(({ formField }) => formField),
  incident_report: REPORT_AI_SECTION_DEFINITIONS.incident_report.map(({ formField }) => formField),
  official_minutes: [...REPORT_AI_SECTION_DEFINITIONS.official_minutes.map(({ formField }) => formField), "signatures"],
  administrative_note: [...REPORT_AI_SECTION_DEFINITIONS.administrative_note.map(({ formField }) => formField), "signataire"],
  other: [...REPORT_AI_SECTION_DEFINITIONS.other.map(({ formField }) => formField), "signatures"],
};
const labels: Record<SecretaryReportType, string> = { meeting_minutes: "Compte rendu", activity_report: "Rapport d'activités", incident_report: "Rapport d'incident", official_minutes: "Procès-verbal", administrative_note: "Note administrative", other: "Autre rapport officiel" };
const meetingMinutesFormLabels: Record<string, string> = { lieu: "Lieu", objet: "Objet", participants: "Participants", "points abordés": "Points abordés", décisions: "Décisions", recommandations: "Recommandations" };

export function SecretaryReportsModule({ user, school, year }: { user: AppUser; school: School; year: SchoolYear }) {
  const [reports, setReports] = useState<SecretaryReport[]>([]);
  const [selected, setSelected] = useState<SecretaryReport | null>(null);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<SecretaryReportType>("meeting_minutes");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [content, setContent] = useState<Record<string, string>>({});
  const [signatories, setSignatories] = useState<ReportSignatory[]>([]);
  const [pdfSettings, setPdfSettings] = useState<PdfGenerationSettings>(DEFAULT_PDF_SETTINGS);
  const [queryText, setQueryText] = useState("");
  const [typeFilter, setTypeFilter] = useState<"" | "all" | SecretaryReportType>("");
  const [archiveView, setArchiveView] = useState<"active" | "archived">("active");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SecretaryReport | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [pdfBusyId, setPdfBusyId] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  useEffect(() => subscribeToSecretaryReports({ user, schoolId: school.id, schoolYearId: year.id, onData: setReports, onError: (error) => setMessage(refreshErrorMessage(error)) }), [school.id, user, year.id]);
  const visible = useMemo(() => filterSecretaryReports(reports, queryText, typeFilter || "all", labels).filter((report) => archiveView === "archived" ? report.status === "archived" : report.status !== "archived"), [archiveView, queryText, reports, typeFilter]);
  const aiSections = useMemo(() => buildReportAiSections(type, content), [content, type]);
  const aiSectionLabels = useMemo(() => reportAiSectionLabels(type), [type]);
  const editorStyle = useMemo(() => pdfEditorStyle(pdfSettings), [pdfSettings]);
  const readOnly = Boolean(selected && selected.status !== "draft");

  function show(report?: SecretaryReport) {
    setSelected(report ?? null); setType(report?.type ?? "meeting_minutes"); setTitle(report?.title ?? ""); setDate(report?.documentDate ?? new Date().toISOString().slice(0, 10)); setStartTime(report?.startTime ?? ""); setEndTime(report?.endTime ?? ""); setContent(report?.structuredContent ?? {}); setSignatories(normalizeReportSignatories(report?.signatories, report?.structuredContent?.signatures)); setPdfSettings(report ? normalizePdfSettings(report.pdfSettings) : readStoredPdfSettings()); setFormError(""); setOpen(true);
  }
  async function save() {
    if (busy) return;
    if (!type || !title.trim() || !date || Number.isNaN(new Date(`${date}T00:00:00`).getTime()) || !startTime || !endTime || reportFields[type].some((field) => !content[field]?.trim())) { setFormError("Renseignez le type, le titre, une date valide, les heures et tous les champs obligatoires."); return; }
    if (endTime < startTime) { setFormError("L'heure de fin doit être postérieure ou égale à l'heure de début."); return; }
    const preparedSignatories = prepareReportSignatories(signatories);
    if (type === "meeting_minutes" && preparedSignatories.error) { setFormError(preparedSignatories.error); return; }
    setBusy(true); setMessage(""); setFormError("");
    const structuredContent = type === "meeting_minutes" ? Object.fromEntries(Object.entries(content).filter(([key]) => key !== "signatures")) : content;
    try { if (selected) await updateSecretaryReport(user, selected, { type, title, documentDate: date, startTime, endTime, structuredContent, signatories: type === "meeting_minutes" ? preparedSignatories.items : selected.signatories, pdfSettings }); else await createSecretaryReport({ user, schoolId: school.id, schoolYearId: year.id, type, title, documentDate: date, startTime, endTime, structuredContent, pdfSettings, ...(type === "meeting_minutes" ? { signatories: preparedSignatories.items } : {}) }); setSelected(null); setType("meeting_minutes"); setTitle(""); setDate(new Date().toISOString().slice(0, 10)); setStartTime(""); setEndTime(""); setContent({}); setSignatories([]); setPdfSettings(DEFAULT_PDF_SETTINGS); setOpen(false); setMessage("Rapport généré et enregistré en brouillon."); }
    catch (error) { console.error("Échec de la génération du rapport", error); setFormError(error instanceof Error ? error.message : "Génération du rapport impossible."); } finally { setBusy(false); }
  }
  async function preview(report: SecretaryReport) {
    const reportSignatories = normalizeReportSignatories(report.signatories, report.structuredContent.signatures);
    const contentEntries = report.type === "meeting_minutes" ? MEETING_MINUTES_SECTION_ORDER.filter((key) => key !== "signatures").map((key) => [key, report.structuredContent[key] ?? ""] as const) : Object.entries(report.structuredContent);
    const signaturesHtml = reportSignatoriesPdfHtml(reportSignatories);
    await renderAcadPdfPreview({ filename: `${report.reportNumber}.pdf`, title: report.title, school, year, subtitle: `${labels[report.type]} · ${report.reportNumber}`, pdfSettings: report.pdfSettings, sections: [`<div class="report-info-row">${pdfInfoGrid([{ label: "DATE", value: report.documentDate }, { label: "HEURE DE DÉBUT", value: report.startTime || "Non renseignée" }, { label: "HEURE DE FIN", value: report.endTime || "Non renseignée" }, { label: "AUTEUR", value: report.authorName }])}</div>`, ...contentEntries.map(([key, value]) => pdfSection(report.type === "meeting_minutes" ? MEETING_MINUTES_SECTION_LABELS[key as keyof typeof MEETING_MINUTES_SECTION_LABELS] : key, `<p class="report-justified-text">${escapePdfHtml(value)}</p>`, { className: "report-section" })), ...(report.type === "meeting_minutes" && signaturesHtml ? [signaturesHtml] : [])] });
  }

  async function showReportPdf(report: SecretaryReport) {
    if (pdfBusyId) return;
    setPdfBusyId(report.id); setMessage("");
    try { await preview(report); }
    catch (error) { console.error("Échec de génération du PDF du rapport", error); setMessage(error instanceof Error ? error.message : "Impossible d'afficher le PDF du rapport."); }
    finally { setPdfBusyId(""); }
  }

  async function exportFilteredReports() {
    if (exportBusy || visible.length === 0) return;
    setExportBusy(true); setMessage("");
    const filters = [queryText.trim() ? `Recherche : ${queryText.trim()}` : "", typeFilter && typeFilter !== "all" ? `Type : ${labels[typeFilter]}` : ""].filter(Boolean).join(" · ");
    try { await exportSecretaryReportListPdf({ rows: visible, school, year, filters, typeLabels: labels }); }
    catch (error) { console.error("Échec de l'export PDF des rapports", error); setMessage(error instanceof Error ? error.message : "Export PDF des rapports impossible."); }
    finally { setExportBusy(false); }
  }

  async function confirmPermanentDelete() {
    if (!deleteTarget || deleteBusy || deleteConfirmation !== "SUPPRIMER DÉFINITIVEMENT") return;
    setDeleteBusy(true);
    try {
      await deleteSecretaryReportPermanently(user, deleteTarget, deleteConfirmation);
      setReports((current) => current.filter((report) => report.id !== deleteTarget.id));
      setMessage("Rapport supprimé définitivement.");
      setDeleteTarget(null);
      setDeleteConfirmation("");
    } catch (error) {
      console.error("Échec de la suppression définitive du rapport", error);
      setMessage(error instanceof Error ? error.message : "Suppression du rapport impossible.");
    } finally {
      setDeleteBusy(false);
    }
  }

  async function changeArchiveState(report: SecretaryReport, action: "archive" | "restore") {
    if (deleteBusy) return;
    setDeleteBusy(true); setMessage("");
    try {
      if (action === "archive") await archiveSecretaryReport(user, report); else await restoreSecretaryReport(user, report);
      setMessage(action === "archive" ? "Rapport archivé." : "Rapport restauré.");
    } catch (error) { console.error("Échec de l’archivage du rapport", error); setMessage(error instanceof Error ? error.message : "Action impossible."); }
    finally { setDeleteBusy(false); }
  }

  return <section className="grid gap-4"><SectionTitle title="Rapports" subtitle="Documents administratifs structurés de l'établissement." />{message && <p className="rounded border bg-white p-3 text-sm">{message}</p>}
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[auto_minmax(220px,1fr)_220px_180px_auto]"><button type="button" className="primary-button justify-center" onClick={() => show()}><FilePlus2 className="h-4 w-4" /> Nouveau rapport</button><input className="input min-w-0" placeholder="Rechercher" value={queryText} onChange={(event) => setQueryText(event.target.value)} /><select className="input" aria-label="Types de rapport" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}><option value="" disabled>Types de rapport</option><option value="all">Tous les types</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select className="input" aria-label="État d’archivage" value={archiveView} onChange={(event) => setArchiveView(event.target.value as typeof archiveView)}><option value="active">Rapports actifs</option><option value="archived">Archives</option></select><button type="button" className="pdf-export-button" disabled={exportBusy || visible.length === 0} onClick={() => void exportFilteredReports()}><Download className="h-4 w-4" /> {exportBusy ? "Export en cours…" : "Exporter PDF"}</button></div>
    <div className="overflow-x-auto rounded border bg-white"><table className="min-w-[720px] w-full text-sm"><thead className="bg-slate-50 text-left"><tr><th className="p-3">Numéro</th><th>Titre</th><th>Type</th><th>Date</th><th className="text-center">Actions</th></tr></thead><tbody>{visible.map((report) => <tr className="border-t" key={report.id}><td className="p-3 font-semibold">{report.reportNumber}</td><td>{report.title}</td><td>{labels[report.type]}</td><td>{report.documentDate}</td><td><div className="flex items-center justify-center gap-1.5"><SecretaryViewActionButton onClick={() => show(report)} /><button type="button" title="Afficher le PDF" aria-label="Afficher le PDF" disabled={Boolean(pdfBusyId)} className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-slate-700 transition hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-50" onClick={() => void showReportPdf(report)}><FileText className={`h-4 w-4 ${pdfBusyId === report.id ? "animate-pulse" : ""}`} /></button>{report.status === "archived" ? <><button type="button" title="Restaurer" aria-label="Restaurer" disabled={deleteBusy} className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50" onClick={() => void changeArchiveState(report, "restore")}><ArchiveRestore className="h-4 w-4" /></button>{report.authorId === user.id && report.archivedFromStatus === "draft" && <button type="button" title="Supprimer définitivement" aria-label="Supprimer définitivement" disabled={deleteBusy} className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50" onClick={() => { setDeleteTarget(report); setDeleteConfirmation(""); }}><Trash2 className="h-4 w-4" /></button>}</> : <button type="button" title="Archiver" aria-label="Archiver" disabled={deleteBusy} className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50" onClick={() => void changeArchiveState(report, "archive")}><Archive className="h-4 w-4" /></button>}</div></td></tr>)}</tbody></table>{visible.length === 0 && <p className="p-6 text-center text-sm text-slate-500">Aucun rapport correspondant à la recherche et au type sélectionné.</p>}</div>
    {open && <AdminDrawer title={selected ? selected.reportNumber : "Nouveau rapport"} onClose={() => !busy && setOpen(false)} closeLabel="Fermer"><form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      {!readOnly && <div className="flex justify-end"><SecretaryAiAssistant user={user} schoolId={school.id} academicYearId={year.id} documentId={selected?.id} documentType={type} documentCategory="rapport" documentTypeLabel={labels[type]} documentDate={date} documentTime={startTime} documentEndTime={endTime} schoolName={school.name} academicYearName={year.name} sections={aiSections} sectionLabels={aiSectionLabels} aiAssistant={school.aiAssistant} onAccept={() => undefined} onApplySections={(generated) => setContent((previous) => { const updatedFormValues = applyReportAiSections(type, previous, generated); if (import.meta.env.VITE_APP_ENV !== "production") console.info("Secretary AI report form updated", { updatedFormValues }); return updatedFormValues; })} /></div>}
      <label className="grid gap-1 text-sm font-semibold">Type de rapport<select aria-label="Type de rapport" className="input" value={type} disabled={readOnly} onChange={(event) => { setType(event.target.value as SecretaryReportType); setContent({}); setFormError(""); }}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <input className="input" value={title} disabled={readOnly} placeholder="Titre" onChange={(event) => setTitle(event.target.value)} />
      <label className="grid gap-1 text-sm font-semibold">Date<input className="input" type="date" value={date} disabled={readOnly} onChange={(event) => setDate(event.target.value)} /></label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold">Heure de début<input className="input" type="time" value={startTime} disabled={readOnly} onChange={(event) => setStartTime(event.target.value)} /></label><label className="grid gap-1 text-sm font-semibold">Heure de fin<input className="input" type="time" value={endTime} disabled={readOnly} onChange={(event) => setEndTime(event.target.value)} /></label></div>
      {reportFields[type].map((field) => <label className="report-form-section grid gap-1 pt-2 text-sm font-semibold first:pt-0" key={field}><span>{type === "meeting_minutes" ? meetingMinutesFormLabels[field] : field}</span><textarea className={`input ${type === "meeting_minutes" && (field === "lieu" || field === "objet") ? "min-h-12" : "min-h-20"}`} style={editorStyle} disabled={readOnly} value={content[field] ?? ""} onChange={(event) => setContent({ ...content, [field]: event.target.value })} /></label>)}
      {type === "meeting_minutes" && <div className="report-form-section pt-2"><SignatoriesEditor value={signatories} onChange={setSignatories} readOnly={readOnly} title="Signataires" /></div>}
      <PdfSettingsFields value={pdfSettings} onChange={setPdfSettings} disabled={readOnly || busy} />
      {formError && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{formError}</p>}
      <SecretaryDocumentFormActions generateLabel={selected ? "Enregistrer" : "Générer rapport"} busyLabel={selected ? "Enregistrement en cours…" : "Génération en cours…"} busy={busy} disabled={readOnly} onCancel={() => setOpen(false)} />
    </form></AdminDrawer>}
    {deleteTarget && <div role="dialog" aria-modal="true" aria-labelledby="delete-report-title" className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/50 p-4"><form className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl" onSubmit={(event) => { event.preventDefault(); void confirmPermanentDelete(); }}><h3 id="delete-report-title" className="text-lg font-extrabold">SUPPRIMER DÉFINITIVEMENT</h3><p className="mt-3 text-sm text-slate-700">Cette opération est définitive. Pour confirmer, saisissez exactement :<br /><strong>SUPPRIMER DÉFINITIVEMENT</strong></p><input autoFocus className="input mt-4" value={deleteConfirmation} disabled={deleteBusy} onChange={(event) => setDeleteConfirmation(event.target.value)} /><div className="mt-5 flex justify-end gap-2"><button type="button" className="secondary-button" disabled={deleteBusy} onClick={() => { setDeleteTarget(null); setDeleteConfirmation(""); }}>Annuler</button><button type="submit" className="rounded bg-red-700 px-4 py-2 font-semibold text-white disabled:opacity-50" disabled={deleteBusy || deleteConfirmation !== "SUPPRIMER DÉFINITIVEMENT"}>{deleteBusy ? "Suppression…" : "Supprimer définitivement"}</button></div></form></div>}
  </section>;
}
