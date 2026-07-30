import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, Clipboard, RefreshCw, X } from "lucide-react";
import { AdminDrawer } from "../../components/ui";
import { aiErrorMessage, recordSecretaryAiDecision, requestSecretaryAi } from "../../services/secretaryAi";
import { loadSchoolAiAssistantSetting, schoolAiUsageThisMonth } from "../../services/schoolAiAssistant";
import type { AppUser, School } from "../../types";
import type { AiAction, AiLength, AiScope, AiTone, AiWritingResponse } from "./aiWritingTypes";
import { buildAiDocumentActions } from "./aiDocumentActions";
import { withAiGenerationLock } from "./aiGenerationLock";
import { editedReportSectionsToApply, getTargetSections, resolveGeneratedScope } from "./reportAiSections";

export interface AiDocumentSections { [key: string]: string }
export function SecretaryAiAssistant({ user, schoolId, academicYearId, documentId, documentType, documentCategory, documentTypeLabel, documentDate, documentTime, documentEndTime, schoolName, academicYearName, sections, sectionLabels = {}, initialSection, label = "Générer avec l’Assistant IA", aiAssistant, onAccept, onApplySections }: {
  user: AppUser; schoolId: string; academicYearId?: string; documentId?: string; documentType: string; documentCategory: "courrier" | "rapport"; documentTypeLabel: string; documentDate?: string; documentTime?: string; documentEndTime?: string; schoolName?: string; academicYearName?: string; sections: AiDocumentSections; sectionLabels?: Record<string, string>; initialSection?: string; label?: string; aiAssistant: School["aiAssistant"]; onAccept: (section: string, value: string) => void; onApplySections?: (sections: Record<string, string>) => void;
}) {
  const [open, setOpen] = useState(false); const [scope, setScope] = useState<AiScope>("full_document"); const [section, setSection] = useState(initialSection ?? (documentCategory === "rapport" ? Object.keys(sections)[0] ?? "" : ""));
  const [action, setAction] = useState<AiAction>("reformulate"); const [tone, setTone] = useState<AiTone>("administrative"); const [length, setLength] = useState<AiLength>("standard"); const [instruction, setInstruction] = useState("");
  const [generatedParameters, setGeneratedParameters] = useState<{ scope: AiScope; action: AiAction; tone: AiTone; length: AiLength } | null>(null);
  const [consent, setConsent] = useState(() => localStorage.getItem(`acadea-ai-consent:${user.id}`) === "yes"); const [result, setResult] = useState<AiWritingResponse | null>(null); const [editableProposal, setEditableProposal] = useState(""); const [editableSections, setEditableSections] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const lock = useRef(false);
  const [currentAiAssistant, setCurrentAiAssistant] = useState(aiAssistant);
  const [usageLoading, setUsageLoading] = useState(true);
  const configuredUsage = schoolAiUsageThisMonth(currentAiAssistant);
  const [monthlyUsage, setMonthlyUsage] = useState(configuredUsage.monthlyUsage);
  const monthlyLimit = configuredUsage.monthlyLimit;
  const remaining = Math.max(0, monthlyLimit - monthlyUsage);
  const limitReached = monthlyUsage >= monthlyLimit;
  const effectiveScope: AiScope = documentCategory === "rapport" ? scope : "full_document";
  const original = effectiveScope === "full_document" ? (documentCategory === "rapport" ? "" : Object.entries(sections).map(([key, value]) => `${key}:\n${value}`).join("\n\n")) : sections[effectiveScope] ?? "";
  const sectionOptions = useMemo(() => Object.keys(sections).map((key) => [key, sectionLabels[key] ?? key]), [sectionLabels, sections]);
  const actionOptions = useMemo(() => buildAiDocumentActions(documentTypeLabel), [documentTypeLabel]);
  const displayedScope = resolveGeneratedScope(generatedParameters?.scope, result?.scope, effectiveScope) as AiScope;
  function invalidateResult() { setResult(null); setEditableProposal(""); setEditableSections({}); setGeneratedParameters(null); }
  useEffect(() => { if (import.meta.env.VITE_APP_ENV !== "production") console.info("Secretary AI frontend version", __ACADEA_BUILD_ID__); }, []);
  useEffect(() => { if (!error) return; const timer = window.setTimeout(() => setError(""), 4000); return () => window.clearTimeout(timer); }, [error]);
  useEffect(() => { setMonthlyUsage(configuredUsage.monthlyUsage); }, [configuredUsage.monthlyUsage, configuredUsage.usageMonth, schoolId]);
  useEffect(() => {
    let active = true;
    setUsageLoading(true);
    loadSchoolAiAssistantSetting(schoolId)
      .then((setting) => { if (active) setCurrentAiAssistant(setting ?? aiAssistant); })
      .catch(() => { if (active) setCurrentAiAssistant(aiAssistant); })
      .finally(() => { if (active) setUsageLoading(false); });
    return () => { active = false; };
  }, [aiAssistant, schoolId]);
  async function run() {
    if (limitReached) return; if (!consent) { setError("Confirmez que la proposition sera vérifiée avant utilisation."); return; } if (!instruction.trim()) { setError("L’instruction complémentaire est obligatoire."); return; }
    await withAiGenerationLock(lock, setBusy, async () => {
      setError("");
      try {
      localStorage.setItem(`acadea-ai-consent:${user.id}`, "yes");
      const documentContext = Object.fromEntries(Object.entries({ date: documentDate, time: documentTime, endTime: documentEndTime, schoolName, academicYearName }).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0));
      const sectionsSent = getTargetSections(effectiveScope, sections);
      const requestStartedAt = Date.now();
      if (import.meta.env.VITE_APP_ENV !== "production") console.info("Secretary AI report request", { event: "secretary_ai_request_started", action, scope: effectiveScope, tone, length, hasAdditionalInstruction: instruction.trim().length > 0, targetSectionKey: effectiveScope === "full_document" ? null : effectiveScope, sourceLength: Object.values(sectionsSent).join("").length, requestStartedAt: new Date(requestStartedAt).toISOString(), isGeneratingBeforeRequest: false, sectionKeysSent: Object.keys(sectionsSent) });
      const response = await requestSecretaryAi(user, {
        schoolId, academicYearId, ...(documentId ? { documentId } : {}), documentType, documentCategory, documentTypeLabel,
        ...(documentDate ? { documentDate } : {}), ...(documentTime ? { documentTime } : {}), scope: effectiveScope, sections: sectionsSent, documentContext,
        ...(effectiveScope !== "full_document" ? { targetSection: { key: effectiveScope, value: sectionsSent[effectiveScope] ?? "" } } : {}), action, originalText: original, context: sectionsSent, tone, length, additionalInstruction: instruction, consentConfirmed: true,
      });
      const normalizedSections = Object.fromEntries(Object.entries(response.sections ?? {}).filter((entry): entry is [string, string] => entry[0] in sections && typeof entry[1] === "string" && entry[1].trim().length > 0));
      if (Object.keys(normalizedSections).length === 0 && !response.proposedText?.trim()) throw new Error("INVALID_AI_RESPONSE: La réponse de l’Assistant IA ne contient pas de proposition exploitable.");
      if (import.meta.env.VITE_APP_ENV !== "production") console.info("Secretary AI report response", { event: "secretary_ai_response_received", requestDurationMs: Date.now() - requestStartedAt, generatedLength: Object.values(normalizedSections).join("").length || response.proposedText?.length || 0, sectionKeysReceived: Object.keys(response.sections ?? {}), generatedSectionKeys: Object.keys(normalizedSections) });
      setMonthlyUsage((value) => Math.min(value + 1, monthlyLimit)); setResult(response); setGeneratedParameters({ scope: response.scope, action, tone, length }); setEditableSections(normalizedSections); setEditableProposal(response.proposedText || (response.sections ? Object.entries(response.sections).map(([key, value]) => `${key}:\n${value}`).join("\n\n") : ""));
      } catch (cause) { setError(aiErrorMessage(cause)); }
      finally { if (import.meta.env.VITE_APP_ENV !== "production") console.info("Secretary AI request finished", { event: "secretary_ai_request_finished", isGeneratingReset: true }); }
    });
  }
  function accept() {
    if (!result) return;
    if (documentCategory === "rapport" && result.sections) {
      const valuesToApply = editedReportSectionsToApply(generatedParameters?.scope ?? result.scope, sections, editableSections);
      if (Object.keys(valuesToApply).some((key) => sections[key]?.trim()) && !window.confirm("Le contenu généré par l’Assistant IA remplacera les sections correspondantes du rapport. Voulez-vous continuer ?")) return;
      if (import.meta.env.VITE_APP_ENV !== "production") console.info("Secretary AI report apply", { generatedSectionKeys: Object.keys(editableSections), keysApplied: Object.keys(valuesToApply) });
      if (onApplySections) onApplySections(valuesToApply); else Object.entries(valuesToApply).forEach(([key, value]) => onAccept(key, value));
    } else if (effectiveScope === "full_document" && result.sections) {
      const parsedSections = parseEditableSections(editableProposal, Object.keys(sections));
      Object.entries(result.sections).forEach(([key, value]) => { if (key in sections) onAccept(key, parsedSections[key] ?? value); });
    }
    else onAccept(section, editableProposal);
    if (!limitReached) void recordSecretaryAiDecision(user, schoolId, result.metadata.requestId, true).catch((cause) => console.warn("Décision IA non journalisée", cause)); setOpen(false); setResult(null);
  }
  if (currentAiAssistant?.enabled !== true) return <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">L’Assistant IA n’est pas activé pour votre établissement. Veuillez contacter votre administrateur.</p>;
  return <div className="grid justify-items-end gap-2"><aside className="w-full max-w-xl rounded border border-violet-200 bg-violet-50 p-4 text-sm text-slate-700"><p className="font-bold text-ink">Assistant IA</p><p className="mt-2 font-semibold">Quota mensuel</p><p>{monthlyUsage} / {monthlyLimit} utilisations</p>{limitReached ? <p role="alert" className="mt-3 font-semibold text-amber-800">Le quota mensuel de votre établissement est atteint.<br />Veuillez contacter votre administrateur ou réessayer le mois prochain.</p> : <p className="mt-2">Il vous reste : <strong>{remaining} utilisations ce mois.</strong></p>}<p className="mt-2 text-xs text-slate-500">Le quota est réinitialisé automatiquement au début de chaque mois.</p></aside><button type="button" className="secondary-button" disabled={usageLoading || limitReached} onClick={() => { setScope("full_document"); setSection(initialSection ?? (documentCategory === "rapport" ? Object.keys(sections)[0] ?? "" : "")); setOpen(true); }}><Bot className="h-4 w-4" /> {label}</button>{open && <AdminDrawer title="Assistant IA" onClose={() => !busy && setOpen(false)} closeLabel="Fermer"><div className="grid gap-4">
    <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm"><strong>À vérifier avant validation.</strong><p>L’assistant IA génère des propositions qui doivent être vérifiées. Aucun document n’est finalisé, signé ou envoyé automatiquement.</p><label className="mt-2 flex gap-2"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> J’ai compris que le contenu proposé doit être vérifié avant utilisation.</label></div>
    {documentCategory === "rapport" ? <label className="grid gap-1 text-sm">Portée<select className="input" value={scope} onChange={(event) => { setScope(event.target.value as AiScope); invalidateResult(); }}><option value="full_document">Document complet</option>{sectionOptions.map(([value, caption]) => <option key={value} value={value}>{caption}</option>)}</select></label> : <label className="grid gap-1 text-sm">Portée<select className="input" value={section} onChange={(event) => { setSection(event.target.value); invalidateResult(); }}><option value="">Document complet</option>{sectionOptions.map(([value, caption]) => <option key={value} value={value}>{caption}</option>)}</select></label>}
    <label className="grid gap-1 text-sm">Action<select className="input" value={action} onChange={(event) => { setAction(event.target.value as AiAction); invalidateResult(); }}>{actionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
    <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm">Ton<select className="input" value={tone} onChange={(event) => { setTone(event.target.value as AiTone); invalidateResult(); }}><option value="administrative">Administratif</option><option value="professional">Professionnel</option><option value="neutral">Neutre</option><option value="formal">Formel</option></select></label><label className="grid gap-1 text-sm">Longueur<select className="input" value={length} onChange={(event) => { setLength(event.target.value as AiLength); invalidateResult(); }}><option value="short">Courte</option><option value="standard">Standard</option><option value="developed">Plus développée</option></select></label></div>
    <label className="grid gap-1 text-sm">Instruction complémentaire<textarea className="input min-h-20" required value={instruction} onChange={(event) => { setInstruction(event.target.value); invalidateResult(); }} /></label>
    {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {!result && <button type="button" className="primary-button justify-center" disabled={busy || limitReached} onClick={() => void run()}>{busy ? "Rédaction en cours…" : "Générer la proposition"}</button>}
    {result && <><p className="font-semibold">Contenu proposé par l’IA — à vérifier avant validation</p>{documentCategory === "rapport" && result.sections ? <div className="grid gap-4">{(displayedScope === "full_document" ? Object.keys(editableSections) : [displayedScope]).map((key) => <section className="grid gap-2 rounded border p-3" key={key}><h4 className="font-semibold">{sectionLabels[key] ?? key}</h4><div className="grid gap-3 lg:grid-cols-2"><label className="grid gap-1 text-sm">Valeur originale<textarea className="input min-h-28 bg-slate-50" value={sections[key] ?? ""} readOnly /></label><label className="grid gap-1 text-sm">Proposition modifiable<textarea className="input min-h-28" value={editableSections[key] ?? ""} onChange={(event) => setEditableSections((previous) => ({ ...previous, [key]: event.target.value }))} /></label></div></section>)}</div> : <div className="grid gap-3 lg:grid-cols-2"><label className="grid gap-1 text-sm">Texte original<textarea className="input min-h-64 bg-slate-50" value={original} readOnly /></label><label className="grid gap-1 text-sm">Proposition de l’IA<textarea className="input min-h-64" value={editableProposal} onChange={(event) => setEditableProposal(event.target.value)} /></label></div>}{result.warnings.map((warning) => <p key={`${warning.code}-${warning.field}`} className="rounded border border-amber-200 bg-amber-50 p-2 text-sm"><strong>{warning.title}</strong> — {warning.message}</p>)}{result.missingInformation.map((missing) => <p key={missing.field} className="text-sm text-amber-700">[{missing.field}] {missing.message}</p>)}<div className="flex flex-wrap gap-2"><button type="button" className="primary-button" onClick={accept}><Check className="h-4 w-4" /> Appliquer au formulaire</button><button type="button" className="secondary-button" onClick={() => { setResult(null); setEditableProposal(""); setEditableSections({}); }}><X className="h-4 w-4" /> Refuser</button><button type="button" className="secondary-button" onClick={() => void navigator.clipboard.writeText(documentCategory === "rapport" ? Object.entries(editableSections).map(([key, value]) => `${key}:\n${value}`).join("\n\n") : editableProposal)}><Clipboard className="h-4 w-4" /> Copier</button><button type="button" className="secondary-button" disabled={busy || limitReached} onClick={() => { if ((!editableProposal && Object.keys(editableSections).length === 0) || window.confirm("Une nouvelle génération remplacera le contenu actuellement affiché. Voulez-vous continuer ?")) void run(); }}><RefreshCw className="h-4 w-4" /> Régénérer</button></div></>}
  </div></AdminDrawer>}</div>;
}

function parseEditableSections(value: string, sectionNames: string[]) {
  const result: Record<string, string> = {};
  sectionNames.forEach((name, index) => {
    const start = value.indexOf(`${name}:`);
    if (start < 0) return;
    const contentStart = start + name.length + 1;
    const nextStarts = sectionNames.slice(index + 1).map((next) => value.indexOf(`${next}:`, contentStart)).filter((position) => position >= 0);
    const end = nextStarts.length ? Math.min(...nextStarts) : value.length;
    result[name] = value.slice(contentStart, end).trim();
  });
  return result;
}
