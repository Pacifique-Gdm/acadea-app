import { useMemo, useState } from "react";
import { Ban, FileText, Fingerprint, Radio, RefreshCw } from "lucide-react";
import { ActionSnackbar, AdminDrawer, FormPanel, SectionTitle } from "../../components/ui";
import { cardStatusLabels, fingerprintStatusLabels, formatBiometricDate, hasAssignedCard, hasEnrolledFingerprint, maskCardUid, resolveStudentBiometric } from "../../utils/biometrics";
import { formatStudentClassName } from "../../utils/studentClasses";
import type { Student } from "../../types";

type BiometricMode = "fingerprints" | "cards";

export function BiometricStudentsPage({ mode, students, loading, error, onBack }: { mode: BiometricMode; students: Student[]; loading: boolean; error: string; onBack: () => void }) {
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [message, setMessage] = useState("");
  const isFingerprintMode = mode === "fingerprints";
  const visibleStudents = useMemo(
    () => students.filter((student) => isFingerprintMode ? hasEnrolledFingerprint(student) : hasAssignedCard(student)),
    [isFingerprintMode, students],
  );
  const selectedStudent = visibleStudents.find((student) => student.id === selectedStudentId);
  const unavailable = () => setMessage("Disponible après connexion d’un terminal ZKTeco via Acadéa Sync.");

  return (
    <section className="grid min-w-0 gap-4">
      <button type="button" onClick={onBack} className="secondary-button w-fit">← Retour</button>
      <SectionTitle
        title={isFingerprintMode ? "Empreintes" : "Cartes"}
        subtitle={isFingerprintMode ? "Élèves disposant d’une empreinte enregistrée." : "Élèves disposant d’une carte RFID associée."}
      />
      {loading && <p className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-500">Chargement des données biométriques…</p>}
      {error && <p className="rounded border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">Données temporairement indisponibles : {error}</p>}
      {!loading && !error && visibleStudents.length === 0 && (
        <FormPanel title={isFingerprintMode ? "Aucune empreinte enregistrée" : "Aucune carte associée"}>
          <p className="text-sm text-slate-500">Aucun élève ne correspond encore à cette catégorie.</p>
        </FormPanel>
      )}
      {!loading && !error && visibleStudents.length > 0 && (
        <div className="max-w-full overflow-x-auto rounded border border-slate-200 bg-white">
          <table className={`${isFingerprintMode ? "min-w-[720px]" : "min-w-[840px]"} w-full text-left text-sm`}>
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-3">Nom</th>
                <th className="px-3 py-3">Prénom</th>
                <th className="px-3 py-3">Classe</th>
                {!isFingerprintMode && <th className="px-3 py-3">UID</th>}
                <th className="px-3 py-3">Statut</th>
                <th className="px-3 py-3">Dernière mise à jour</th>
              </tr>
            </thead>
            <tbody>
              {visibleStudents.map((student) => {
                const biometric = resolveStudentBiometric(student);
                return (
                  <tr key={student.id} className="cursor-pointer border-t border-slate-100 transition hover:bg-slate-50" onClick={() => setSelectedStudentId(student.id)}>
                    <td className="px-3 py-3 font-semibold text-ink">{student.nom} {student.postnom}</td>
                    <td className="px-3 py-3">{student.prenom}</td>
                    <td className="px-3 py-3">{formatStudentClassName(student)}</td>
                    {!isFingerprintMode && <td className="px-3 py-3 font-mono" title="UID masqué">{maskCardUid(biometric.cardUid)}</td>}
                    <td className="px-3 py-3">{isFingerprintMode ? fingerprintStatusLabels[biometric.fingerprintStatus] : cardStatusLabels[biometric.cardStatus]}</td>
                    <td className="px-3 py-3">{formatBiometricDate(isFingerprintMode ? biometric.fingerprintUpdatedAt : biometric.cardUpdatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {selectedStudent && (
        <AdminDrawer title={`${selectedStudent.nom} ${selectedStudent.postnom} ${selectedStudent.prenom}`} onClose={() => { setHistoryOpen(false); setSelectedStudentId(null); }} closeLabel="Fermer le détail biométrique">
          <div className="grid min-w-0 gap-4">
            <button type="button" onClick={() => setSelectedStudentId(null)} className="secondary-button w-fit">← Retour</button>
            <FormPanel title="Élève">
              <p className="font-semibold text-ink">{selectedStudent.matricule}</p>
              <p className="text-sm text-slate-500">{formatStudentClassName(selectedStudent)}</p>
            </FormPanel>
            <div className="grid gap-2">
              <button type="button" onClick={unavailable} className="secondary-button justify-center">{isFingerprintMode ? <Fingerprint className="h-4 w-4" /> : <Radio className="h-4 w-4" />} {isFingerprintMode ? "Ajouter une empreinte" : "Associer une carte"}</button>
              <button type="button" onClick={unavailable} className="secondary-button justify-center"><RefreshCw className="h-4 w-4" /> {isFingerprintMode ? "Remplacer l’empreinte" : "Remplacer la carte"}</button>
              <button type="button" onClick={unavailable} className="secondary-button justify-center"><Ban className="h-4 w-4" /> {isFingerprintMode ? "Désactiver l’empreinte" : "Désactiver la carte"}</button>
              <button type="button" onClick={() => setHistoryOpen(true)} className="secondary-button justify-center"><FileText className="h-4 w-4" /> {isFingerprintMode ? "Historique des empreintes" : "Historique des cartes"}</button>
            </div>
          </div>
        </AdminDrawer>
      )}
      {historyOpen && selectedStudent && (
        <AdminDrawer title={isFingerprintMode ? "Historique des empreintes" : "Historique des cartes"} onClose={() => setHistoryOpen(false)} closeLabel="Fermer l’historique">
          <div className="grid min-w-0 gap-4">
            <button type="button" onClick={() => setHistoryOpen(false)} className="secondary-button w-fit">← Retour</button>
            <div className="max-w-full overflow-x-auto rounded border border-slate-200 bg-white">
              <table className="min-w-[620px] w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-3">Date</th>{!isFingerprintMode && <th className="px-3 py-3">UID</th>}<th className="px-3 py-3">Action</th><th className="px-3 py-3">Utilisateur</th><th className="px-3 py-3">Terminal</th></tr></thead>
                <tbody><tr className="border-t border-slate-100"><td colSpan={isFingerprintMode ? 4 : 5} className="px-3 py-8 text-center text-slate-500">Aucun historique disponible.</td></tr></tbody>
              </table>
            </div>
          </div>
        </AdminDrawer>
      )}
      <ActionSnackbar message={message} onClose={() => setMessage("")} />
    </section>
  );
}
