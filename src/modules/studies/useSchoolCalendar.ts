import { useEffect, useState } from "react";
import type { AppUser } from "../../types";
import type { SchoolCalendar } from "./schoolCalendar";
import { subscribeSchoolCalendar } from "./schoolCalendarService";
import { userFacingError } from "../../utils/userFacingError";
import { useLoadRetry } from "../../hooks/useLoadRetry";

export function useSchoolCalendar(user: AppUser, schoolId: string, schoolYearId: string | undefined) {
  const [state, setState] = useState<{ schoolYearId?: string; calendar?: SchoolCalendar; loading: boolean; error: string }>({ loading: true, error: "" });
  const { token: loadRetryToken, retry } = useLoadRetry(Boolean(state.schoolYearId === schoolYearId && state.error));
  useEffect(() => {
    setState({ schoolYearId, loading: true, error: "" });
    if (!schoolYearId) { setState({ schoolYearId, loading: false, error: "" }); return; }
    try {
      return subscribeSchoolCalendar({ user, schoolId, schoolYearId,
        onData: (calendar) => setState({ schoolYearId, calendar, loading: false, error: "" }),
        onError: (error) => setState({ schoolYearId, loading: false, error: userFacingError(error, "Chargement impossible. Veuillez réessayer.") }),
      });
    } catch (error) { setState({ schoolYearId, loading: false, error: userFacingError(error, "Calendrier indisponible.") }); return; }
  }, [user, schoolId, schoolYearId, loadRetryToken]);
  return state.schoolYearId === schoolYearId ? { ...state, retry } : { loading: true, error: "", retry };
}
