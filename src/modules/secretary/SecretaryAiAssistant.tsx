import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, Clipboard, RefreshCw, X } from "lucide-react";
import { AdminDrawer } from "../../components/ui";
import { aiErrorMessage, recordSecretaryAiDecision, requestSecretaryAi } from "../../services/secretaryAi";
import type { AppUser } from "../../types";
import type { AiAction, AiLength, AiTone, AiWritingResponse } from "./aiWritingTypes";

export interface AiDocumentSections { [key: string]: string }
export function SecretaryAiAssistant({ user, schoolId, academicYearId, documentId, documentType, sections, initialSection, label = "Assistant de rédaction IA", onAccept }: {
  user: AppUser; schoolId: string; academicYearId?: string; documentId?: string; documentType: string; sections: AiDocumentSections; initialSection?: string; label?: string; onAccept: (section: string, value: string) => void;
}) {
  const [open, setOpen] = useState(false); const [section, setSection] = useState(initialSection ?? Object.keys(sections)[0] ?? "document");
  const [action, setAction] = useState<AiAction>("correct"); const [tone, setTone] = useState<AiTone>("administrative"); const [length, setLength] = useState<AiLength>("similar"); const [instruction, setInstruction] = useState("");
  const [consent, setConsent] = useState(() => localStorage.getItem(`acadea-ai-consent:${user.id}`) === "yes"); const [result, setResult] = useState<AiWritingResponse | null>(null); const [editableProposal, setEditableProposal] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const lock = useRef(false);
  const original = section === "document" ? Object.entries(sections).map(([key, value]) => `${key}:\n${value}`).join("\n\n") : sections[section] ?? "";
  const sectionOptions = useMemo(() => [["document", "Document complet"], ...Object.keys(sections).map((key) => [key, key])], [sections]);
  useEffect(() => { if (!error) return; const timer = window.setTimeout(() => setError(""), 4000); return () => window.clearTimeout(timer); }, [error]);
  async function run() {
    if (lock.current) return; if (!consent) { setError("Confirmez que la proposition sera vérifiée avant utilisation."); return; }
    lock.current = true; setBusy(true); setError("");
    try { localStorage.setItem(`acadea-ai-consent:${user.id}`, "yes"); const response = await requestSecretaryAi(user, { schoolId, academicYearId, documentId, documentType, section, action, originalText: original, context: sections, tone, length, additionalInstruction: instruction, consentConfirmed: true }); setResult(response); setEditableProposal(response.proposedText || (response.sections ? Object.entries(response.sections).map(([key, value]) => `${key}:\n${value}`).join("\n\n") : "")); }
    catch (cause) { setError(aiErrorMessage(cause)); } finally { lock.current = false; setBusy(false); }
  }
  function accept() {
    if (!result) return;
    if (section === "document" && result.sections) Object.entries(result.sections).forEach(([key, value]) => { if (key in sections) onAccept(key, value); });
    else onAccept(section, editableProposal);
    void recordSecretaryAiDecision(user, schoolId, result.metadata.requestId, true).catch((cause) => console.warn("Décision IA non journalisée", cause)); setOpen(false); setResult(null);
  }
  return <><button type="button" className="secondary-button" onClick={() => { setSection(initialSection ?? Object.keys(sections)[0] ?? "document"); setOpen(true); }}><Bot className="h-4 w-4" /> {label}</button>{open && <AdminDrawer title="Assistant IA" onClose={() => !busy && setOpen(false)} closeLabel="Fermer"><div className="grid gap-4">
    <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm"><strong>À vérifier avant validation.</strong><p>L’assistant IA génère des propositions qui doivent être vérifiées. Aucun document n’est finalisé, signé ou envoyé automatiquement.</p><label className="mt-2 flex gap-2"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> J’ai compris que le contenu proposé doit être vérifié avant utilisation.</label></div>
    <label className="grid gap-1 text-sm">Portée<select className="input" value={section} onChange={(event) => { setSection(event.target.value); setResult(null); }}>{sectionOptions.map(([value, caption]) => <option key={value} value={value}>{caption}</option>)}</select></label>
    <label className="grid gap-1 text-sm">Action<select className="input" value={action} onChange={(event) => setAction(event.target.value as AiAction)}><option value="generate_draft">Rédiger une réponse</option><option value="correct">Améliorer un texte</option><option value="reformulate">Reformuler</option><option value="formalize">Reformuler en style administratif</option><option value="verify_document">Vérifier la cohérence du document</option></select></label>
    <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm">Ton<select className="input" value={tone} onChange={(event) => setTone(event.target.value as AiTone)}><option value="administrative">Administratif</option><option value="professional">Professionnel</option><option value="formal">Formel</option><option value="courteous">Courtois</option><option value="diplomatic">Diplomatique</option><option value="firm">Ferme</option><option value="neutral">Neutre</option></select></label><label className="grid gap-1 text-sm">Longueur<select className="input" value={length} onChange={(event) => setLength(event.target.value as AiLength)}><option value="short">Plus courte</option><option value="similar">Longueur similaire</option><option value="detailed">Plus développée</option></select></label></div>
    <label className="grid gap-1 text-sm">Instruction complémentaire<textarea className="input min-h-20" value={instruction} onChange={(event) => setInstruction(event.target.value)} /></label>
    {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {!result && <button type="button" className="primary-button justify-center" disabled={busy} onClick={() => void run()}>{busy ? "Préparation de la proposition…" : "Générer la proposition"}</button>}
    {result && <><p className="font-semibold">Contenu proposé par l’IA — à vérifier avant validation</p><div className="grid gap-3 lg:grid-cols-2"><label className="grid gap-1 text-sm">Texte original<textarea className="input min-h-64 bg-slate-50" value={original} readOnly /></label><label className="grid gap-1 text-sm">Proposition de l’IA<textarea className="input min-h-64" value={editableProposal} onChange={(event) => setEditableProposal(event.target.value)} /></label></div>{result.warnings.map((warning) => <p key={`${warning.code}-${warning.field}`} className="rounded border border-amber-200 bg-amber-50 p-2 text-sm"><strong>{warning.title}</strong> — {warning.message}</p>)}{result.missingInformation.map((missing) => <p key={missing.field} className="text-sm text-amber-700">[{missing.field}] {missing.message}</p>)}<div className="flex flex-wrap gap-2"><button type="button" className="primary-button" onClick={accept}><Check className="h-4 w-4" /> Accepter tout</button><button type="button" className="secondary-button" onClick={() => { setResult(null); setEditableProposal(""); }}><X className="h-4 w-4" /> Refuser</button><button type="button" className="secondary-button" onClick={() => void navigator.clipboard.writeText(editableProposal)}><Clipboard className="h-4 w-4" /> Copier</button><button type="button" className="secondary-button" disabled={busy} onClick={() => void run()}><RefreshCw className="h-4 w-4" /> Régénérer</button>{section !== "document" && <button type="button" className="secondary-button" onClick={() => onAccept(section, `${original}\n${editableProposal}`.trim())}>Insérer à la suite</button>}</div></>}
  </div></AdminDrawer>}</>;
}
