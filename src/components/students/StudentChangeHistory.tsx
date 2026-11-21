import { useEffect, useState } from "react";
import { FormPanel } from "../ui";
import { ErrorNotice } from "../ui/ErrorNotice";
import { loadStudentChangeLogs, studentChangeFieldLabel, studentChangeRoleLabel, type StudentChangeLog } from "../../services/studentChangeLogs";
import { userFacingError } from "../../utils/userFacingError";

/** Historique des modifications de la fiche (administrateur) : qui, quand, avant / après. */
export function StudentChangeHistory({ schoolId, studentId }: { schoolId: string; studentId: string }) {
  const [logs, setLogs] = useState<StudentChangeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    loadStudentChangeLogs(schoolId, studentId)
      .then((items) => { if (!cancelled) setLogs(items); })
      .catch((cause) => { if (!cancelled) setError(userFacingError(cause, "Historique des modifications indisponible pour le moment.")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [schoolId, studentId]);

  return (
    <FormPanel title="Historique des modifications">
      <ErrorNotice error={error} />
      {loading && <p role="status" className="text-sm text-slate-500">Chargement de l’historique…</p>}
      {!loading && !error && logs.length === 0 && <p className="text-sm text-slate-500">Aucune modification enregistrée.</p>}
      <div className="max-h-80 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
        {logs.map((log) => (
          <div key={log.id} className="min-w-0 rounded border border-slate-100 p-3 text-sm">
            <p className="break-words font-semibold text-ink">
              {log.action === "create" ? "Création" : "Modification"} · {log.actorName} ({studentChangeRoleLabel(log.actorRole)}) · {new Date(log.createdAt).toLocaleString("fr-FR")}
            </p>
            <ul className="mt-1 grid gap-0.5 text-slate-600">
              {log.fields.map((field) => (
                <li key={field} className="break-words">
                  {studentChangeFieldLabel(field)} : {log.action === "update" ? <>{log.before[field] || "vide"} → </> : null}{log.after[field] || "vide"}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </FormPanel>
  );
}
