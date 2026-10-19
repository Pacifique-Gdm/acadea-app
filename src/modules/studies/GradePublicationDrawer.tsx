import { useEffect, useState } from "react";
import { AdminDrawer } from "../../components/ui/AdminDrawer";
import type { School, SchoolYear } from "../../types";
import { formatMoneyInput, parseMoneyInput } from "../../utils/currency";
import { userFacingError } from "../../utils/userFacingError";
import { ConsolidatedGradesView } from "../teacher/ConsolidatedGradesView";
import { editableGradingSlots, gradingSlotLabels, type EditableGradingSlot } from "../teacher/teacherGrading";
import { loadDirectorConsolidatedReport, loadGradePublicationOptions, publishGrades, withdrawGradePublication, type PublicationComparison } from "../teacher/gradePublicationService";
import type { ConsolidatedClassReport } from "../teacher/consolidatedGrades";
import type { StudyClass } from "./studyTypes";

type Options = Awaited<ReturnType<typeof loadGradePublicationOptions>>;
type Screen = "classes" | "report" | "options";
type Published = { publicationId: string; publishedCount: number; notificationCount: number };
const choiceValue = (id: string, operator: PublicationComparison) => JSON.stringify([id, operator]);

export function GradePublicationDrawer({ school, year, classes, onClose }: { school: School; year: SchoolYear; classes: StudyClass[]; onClose: () => void }) {
  const [screen, setScreen] = useState<Screen>("classes");
  const [classId, setClassId] = useState("");
  const [options, setOptions] = useState<Options>();
  const [optionsAttempt, setOptionsAttempt] = useState(0);
  const [report, setReport] = useState<ConsolidatedClassReport>();
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");
  const [published, setPublished] = useState<Published>();
  const [withdrawText, setWithdrawText] = useState("");
  const [slot, setSlot] = useState<EditableGradingSlot>("period_1");
  const [percentageOperator, setPercentageOperator] = useState<"" | PublicationComparison>("");
  const [percentageValue, setPercentageValue] = useState("");
  const [feeChoice, setFeeChoice] = useState("");
  const [amount, setAmount] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const selectedClass = classes.find((item) => item.id === classId);

  useEffect(() => {
    if (screen !== "options" || !classId) return;
    let active = true;
    setOptions(undefined);
    loadGradePublicationOptions(school.id, year.id, classId).then((value) => { if (active) setOptions(value); })
      .catch((cause: unknown) => { if (active) setError(userFacingError(cause, "Types de frais indisponibles.")); });
    return () => { active = false; };
  }, [school.id, year.id, classId, screen, optionsAttempt]);

  function changeCriteria() { setPublished(undefined); setRequestId(crypto.randomUUID()); setError(""); }
  async function showReport(nextClassId: string) {
    setClassId(nextClassId); setScreen("report"); setReport(undefined); setError(""); setLoading(true);
    try { setReport((await loadDirectorConsolidatedReport(school.id, year.id, nextClassId)).report); }
    catch (cause) { setError(userFacingError(cause, "Fiche consolidée indisponible.")); }
    finally { setLoading(false); }
  }
  function openOptions(nextClassId: string) {
    setClassId(nextClassId); setScreen("options"); setOptions(undefined); setError(""); setPublished(undefined); setRequestId(crypto.randomUUID());
    setSlot("period_1"); setPercentageOperator(""); setPercentageValue(""); setFeeChoice(""); setAmount("");
  }
  async function submit() {
    if (publishing || !selectedClass || !options || year.status !== "active") return;
    let percentage: { operator: PublicationComparison; value: number } | undefined;
    let fee: { feeTypeId: string; operator: PublicationComparison; amountMinor: number } | undefined;
    if (percentageOperator) {
      if (!percentageValue.trim() || !Number.isFinite(Number(percentageValue)) || Number(percentageValue) < 0 || Number(percentageValue) > 100) {
        setError("Saisissez un pourcentage compris entre 0 et 100."); return;
      }
      percentage = { operator: percentageOperator, value: Number(percentageValue) };
    }
    if (feeChoice) {
      const [feeTypeId, operator] = JSON.parse(feeChoice) as [string, PublicationComparison];
      if (!options.feeTypes.some((item) => item.id === feeTypeId)) { setError("Ce type de frais n'est plus applicable à la classe sélectionnée."); return; }
      const normalized = parseMoneyInput(amount);
      if (!normalized || !/^\d+(?:\.\d{1,2})?$/.test(normalized)) { setError("Saisissez un montant valide, avec deux décimales au maximum."); return; }
      const amountMinor = Math.round(Number(normalized) * 100);
      if (!Number.isSafeInteger(amountMinor)) { setError("Montant trop élevé."); return; }
      fee = { feeTypeId, operator, amountMinor };
    }
    setPublishing(true); setError("");
    try {
      const result = await publishGrades({ schoolId: school.id, schoolYearId: year.id, classId, slot, requestId, ...(percentage ? { percentage } : {}), ...(fee ? { fee } : {}) });
      setPublished(result);
    } catch (cause) { setError(userFacingError(cause, "Publication impossible. Réessayez sans modifier les critères.")); }
    finally { setPublishing(false); }
  }
  async function withdraw() {
    if (!published || withdrawText !== "RETIRER CETTE PUBLICATION" || publishing) return;
    setPublishing(true); setError("");
    try {
      await withdrawGradePublication(school.id, year.id, published.publicationId);
      setPublished(undefined); setWithdrawText(""); setRequestId(crypto.randomUUID());
    } catch (cause) { setError(userFacingError(cause, "Retrait impossible.")); }
    finally { setPublishing(false); }
  }

  return <AdminDrawer title={screen === "classes" ? "Publication des cotes" : screen === "report" ? "Fiche consolidée" : "Option de publication"} closeLabel="Fermer la publication des cotes" onClose={onClose}>
    {screen !== "classes" && <button type="button" className="secondary-button mb-4 w-full justify-center" onClick={() => { setScreen("classes"); setError(""); }}>Retour aux classes</button>}
    {error && <p role="alert" className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {error && !options && <button type="button" className="secondary-button mb-3 w-full justify-center" onClick={() => { setError(""); setOptionsAttempt((attempt) => attempt + 1); }}>Réessayer le chargement</button>}
    {error && screen === "report" && !loading && !report && <button type="button" className="secondary-button mb-3 w-full justify-center" onClick={() => void showReport(classId)}>Réessayer la fiche</button>}
    {screen === "classes" && <div className="grid gap-3">
      {classes.filter((item) => item.active !== false).map((item) => <article key={item.id} className="grid gap-3 rounded border bg-white p-4">
        <div><h3 className="font-bold">{item.name}</h3>{item.option && <p className="text-sm text-slate-600">Option : {item.option}</p>}<p className="text-xs text-slate-500">Fiche consolidée · {year.name}</p></div>
        <div className="grid grid-cols-2 gap-2"><button type="button" className="secondary-button min-w-0 justify-center text-center" onClick={() => void showReport(item.id)}>Voir la fiche consolidée</button><button type="button" className="primary-button min-w-0 justify-center text-center" onClick={() => openOptions(item.id)}>Option de publication</button></div>
      </article>)}
      {classes.length === 0 && <p>Aucune classe opérationnelle disponible.</p>}
    </div>}
    {screen === "report" && (loading ? <p role="status">Chargement…</p> : report ? <ConsolidatedGradesView report={report} /> : !error ? <p>Aucune fiche disponible.</p> : null)}
    {screen === "options" && <div className="grid gap-4">
      <p className="font-bold">{selectedClass?.name ?? "Classe"} · {year.name}</p>
      <label className="grid gap-1 text-sm font-semibold">Période<select className="input" value={slot} onChange={(event) => { setSlot(event.target.value as EditableGradingSlot); changeCriteria(); }}>{editableGradingSlots.map((item) => <option key={item} value={item}>{gradingSlotLabels[item]}</option>)}</select></label>
      <fieldset className="grid gap-1"><legend className="text-sm font-semibold">Pourcentage</legend><div className="grid grid-cols-2 gap-2"><select className="input min-w-0" aria-label="Comparaison du pourcentage" value={percentageOperator} onChange={(event) => { setPercentageOperator(event.target.value as "" | PublicationComparison); changeCriteria(); }}><option value="">Aucun critère</option><option value="gte">Pourcentage ≥</option><option value="lt">Pourcentage &lt;</option></select><input className="input min-w-0" type="number" min="0" max="100" step="any" aria-label="Valeur du pourcentage" value={percentageValue} disabled={!percentageOperator} onChange={(event) => { setPercentageValue(event.target.value); changeCriteria(); }} /></div></fieldset>
      <fieldset className="grid gap-1"><legend className="text-sm font-semibold">Type de frais</legend><div className="grid grid-cols-2 gap-2"><select className="input min-w-0" aria-label="Type de frais et comparaison" value={feeChoice} onChange={(event) => { setFeeChoice(event.target.value); changeCriteria(); }}><option value="">Aucun critère</option>{options?.feeTypes.flatMap((item) => ([<option key={`${item.id}-gte`} value={choiceValue(item.id, "gte")}>{item.name} ≥</option>, <option key={`${item.id}-lt`} value={choiceValue(item.id, "lt")}>{item.name} &lt;</option>]))}</select><div className="relative min-w-0"><input className="input w-full pr-14" inputMode="decimal" aria-label="Montant payé" value={amount} disabled={!feeChoice} onChange={(event) => { setAmount(formatMoneyInput(event.target.value)); changeCriteria(); }} /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">{options?.currency === "CDF" ? "CDF" : "USD"}</span></div></div></fieldset>
      {options && options.feeTypes.length === 0 && <p role="status" className="text-sm text-slate-600">Aucun type de frais applicable à cette classe n'est configuré.</p>}
      {published && <section role="status" className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800"><p>Publication confirmée : {published.publishedCount} élève(s), {published.notificationCount} notification(s).</p><label className="mt-3 grid gap-1">Pour retirer cette publication, saisissez RETIRER CETTE PUBLICATION<input className="input" value={withdrawText} onChange={(event) => setWithdrawText(event.target.value)} /></label><button className="secondary-button mt-2 w-full justify-center" type="button" disabled={publishing || withdrawText !== "RETIRER CETTE PUBLICATION"} onClick={() => void withdraw()}>Retirer cette publication</button></section>}
      <button type="button" className="primary-button w-full justify-center" disabled={publishing || !options || year.status !== "active"} onClick={() => void submit()}>{publishing ? "Chargement…" : "Publier"}</button>
      {year.status !== "active" && <p className="text-sm text-amber-800">Année archivée : consultation uniquement.</p>}
    </div>}
  </AdminDrawer>;
}
