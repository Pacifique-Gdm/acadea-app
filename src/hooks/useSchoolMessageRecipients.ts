import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { loadSchoolMessageRecipients, type SchoolMessageRecipient } from "../services/schoolMessaging";
import type { AppUser, School } from "../types";

type DirectoryState = {
  recipients: SchoolMessageRecipient[];
  loading: boolean;
  error: string;
};

export function useSchoolMessageRecipients(user: AppUser, school: School): DirectoryState {
  const [recipients, setRecipients] = useState<SchoolMessageRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [coordinationId, setCoordinationId] = useState(school.activeCoordinationId ?? "");
  const [subCoordinationIds, setSubCoordinationIds] = useState<string[]>([]);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const queued = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const reload = useCallback(async () => {
    if (inFlight.current) { queued.current = true; return; }
    inFlight.current = true;
    do {
      queued.current = false;
      if (mounted.current) { setLoading(true); setError(""); }
      try {
        const next = await loadSchoolMessageRecipients();
        if (mounted.current) setRecipients(next);
      } catch (cause) {
        if (mounted.current) setError(cause instanceof Error ? cause.message : "Destinataires indisponibles. Veuillez réessayer.");
      }
    } while (queued.current && mounted.current);
    inFlight.current = false;
    if (mounted.current) setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, user.id, school.id]);

  useEffect(() => {
    if (!db || user.role !== "school_admin") return;
    let initial = true;
    return onSnapshot(doc(db, "schools", school.id), (snapshot) => {
      const activeCoordinationId = snapshot.exists() ? snapshot.data().activeCoordinationId : undefined;
      const next = typeof activeCoordinationId === "string" ? activeCoordinationId : "";
      setCoordinationId(next);
      if (initial) { initial = false; return; }
      void reload();
    }, () => setError("Actualisation temps réel des destinataires indisponible."));
  }, [reload, school.id, user.role]);

  useEffect(() => {
    if (!db || user.role !== "school_admin" || !coordinationId) { setSubCoordinationIds([]); return; }
    let initialCoordination = true;
    let initialRelations = true;
    const stopCoordination = onSnapshot(doc(db, "coordinations", coordinationId), () => {
      if (initialCoordination) { initialCoordination = false; return; }
      void reload();
    }, () => setError("Actualisation temps réel de la Coordination indisponible."));
    const stopRelations = onSnapshot(query(
      collection(db, "subCoordinationSchools"),
      where("schoolId", "==", school.id),
      where("coordinationId", "==", coordinationId),
    ), (snapshot) => {
      setSubCoordinationIds([...new Set(snapshot.docs.map((item) => item.data()).filter((relation) => relation.active === true).map((relation) => relation.subCoordinationId).filter((value): value is string => typeof value === "string" && Boolean(value)))].sort());
      if (initialRelations) { initialRelations = false; return; }
      void reload();
    }, () => setError("Actualisation temps réel des Sous-coordinations indisponible."));
    return () => { stopCoordination(); stopRelations(); };
  }, [coordinationId, reload, school.id, user.role]);

  useEffect(() => {
    if (!db || user.role !== "school_admin" || subCoordinationIds.length === 0) return;
    return (() => {
      const stops = subCoordinationIds.map((id) => {
        let initial = true;
        return onSnapshot(doc(db, "subCoordinations", id), () => {
          if (initial) { initial = false; return; }
          void reload();
        }, () => setError("Actualisation temps réel des Sous-coordinateurs indisponible."));
      });
      return () => stops.forEach((stop) => stop());
    })();
  }, [reload, subCoordinationIds, user.role]);

  const coordinationRecipientIds = useMemo(() => recipients
    .filter((recipient) => recipient.role === "coordination_admin" || recipient.role === "sub_coordination_admin")
    .map((recipient) => recipient.uid)
    .sort(), [recipients]);

  useEffect(() => {
    if (!db || user.role !== "school_admin" || coordinationRecipientIds.length === 0) return;
    const stops = coordinationRecipientIds.map((id) => {
      let initial = true;
      return onSnapshot(doc(db, "users", id), () => {
        if (initial) { initial = false; return; }
        void reload();
      }, () => setError("Actualisation temps réel des destinataires indisponible."));
    });
    return () => stops.forEach((stop) => stop());
  }, [coordinationRecipientIds, reload, user.role]);

  return { recipients, loading, error };
}
