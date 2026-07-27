import { useEffect, useMemo, useState } from "react";
import { Archive, Eye, FilePlus2, LockKeyhole } from "lucide-react";
import { AdminDrawer, SectionTitle } from "../../components/ui";
import { archiveSecretaryReport, createSecretaryReport, finalizeSecretaryReport, subscribeToSecretaryReports, updateSecretaryReport } from "../../services/secretaryReports";
import { escapePdfHtml, pdfInfoGrid, pdfSection, renderAcadPdfPreview } from "../../utils/pdf";
import type { AppUser, School, SchoolYear } from "../../types";
import type { SecretaryReport, SecretaryReportStatus, SecretaryReportType } from "./secretaryTypes";

const reportFields: Record<SecretaryReportType, string[]> = {
  meeting_minutes: ["heure", "lieu", "objet", "participants", "points abordés", "décisions", "recommandations", "signatures"],
  official_minutes: ["lieu", "objet", "participants", "ordre du jour", "déroulement", "résolutions", "signatures"],
  incident_report: ["heure", "lieu", "personnes concernées", "description des faits", "mesures prises", "recommandations", "auteur"],
  activity_report: ["période", "service ou activité", "objectifs", "activités réalisées", "résultats", "difficultés", "recommandations", "auteur"],
  administrative_note: ["numéro", "objet", "destinataires", "date d'application", "contenu", "signataire"],
  other: ["objet", "sections structurées", "auteur", "signatures"],
};
const labels: Record<SecretaryReportType, string> = { meeting_minutes: "Compte rendu", activity_report: "Rapport d'activités", incident_report: "Rapport d'incident", official_minutes: "Procès-verbal", administrative_note: "Note administrative", other: "Autre rapport officiel" };

export function SecretaryReportsModule({ user, school, year }: { user: AppUser; school: School; year: SchoolYear }) {
  const [reports, setReports] = useState<SecretaryReport[]>([]);
  const [selected, setSelected] = useState<SecretaryReport | null>(null);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<SecretaryReportType>("meeting_minutes");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [content, setContent] = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] = useState<"all" | SecretaryReportStatus>("all");
  const [queryText, setQueryText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => subscribeToSecretaryReports({ user, schoolId: school.id, schoolYearId: year.id, onData: setReports, onError: () => setMessage("Impossible d'actualiser les rapports.") }), [school.id, user, year.id]);
  const visible = useMemo(() => reports.filter((report) => (statusFilter === "all" || report.status === statusFilter) && `${report.reportNumber} ${report.title}`.toLowerCase().includes(queryText.toLowerCase())), [queryText, reports, statusFilter]);
  const readOnly = selected?.status !== "draft";

  function show(report?: SecretaryReport) {
    setSelected(report ?? null); setType(report?.type ?? "meeting_minutes"); setTitle(report?.title ?? ""); setDate(report?.documentDate ?? new Date().toISOString().slice(0, 10)); setContent(report?.structuredContent ?? {}); setOpen(true);
  }
  async function save() {
    if (busy || !title.trim() || reportFields[type].some((field) => !content[field]?.trim())) return;
    setBusy(true); setMessage("");
    try { if (selected) await updateSecretaryReport(user, selected, { type, title, documentDate: date, structuredContent: content }); else await createSecretaryReport({ user, schoolId: school.id, schoolYearId: year.id, type, title, documentDate: date, structuredContent: content }); setOpen(false); setMessage("Rapport enregistré en brouillon."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Enregistrement impossible."); } finally { setBusy(false); }
  }
  async function preview(report: SecretaryReport) {
    await renderAcadPdfPreview({ filename: `${report.reportNumber}.pdf`, title: report.title, school, year, subtitle: `${labels[report.type]} · ${report.reportNumber}`, sections: [pdfInfoGrid([{ label: "Date", value: report.documentDate }, { label: "Auteur", value: report.authorName }, { label: "Statut", value: report.status }]), ...Object.entries(report.structuredContent).map(([key, value]) => pdfSection(key, `<p>${escapePdfHtml(value)}</p>`))] });
  }

  return <section className="grid gap-4"><SectionTitle title="Rapports" subtitle="Documents administratifs structurés de l'établissement." />{message && <p className="rounded border bg-white p-3 text-sm">{message}</p>}
    <div className="grid gap-2 sm:grid-cols-3"><button type="button" className="primary-button justify-center" onClick={() => show()}><FilePlus2 className="h-4 w-4" /> Nouveau rapport</button><input className="input" placeholder="Rechercher" value={queryText} onChange={(event) => setQueryText(event.target.value)} /><select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">Tous les statuts</option><option value="draft">Brouillons</option><option value="finalized">Finalisés</option><option value="archived">Archivés</option></select></div>
    <div className="overflow-x-auto rounded border bg-white"><table className="min-w-[760px] w-full text-sm"><thead className="bg-slate-50 text-left"><tr><th className="p-3">Numéro</th><th>Titre</th><th>Type</th><th>Date</th><th>Statut</th><th>Actions</th></tr></thead><tbody>{visible.map((report) => <tr className="border-t" key={report.id}><td className="p-3 font-semibold">{report.reportNumber}</td><td>{report.title}</td><td>{labels[report.type]}</td><td>{report.documentDate}</td><td>{report.status}</td><td><div className="flex gap-1"><button className="secondary-button" onClick={() => show(report)}><Eye className="h-4 w-4" /> Voir</button><button className="secondary-button" onClick={() => void preview(report)}>PDF</button>{report.status === "draft" && <button className="secondary-button" onClick={() => void finalizeSecretaryReport(user, report)}><LockKeyhole className="h-4 w-4" /> Finaliser</button>}{report.status !== "archived" && <button className="secondary-button" onClick={() => void archiveSecretaryReport(user, report)}><Archive className="h-4 w-4" /></button>}</div></td></tr>)}</tbody></table>{visible.length === 0 && <p className="p-6 text-center text-sm text-slate-500">Aucun rapport.</p>}</div>
    {open && <AdminDrawer title={selected ? selected.reportNumber : "Nouveau rapport"} onClose={() => !busy && setOpen(false)} closeLabel="Fermer"><form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void save(); }}><select className="input" value={type} disabled={readOnly} onChange={(event) => { setType(event.target.value as SecretaryReportType); setContent({}); }}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input className="input" value={title} disabled={readOnly} placeholder="Titre" onChange={(event) => setTitle(event.target.value)} /><input className="input" type="date" value={date} disabled={readOnly} onChange={(event) => setDate(event.target.value)} />{reportFields[type].map((field) => <label className="grid gap-1 text-sm font-semibold" key={field}>{field}<textarea className="input min-h-20" disabled={readOnly} value={content[field] ?? ""} onChange={(event) => setContent({ ...content, [field]: event.target.value })} /></label>)}{!readOnly && <button className="primary-button justify-center" disabled={busy} type="submit">{busy ? "Enregistrement…" : "Enregistrer le brouillon"}</button>}{selected && <button className="secondary-button justify-center" type="button" onClick={() => void preview({ ...selected, type, title, documentDate: date, structuredContent: content })}>Prévisualiser / PDF</button>}</form></AdminDrawer>}
  </section>;
}
