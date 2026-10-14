import { useEffect, useState } from "react";
import type { AppUser } from "../../types";
import type { SchoolCalendar } from "./schoolCalendar";
import { subscribeSchoolCalendar } from "./schoolCalendarService";

export function useSchoolCalendar(user: AppUser, schoolId: string, schoolYearId: string | undefined) {
  const [state, setState] = useState<{ schoolYearId?: string; calendar?: SchoolCalendar; loading: boolean; error: string }>({ loading: true, error: "" });
  useEffect(() => {
    setState({ schoolYearId, loading: true, error: "" });
    if (!schoolYearId) { setState({ schoolYearId, loading: false, error: "" }); return; }
    try {
      return subscribeSchoolCalendar({ user, schoolId, schoolYearId,
        onData: (calendar) => setState({ schoolYearId, calendar, loading: false, error: "" }),
        onError: (error) => setState({ schoolYearId, loading: false, error: error.message }),
      });
    } catch (error) { setState({ schoolYearId, loading: false, error: error instanceof Error ? error.message : "Calendrier indisponible." }); return; }
  }, [user, schoolId, schoolYearId]);
  return state.schoolYearId === schoolYearId ? state : { loading: true, error: "" };
}
