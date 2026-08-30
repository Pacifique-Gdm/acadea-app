import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { AppUser, School, SchoolYear } from "../../types";
import { outgoingRecipientLines } from "./outgoingCorrespondencePdf";
import type { AnnouncedCorrespondenceAttachment, Correspondence, CorrespondenceCopy, CorrespondenceStatus, OutgoingCorrespondenceData } from "./secretaryTypes";
import { SecretaryAiAssistant } from "./SecretaryAiAssistant";
import { PdfSettingsFields } from "../../components/pdf/PdfSettingsFields";
import { normalizePdfSettings, pdfEditorStyle, readStoredPdfSettings, type PdfGenerationSettings } from "../../utils/pdfSettings";
import { normalizeCorrespondenceSignatories, prepareReportSignatories, type ReportSignatory } from "./reportSignatories";
import { SignatoriesEditor } from "./SignatoriesEditor";
import { SecretaryDocumentFormActions } from "./SecretaryDocumentFormActions";
import { CORRESPONDENCE_DELIVERY_MODES } from "./correspondenceOptions";

const today = () => new Date().toISOString().slice(0, 10);
export const DEFAULT_OUTGOING_ISSUE_PLACE = "Kinshasa / RDC";
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const correspondenceTypes = [
  ["administrative_letter", "Lettre administrative"], ["official_request", "Demande officielle"], ["administrative_response", "Réponse administrative"], ["transmission_letter", "Lettre de transmission"], ["summons", "Convocation"], ["notification", "Notification"], ["formal_notice", "Mise en demeure"], ["information_letter", "Lettre d’information"], ["other", "Autre courrier sortant"],
] as const;
const salutations = ["Monsieur le Directeur,", "Madame la Directrice,", "Monsieur l’Inspecteur,", "Madame l’Inspectrice,", "Monsieur,", "Madame,", "Madame, Monsieur,", "Mesdames et Messieurs,"];
const closings = ["Veuillez agréer, Monsieur le Directeur, l’expression de notre haute considération.", "Veuillez agréer, Madame la Directrice, l’expression de notre considération distinguée.", "Nous vous prions d’agréer, Monsieur, l’expression de nos salutations distinguées.", "Recevez, Madame, Monsieur, l’assurance de notre parfaite considération."];

function initialOutgoing(user: AppUser, school: School, year: SchoolYear): OutgoingCorrespondenceData {
  return {
    correspondenceType: "administrative_letter", issuePlace: DEFAULT_OUTGOING_ISSUE_PLACE, academicYearName: year.name, authorName: user.name,
    priority: "normal", confidentiality: "public", deliveryMode: "hand_delivery", recipient: { salutation: "mr" }, salutation: salutations[0], introduction: "", mainMessage: "", conclusion: "", closingFormula: closings[0],
    signer: { userId: "", fullName: "", functionTitle: "", signatureType: "handwritten_space", signatureRequired: true, stampRequired: true, signatureSpace: "medium" }, signatories: [],
    announcedAttachments: [], copies: [], version: 1,
  };
}

export type OutgoingSaveRequest = { item: Correspondence; status: CorrespondenceStatus };

export function OutgoingCorrespondenceForm({ user, school, year, current, busy, onCancel, onSave, onPreview }: {
  user: AppUser; users: AppUser[]; school: School; year: SchoolYear; current: Correspondence | null; busy: boolean;
  onCancel: () => void; onSave: (request: OutgoingSaveRequest) => Promise<void>; onPreview: (item: Correspondence) => Promise<void>;
}) {
  const [date, setDate] = useState(current?.date ?? today());
  const [subject, setSubject] = useState(current?.subject ?? "");
  const [outgoing, setOutgoing] = useState<OutgoingCorrespondenceData>(() => current?.outgoing ?? initialOutgoing(user, school, year));
  const [signatories, setSignatories] = useState<ReportSignatory[]>(() => normalizeCorrespondenceSignatories(current?.outgoing?.signatories, current?.outgoing?.signer));
  const [pdfSettings, setPdfSettings] = useState<PdfGenerationSettings>(() => current ? normalizePdfSettings(current.pdfSettings) : readStoredPdfSettings());
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const locked = year.status !== "active" || current?.status === "archived" || (current?.status && current.status !== "draft");
  const aiSections = { subject, salutation: outgoing.salutation, introduction: outgoing.introduction, mainMessage: outgoing.mainMessage, details: outgoing.details ?? "", justification: outgoing.justification ?? "", expectedFollowUp: outgoing.expectedFollowUp ?? "", conclusion: outgoing.conclusion, closingFormula: outgoing.closingFormula };
  const aiSectionLabels = { subject: "Objet", salutation: "Formule d’appel", introduction: "Introduction", mainMessage: "Message principal", details: "Détails et modalités", justification: "Justification", expectedFollowUp: "Suite attendue", conclusion: "Conclusion", closingFormula: "Formule de politesse" };
  const editorStyle = pdfEditorStyle(pdfSettings);
  const correspondenceTypeLabel = correspondenceTypes.find(([value]) => value === outgoing.correspondenceType)?.[1] ?? "Courrier sortant";

  const set = <K extends keyof OutgoingCorrespondenceData>(key: K, value: OutgoingCorrespondenceData[K]) => { setDirty(true); setOutgoing((previous) => ({ ...previous, [key]: value })); };
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty && !locked) event.preventDefault(); };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, locked]);
  const cancel = () => { if (!dirty || locked || window.confirm("Quitter sans enregistrer les modifications ?")) onCancel(); };
  const item = (): Correspondence => {
    const prepared = prepareReportSignatories(signatories);
    const first = prepared.items[0];
    const outgoingPayload = { ...outgoing, signatories: prepared.items, ...(first ? { signer: { ...outgoing.signer, fullName: first.name, functionTitle: first.functionTitle } } : {}) };
    for (const key of ["sendingChannel", "customSendingChannel", "plannedSendDate", "recipientEmail", "receiptRequired", "sentBy", "actualSendDate", "confirmedReceptionDate"] as const) delete outgoingPayload[key];
    return {
    id: current?.id ?? "preview", referenceNumber: current?.referenceNumber ?? "Attribuée lors de l’enregistrement", direction: "outgoing", date, subject,
    sender: school.name, recipient: outgoing.recipient.fullName || outgoing.recipient.functionTitle || "", content: [outgoing.introduction, outgoing.mainMessage, outgoing.details, outgoing.justification, outgoing.expectedFollowUp, outgoing.conclusion].filter(Boolean).join("\n\n"),
    status: current?.status ?? "draft", createdBy: current?.createdBy ?? user.id, createdAt: current?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(), schoolId: school.id, schoolYearId: year.id, outgoing: outgoingPayload, pdfSettings,
    };
  };
  function validate() {
    const prepared = prepareReportSignatories(signatories);
    if (prepared.error) return prepared.error;
    if (!prepared.items.length) return "Ajoutez au moins un signataire.";
    if (!outgoing.correspondenceType || !date || !outgoing.issuePlace.trim() || (!outgoing.recipient.functionTitle?.trim() && !outgoing.recipient.fullName?.trim()) || !subject.trim() || !outgoing.salutation.trim() || !outgoing.introduction.trim() || !outgoing.mainMessage.trim() || !outgoing.conclusion.trim() || !outgoing.closingFormula.trim()) return "Renseignez tous les champs obligatoires du courrier.";
    if (outgoing.correspondenceType === "other" && !outgoing.customCorrespondenceType?.trim()) return "Précisez le type de courrier.";
    if (outgoing.recipient.salutation === "other" && !outgoing.recipient.customSalutation?.trim()) return "Précisez la civilité.";
    return "";
  }
  async function act(status: CorrespondenceStatus) {
    if (locked || busy) return;
    const validation = validate(); if (validation) { setError(validation); return; }
    setError(""); await onSave({ item: item(), status });
  }
  async function generate() { const validation = validate(); if (validation) { setError(validation); return; } setError(""); if (current) await onPreview(item()); else await act("draft"); }
  const recipient = outgoing.recipient;
  function acceptAi(section: string, value: string) {
    const keys: Record<string, keyof OutgoingCorrespondenceData> = { salutation: "salutation", introduction: "introduction", mainMessage: "mainMessage", details: "details", justification: "justification", expectedFollowUp: "expectedFollowUp", conclusion: "conclusion", closingFormula: "closingFormula" };
    if (section === "subject") { setDirty(true); setSubject(value); }
    else if (keys[section]) set(keys[section], value as never);
  }
  function applyAiSections(generated: Record<string, string>) { Object.entries(generated).forEach(([key, value]) => acceptAi(key, value)); }

  return <form className="grid gap-5" onSubmit={(event) => { event.preventDefault(); void act("draft"); }}>
    {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {!locked && <div className="flex justify-end"><SecretaryAiAssistant user={user} schoolId={school.id} academicYearId={year.id} documentId={current?.id} documentType="outgoing_correspondence" documentCategory="courrier" documentTypeLabel={correspondenceTypeLabel} documentDate={date} schoolName={school.name} academicYearName={year.name} sections={aiSections} sectionLabels={aiSectionLabels} aiAssistant={school.aiAssistant} onAccept={acceptAi} onApplySections={applyAiSections} /></div>}
    <fieldset disabled={Boolean(locked) || busy} className="grid gap-5 disabled:opacity-75">
      <FormSection title="1. Identification"><Select label="Type de courrier *" value={outgoing.correspondenceType} onChange={(value) => set("correspondenceType", value as OutgoingCorrespondenceData["correspondenceType"])} options={correspondenceTypes} />{outgoing.correspondenceType === "other" && <Field label="Préciser le type de courrier *" value={outgoing.customCorrespondenceType ?? ""} onChange={(value) => set("customCorrespondenceType", value)} />}<ReadOnly label="Référence du courrier" value={current?.referenceNumber ?? "Attribuée lors de l’enregistrement"} /><Field label="Date du courrier *" type="date" value={date} onChange={setDate} /><Field label="Lieu d’émission *" value={outgoing.issuePlace} onChange={(value) => set("issuePlace", value)} /><ReadOnly label="Année scolaire" value={year.name} /></FormSection>
      <FormSection title="2. Destinataire"><Select label="Civilité" value={recipient.salutation} onChange={(value) => set("recipient", { ...recipient, salutation: value as typeof recipient.salutation })} options={[["mr", "Monsieur"], ["mrs", "Madame"], ["ladies_gentlemen", "Mesdames et Messieurs"], ["other", "Autre"]]} />{recipient.salutation === "other" && <Field label="Préciser la civilité" value={recipient.customSalutation ?? ""} onChange={(value) => set("recipient", { ...recipient, customSalutation: value })} />}<Field label="Fonction ou qualité du destinataire *" value={recipient.functionTitle ?? ""} onChange={(value) => set("recipient", { ...recipient, functionTitle: value })} /><Field label="Nom complet du destinataire" value={recipient.fullName ?? ""} onChange={(value) => set("recipient", { ...recipient, fullName: value })} /><Field label="Institution ou organisme" value={recipient.institution ?? ""} onChange={(value) => set("recipient", { ...recipient, institution: value })} /><Area label="Adresse du destinataire" value={recipient.address ?? ""} onChange={(value) => set("recipient", { ...recipient, address: value })} /><Field label="Ville ou localité" value={recipient.city ?? ""} onChange={(value) => set("recipient", { ...recipient, city: value })} /><Field label="Pays" value={recipient.country ?? ""} onChange={(value) => set("recipient", { ...recipient, country: value })} /><div className="rounded border bg-slate-50 p-3"><strong className="text-sm">Aperçu du destinataire</strong>{outgoingRecipientLines(item()).map((line) => <div key={line}>{line}</div>)}</div></FormSection>
      <FormSection title="3. Mentions administratives"><Select label="Niveau de priorité" value={outgoing.priority} onChange={(value) => set("priority", value as OutgoingCorrespondenceData["priority"])} options={[["normal", "Normale"], ["important", "Importante"], ["urgent", "Urgente"], ["very_urgent", "Très urgente"]]} /><Select label="Mode d’acheminement" value={outgoing.deliveryMode} onChange={(value) => set("deliveryMode", value)} options={CORRESPONDENCE_DELIVERY_MODES} />{outgoing.deliveryMode === "other" && <Field label="Préciser le mode" value={outgoing.customDeliveryMode ?? ""} onChange={(value) => set("customDeliveryMode", value)} />}</FormSection>
      <FormSection title="4. Objet et références"><Field label="Objet *" value={subject} onChange={setSubject} maxLength={220} /><Field label="Référence antérieure" value={outgoing.previousReference ?? ""} onChange={(value) => set("previousReference", value)} /><DynamicAnnounced value={outgoing.announcedAttachments} onChange={(value) => set("announcedAttachments", value)} /></FormSection>
      <FormSection title="5. Corps du courrier"><Select label="Formule d’appel *" value={salutations.includes(outgoing.salutation) ? outgoing.salutation : "other"} onChange={(value) => set("salutation", value === "other" ? "" : value)} options={[...salutations.map((value) => [value, value] as const), ["other", "Autre"]]} />{!salutations.includes(outgoing.salutation) && <Field label="Saisir la formule d’appel *" value={outgoing.salutation} onChange={(value) => set("salutation", value)} />}<Area label="Introduction ou contexte *" value={outgoing.introduction} onChange={(value) => set("introduction", value)} style={editorStyle} /><Area label="Demande, information ou décision principale *" value={outgoing.mainMessage} onChange={(value) => set("mainMessage", value)} style={editorStyle} /><Area label="Détails et modalités" value={outgoing.details ?? ""} onChange={(value) => set("details", value)} style={editorStyle} /><Area label="Motivation ou justification" value={outgoing.justification ?? ""} onChange={(value) => set("justification", value)} style={editorStyle} /><Area label="Suite attendue" value={outgoing.expectedFollowUp ?? ""} onChange={(value) => set("expectedFollowUp", value)} style={editorStyle} /><Area label="Conclusion *" value={outgoing.conclusion} onChange={(value) => set("conclusion", value)} style={editorStyle} /></FormSection>
      <FormSection title="6. Formule de politesse"><Select label="Formule de politesse *" value={closings.includes(outgoing.closingFormula) ? outgoing.closingFormula : "other"} onChange={(value) => set("closingFormula", value === "other" ? "" : value)} options={[...closings.map((value) => [value, value] as const), ["other", "Autre"]]} />{!closings.includes(outgoing.closingFormula) && <Area label="Formule personnalisée *" value={outgoing.closingFormula} onChange={(value) => set("closingFormula", value)} style={editorStyle} />}</FormSection>
      <FormSection title="7. Signataires"><div className="md:col-span-2"><SignatoriesEditor value={signatories} onChange={(value) => { setDirty(true); setSignatories(value); }} readOnly={Boolean(locked)} showTitle={false} /></div></FormSection>
      <FormSection title="8. Copies pour information"><DynamicCopies value={outgoing.copies} onChange={(value) => set("copies", value)} /></FormSection>
    </fieldset>
    <PdfSettingsFields value={pdfSettings} onChange={(settings) => { setDirty(true); setPdfSettings(settings); }} disabled={Boolean(locked) || busy} />
    <SecretaryDocumentFormActions generateLabel={current ? "Enregistrer" : "Générer courrier"} busyLabel={current ? "Enregistrement en cours…" : "Génération en cours…"} busy={busy} disabled={Boolean(locked)} onCancel={cancel} onGenerate={() => void (current ? act(current.status) : generate())} />
  </form>;
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="grid gap-3 rounded-lg border bg-white p-4"><h3 className="font-semibold text-slate-800">{title}</h3><div className="grid gap-3 md:grid-cols-2">{children}</div></section>; }
function Field({ label, value, onChange, type = "text", maxLength }: { label: string; value: string; onChange: (value: string) => void; type?: string; maxLength?: number }) { return <label className="grid min-w-0 gap-1 text-sm"><span>{label}</span><input className="input w-full" type={type} value={value} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} /></label>; }
function Area({ label, value, onChange, assistant, style }: { label: string; value: string; onChange: (value: string) => void; assistant?: React.ReactNode; style?: React.CSSProperties }) { return <label className="grid min-w-0 gap-1 text-sm md:col-span-2"><span className="flex flex-wrap items-center justify-between gap-2">{label}{assistant}</span><textarea className="input min-h-24 w-full" style={style} value={value} onChange={(event) => onChange(event.target.value)} /></label>; }
function ReadOnly({ label, value }: { label: string; value: string }) { return <label className="grid gap-1 text-sm"><span>{label}</span><input className="input bg-slate-100" value={value} readOnly /></label>; }
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: readonly (readonly [string, string])[] }) { return <label className="grid min-w-0 gap-1 text-sm"><span>{label}</span><select className="input w-full" value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([option, caption]) => <option key={option} value={option}>{caption}</option>)}</select></label>; }
function DynamicAnnounced({ value, onChange }: { value: AnnouncedCorrespondenceAttachment[]; onChange: (value: AnnouncedCorrespondenceAttachment[]) => void }) { return <div className="grid gap-2 md:col-span-2"><div className="flex items-center justify-between"><strong className="text-sm">Pièces jointes annoncées</strong><button type="button" className="secondary-button" onClick={() => onChange([...value, { id: uid(), title: "", copies: 1, includeInPdf: true }])}><Plus className="h-4 w-4" /> Ajouter</button></div>{value.map((entry) => <div className="grid gap-2 rounded border p-2 sm:grid-cols-[1fr_110px_auto_auto]" key={entry.id}><input className="input" placeholder="Intitulé" value={entry.title} onChange={(event) => onChange(value.map((item) => item.id === entry.id ? { ...item, title: event.target.value } : item))} /><input className="input" aria-label="Nombre d’exemplaires" type="number" min="1" value={entry.copies} onChange={(event) => onChange(value.map((item) => item.id === entry.id ? { ...item, copies: Math.max(1, Number(event.target.value)) } : item))} /><label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={entry.includeInPdf} onChange={(event) => onChange(value.map((item) => item.id === entry.id ? { ...item, includeInPdf: event.target.checked } : item))} /> PDF</label><button type="button" aria-label="Retirer" onClick={() => onChange(value.filter((item) => item.id !== entry.id))}><Trash2 className="h-4 w-4" /></button></div>)}</div>; }
function DynamicCopies({ value, onChange }: { value: CorrespondenceCopy[]; onChange: (value: CorrespondenceCopy[]) => void }) { return <div className="grid gap-2 md:col-span-2"><div className="flex items-center justify-between"><strong className="text-sm">Copies</strong><button type="button" className="secondary-button" onClick={() => onChange([...value, { id: uid(), nameOrFunction: "", includeInPdf: true }])}><Plus className="h-4 w-4" /> Ajouter</button></div>{value.map((entry) => <div className="grid gap-2 rounded border p-2 sm:grid-cols-3" key={entry.id}><input className="input" placeholder="Nom ou fonction" value={entry.nameOrFunction} onChange={(event) => onChange(value.map((item) => item.id === entry.id ? { ...item, nameOrFunction: event.target.value } : item))} /><input className="input" placeholder="Institution" value={entry.institution ?? ""} onChange={(event) => onChange(value.map((item) => item.id === entry.id ? { ...item, institution: event.target.value } : item))} /><input className="input" placeholder="Motif" value={entry.reason ?? ""} onChange={(event) => onChange(value.map((item) => item.id === entry.id ? { ...item, reason: event.target.value } : item))} /><label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={entry.includeInPdf} onChange={(event) => onChange(value.map((item) => item.id === entry.id ? { ...item, includeInPdf: event.target.checked } : item))} /> Afficher dans le PDF</label><button type="button" className="secondary-button" onClick={() => onChange(value.filter((item) => item.id !== entry.id))}><Trash2 className="h-4 w-4" /> Retirer</button></div>)}</div>; }
