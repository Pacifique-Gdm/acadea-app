import { useEffect, useMemo, useState } from "react";
import type { OfflineAccess } from "../../services/offlineAccess";
import { loadOfflineContext, type OfflineContext } from "../../services/offlineContext";
import { captureOfflineDraft } from "../../services/offlineDrafts";
import type { OfflineScope } from "../../services/offlineQueue";
import { attendanceRecordId } from "../../utils/attendance";

const slots = ["period_1", "period_2", "semester_1_exam", "period_3", "period_4", "semester_2_exam"];
const slotLabel: Record<string, string> = { period_1: "1re période", period_2: "2e période", semester_1_exam: "Examen du 1er semestre",
  period_3: "3e période", period_4: "4e période", semester_2_exam: "Examen du 2e semestre" };

export function OfflineDraftForms({ scope, role }: { scope: OfflineScope; role: OfflineAccess["role"] }) {
  const [context, setContext] = useState<OfflineContext | null>(null);
  const [courseId, setCourseId] = useState("");
  const [slot, setSlot] = useState("period_1");
  const [studentId, setStudentId] = useState("");
  const [status, setStatus] = useState<"graded" | "not_graded" | "absent">("graded");
  const [score, setScore] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [attendanceDate, setAttendanceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [attendanceStatus, setAttendanceStatus] = useState<"present" | "absent" | "late">("present");
  const [reason, setReason] = useState("");
  const [classId, setClassId] = useState("");
  const [nom, setNom] = useState("");
  const [postnom, setPostnom] = useState("");
  const [prenom, setPrenom] = useState("");
  const [sexe, setSexe] = useState<"M" | "F">("M");
  const [birthDate, setBirthDate] = useState("");
  const [feeTypeId, setFeeTypeId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = () => { void loadOfflineContext(scope).then((value) => { if (active) setContext(value?.role === role ? value : null); }); };
    refresh();
    window.addEventListener("acadea:offline-context-ready", refresh);
    return () => { active = false; window.removeEventListener("acadea:offline-context-ready", refresh); };
  }, [scope, role]);
  const course = useMemo(() => context?.courses.find((item) => item.assignmentId === courseId), [context, courseId]);
  const config = course?.configs.find((item) => item.slot === slot) ?? course?.configs.find((item) => item.slot === "legacy");
  const existingGrade = course?.entries.find((item) => item.studentId === studentId && item.slot === slot);
  const selectedClass = context?.classes.find((item) => item.id === classId);
  const parentClass = selectedClass?.parentClassId
    ? context?.classes.find((item) => item.id === selectedClass.parentClassId) : selectedClass;
  const fee = context?.fees.find((item) => item.id === feeTypeId);
  const students = role === "teacher" ? course?.students ?? [] : context?.students ?? [];

  async function save() {
    if (!context || saving) return;
    setSaving(true); setMessage("");
    try {
      if (role === "teacher") {
        if (!course || !config || !studentId || (existingGrade && confirmation !== "MODIFIER LA CÔTE")) {
          throw new Error(existingGrade ? "Saisissez exactement MODIFIER LA CÔTE." : "Cours, élève ou maximum préchargé indisponible.");
        }
        await captureOfflineDraft(scope.userId, "grade", { assignmentId: course.assignmentId, classId: course.classId,
          subjectId: course.subjectId, studentId, gradingSlot: slot, status,
          score: status === "graded" ? score.trim() ? Number(score) : Number.NaN : null, maximumAtCapture: config.maxScore,
          expectedMaximumVersion: config.version, expectedGradeVersion: existingGrade?.version ?? null });
      } else if (role === "discipline_director") {
        if (!studentId || context.existingAttendanceIds.includes(attendanceRecordId(scope.schoolId, scope.schoolYearId, studentId, attendanceDate))) {
          throw new Error("Une présence existe déjà au dernier chargement. Vérifiez-la en ligne.");
        }
        await captureOfflineDraft(scope.userId, "attendance", { studentId, attendanceDate,
          status: attendanceStatus, manualReason: reason, expectedAttendanceVersion: null });
      } else if (role === "school_admin" || role === "secretary") {
        if (!selectedClass || !parentClass) throw new Error("Classe préchargée indisponible.");
        await captureOfflineDraft(scope.userId, "student_enrollment", { nom, postnom, prenom, sexe, birthDate,
          classId: parentClass.id, className: parentClass.name,
          ...(selectedClass.parentClassId ? { subClassId: selectedClass.id } : {}),
          ...(selectedClass.classOptionKey ? { classOptionKey: selectedClass.classOptionKey } : {}),
          ...(selectedClass.option ? { option: selectedClass.option } : {}),
          ...(selectedClass.section ? { section: selectedClass.section } : {}) });
      } else if (role === "cashier") {
        if (!studentId || !fee) throw new Error("Élève ou frais préchargé indisponible.");
        await captureOfflineDraft(scope.userId, "payment_proposal", { studentId, feeTypeId: fee.id,
          amount: Number(amount.replace(",", ".")), currency: fee.currency, expectedFeeAmount: fee.amount, note });
      }
      setMessage("Brouillon local enregistré. Aucune opération n'est encore confirmée par le serveur.");
      setConfirmation(""); setScore(""); setReason(""); setAmount(""); setNote("");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Brouillon local impossible."); }
    finally { setSaving(false); }
  }

  if (!context) return <p className="mt-3 text-sm text-amber-800">Références locales non préchargées sur cet appareil. Reconnectez-vous pour les télécharger.</p>;
  return <section className="mt-4 grid gap-2 border-t border-slate-200 pt-3 text-sm" aria-label="Préparer une opération hors connexion">
    <h3 className="font-semibold">Préparer un brouillon local</h3>
    <p className="text-xs text-amber-800">Données préchargées le {new Date(context.savedAt).toLocaleString("fr-FR")}. Le serveur revérifiera tout à la reconnexion.</p>
    {role === "teacher" && <>
      <select className="input" aria-label="Cours préchargé" value={courseId} onChange={(event) => { setCourseId(event.target.value); setStudentId(""); }}><option value="">Choisir un cours</option>{context.courses.map((item) => <option key={item.assignmentId} value={item.assignmentId}>{item.className} · {item.subjectName}</option>)}</select>
      <select className="input" aria-label="Période" value={slot} onChange={(event) => setSlot(event.target.value)}>{slots.map((item) => <option key={item} value={item}>{slotLabel[item]}</option>)}</select>
      <select className="input" aria-label="Élève" value={studentId} onChange={(event) => setStudentId(event.target.value)}><option value="">Choisir un élève</option>{students.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <p>Maximum préchargé : {config?.maxScore ?? "indisponible"}</p>
      <select className="input" aria-label="Statut de la cote" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="graded">Coté</option><option value="not_graded">Non coté</option><option value="absent">Absent</option></select>
      {status === "graded" && <input className="input" aria-label="Cote locale" type="number" min="0" max={config?.maxScore} step="0.01" value={score} onChange={(event) => setScore(event.target.value)} />}
      {existingGrade && <input className="input" aria-label="Confirmation de modification de cote" placeholder="MODIFIER LA CÔTE" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />}
    </>}
    {role === "discipline_director" && <>
      <select className="input" aria-label="Élève" value={studentId} onChange={(event) => setStudentId(event.target.value)}><option value="">Choisir un élève</option>{students.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <input className="input" aria-label="Date de présence" type="date" value={attendanceDate} onChange={(event) => setAttendanceDate(event.target.value)} />
      <select className="input" aria-label="Présence" value={attendanceStatus} onChange={(event) => setAttendanceStatus(event.target.value as typeof attendanceStatus)}><option value="present">Présent</option><option value="absent">Absent</option><option value="late">En retard</option></select>
      <input className="input" aria-label="Motif manuel" value={reason} onChange={(event) => setReason(event.target.value)} />
    </>}
    {(role === "school_admin" || role === "secretary") && <>
      <select className="input" aria-label="Classe préchargée" value={classId} onChange={(event) => setClassId(event.target.value)}><option value="">Choisir une classe</option>{context.classes.map((item) => <option key={item.id} value={item.id}>{item.name}{item.option ? ` · ${item.option}` : ""}</option>)}</select>
      <input className="input" aria-label="Nom" placeholder="Nom" value={nom} onChange={(event) => setNom(event.target.value)} />
      <input className="input" aria-label="Post-nom" placeholder="Post-nom" value={postnom} onChange={(event) => setPostnom(event.target.value)} />
      <input className="input" aria-label="Prénom" placeholder="Prénom" value={prenom} onChange={(event) => setPrenom(event.target.value)} />
      <select className="input" aria-label="Sexe" value={sexe} onChange={(event) => setSexe(event.target.value as typeof sexe)}><option value="M">Masculin</option><option value="F">Féminin</option></select>
      <input className="input" aria-label="Date de naissance" type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} />
    </>}
    {role === "cashier" && <>
      <select className="input" aria-label="Élève" value={studentId} onChange={(event) => setStudentId(event.target.value)}><option value="">Choisir un élève</option>{students.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <select className="input" aria-label="Type de frais" value={feeTypeId} onChange={(event) => setFeeTypeId(event.target.value)}><option value="">Choisir un frais</option>{context.fees.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.amount} {item.currency}</option>)}</select>
      <input className="input" aria-label="Montant provisoire" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
      <input className="input" aria-label="Note facultative" value={note} onChange={(event) => setNote(event.target.value)} />
      <p className="font-semibold text-amber-800">Proposition provisoire uniquement : aucun reçu ni solde actualisé avant validation serveur.</p>
    </>}
    {message && <p role="status" className="text-sm">{message}</p>}
    <button type="button" className="primary-button justify-center" disabled={saving} onClick={() => void save()}>Enregistrer le brouillon local</button>
  </section>;
}
