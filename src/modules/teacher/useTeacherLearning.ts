import { useEffect, useState } from "react";
import type { AppUser } from "../../types";
import type { PedagogicalDocument, TeacherStudentObservation, TeachingProgressEntry } from "./teacherLearning";
import { subscribeTeacherLearning } from "./teacherLearningService";
import { userFacingError } from "../../utils/userFacingError";
import { useLoadRetry } from "../../hooks/useLoadRetry";

export function useTeacherLearning(user: AppUser, schoolId: string, schoolYearId: string, teacherId?: string) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ progress: TeachingProgressEntry[]; observations: TeacherStudentObservation[]; documents: PedagogicalDocument[]; loading: boolean; error: string }>({ progress: [], observations: [], documents: [], loading: true, error: "" });
  const { token: loadRetryToken, retry } = useLoadRetry(Boolean(state.error));
  useEffect(() => {
    let active = true;
    const empty = { progress: [], observations: [], documents: [] };
    if (!teacherId) { setState({ ...empty, loading: false, error: "" }); return; }
    setState({ ...empty, loading: true, error: "" });
    try {
      const unsubscribe = subscribeTeacherLearning(user, schoolId, schoolYearId, teacherId,
        (value) => { if (active) setState({ ...value, loading: false, error: "" }); },
        (error) => { if (active) setState({ ...empty, loading: false, error: userFacingError(error, "Chargement impossible. Veuillez réessayer.") }); });
      return () => { active = false; unsubscribe(); };
    } catch (cause) { setState({ ...empty, loading: false, error: userFacingError(cause, "Chargement impossible.") }); }
  }, [schoolId, schoolYearId, teacherId, user, revision, loadRetryToken]);
  return { ...state, retry: () => { setRevision((value) => value + 1); retry(); } };
}
