import { useEffect, useState } from "react";
import type { PedagogicalAssignment } from "../studies/studyTypes";
import { loadTeacherGradingRoster, type TeacherGradingData } from "./teacherGradingService";

export function useTeacherGradingRoster(assignment: PedagogicalAssignment | undefined, schoolId: string, schoolYearId: string) {
  const [roster, setRoster] = useState<{ assignmentId: string; students: TeacherGradingData["students"] }>();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!assignment) return;
    let active = true;
    let inFlight = false;
    const refreshRoster = async () => {
      if (!active || inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const next = await loadTeacherGradingRoster({ schoolId, schoolYearId, assignmentId: assignment.id, classId: assignment.classId, subjectId: assignment.subjectId });
        if (active) { setRoster(next); setError(""); }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Actualisation des élèves impossible.");
      } finally { inFlight = false; }
    };
    void refreshRoster();
    const interval = window.setInterval(() => void refreshRoster(), 30_000);
    const onVisibilityChange = () => { if (document.visibilityState === "visible") void refreshRoster(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => { active = false; window.clearInterval(interval); document.removeEventListener("visibilitychange", onVisibilityChange); };
  }, [assignment, schoolId, schoolYearId]);

  return { roster, error };
}
