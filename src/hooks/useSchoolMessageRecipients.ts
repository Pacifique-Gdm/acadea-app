import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, onSnapshot, query, where, type DocumentData } from "firebase/firestore";
import { db } from "../firebase";
import { loadSchoolMessageRecipients, type SchoolMessageRecipient } from "../services/schoolMessaging";
import type { AppUser, School } from "../types";

type DirectoryState = {
  recipients: SchoolMessageRecipient[];
  loading: boolean;
  error: string;
  /** Vrai dès que l'école est rattachée à une Coordination (connu tout de suite, sans attendre la liste). */
  hasCoordination: boolean;
};

/** Correction « Messages » : la liste est gardée en mémoire pour la session (affichage immédiat à chaque ouverture),
 * puis vérifiée discrètement. Elle n'est rechargée que si une information utile change vraiment. */
const memory = new Map<string, SchoolMessageRecipient[]>();
const pending = new Map<string, Promise<SchoolMessageRecipient[]>>();
export const recipientsMemoryKey = (userId: string, schoolId: string, schoolYearId?: string) => `${userId}|${schoolId}|${schoolYearId ?? ""}`;
export function forgetSchoolMessageRecipients() { memory.clear(); pending.clear(); }
export function peekSchoolMessageRecipients(key: string) { return memory.get(key) ?? null; }
/** Un seul appel à la fois pour la même liste (plusieurs écrans ouverts ne relisent pas en double). */
export function fetchSchoolMessageRecipients(key: string, schoolYearId?: string, load = loadSchoolMessageRecipients) {
  const running = pending.get(key);
  if (running) return running;
  const request = load(schoolYearId).then((next) => { memory.set(key, next); return next; }).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}
/** Empreinte des seuls champs qui changent la liste des destinataires (nom, rôle, statut, rattachements). */
export function recipientFingerprint(data: DocumentData | undefined) {
  if (!data) return "absent";
  return JSON.stringify([data.name ?? null, data.lastName ?? null, data.firstName ?? null, data.role ?? null, data.active ?? null, data.status ?? null,
    data.coordinationId ?? null, data.subCoordinationId ?? null, data.coordinatorUserId ?? null, data.activeCoordinationId ?? null, data.schoolId ?? null]);
}

export function useSchoolMessageRecipients(user: AppUser, school: School, schoolYearId?: string): DirectoryState {
  const key = recipientsMemoryKey(user.id, school.id, schoolYearId);
  const [recipients, setRecipients] = useState<SchoolMessageRecipient[]>(() => peekSchoolMessageRecipients(key) ?? []);
  const [loading, setLoading] = useState(() => !peekSchoolMessageRecipients(key));
  const [error, setError] = useState("");
  const [coordinationId, setCoordinationId] = useState(school.activeCoordinationId ?? "");
  const [subCoordinationIds, setSubCoordinationIds] = useState<string[]>([]);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const reload = useCallback(async () => {
    // Le chargement n'est montré que s'il n'y a encore rien à afficher : une vérification ne fait jamais clignoter l'écran.
    if (mounted.current && !peekSchoolMessageRecipients(key)) setLoading(true);
    try {
      const next = await fetchSchoolMessageRecipients(key, schoolYearId);
      if (mounted.current) { setRecipients((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next); setError(""); }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Destinataires indisponibles. Veuillez réessayer.");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [key, schoolYearId]);

  useEffect(() => {
    const kept = peekSchoolMessageRecipients(key);
    if (kept) { setRecipients(kept); setLoading(false); }
    void reload();
  }, [key, reload]);

  /** Écoute un document et ne recharge que si ses champs utiles ont changé (pas à chaque écriture). */
  const watch = useCallback((ref: Parameters<typeof onSnapshot>[0], onChange: (data: DocumentData | undefined) => void, message: string) => {
    let last: string | null = null;
    return onSnapshot(ref as never, (snapshot: { data: () => DocumentData | undefined }) => {
      const data = snapshot.data();
      const print = recipientFingerprint(data);
      const changed = last !== null && last !== print;
      last = print;
      onChange(data);
      if (changed) void reload();
    }, () => setError(message));
  }, [reload]);

  useEffect(() => {
    if (!db || user.role !== "school_admin") return;
    return watch(doc(db, "schools", school.id), (data) => {
      const next = typeof data?.activeCoordinationId === "string" ? data.activeCoordinationId : "";
      setCoordinationId(next);
    }, "Actualisation temps réel des destinataires indisponible.");
  }, [watch, school.id, user.role]);

  useEffect(() => {
    if (!db || user.role !== "school_admin" || !coordinationId) { setSubCoordinationIds([]); return; }
    const stopCoordination = watch(doc(db, "coordinations", coordinationId), () => undefined, "Actualisation temps réel de la Coordination indisponible.");
    let lastRelations: string | null = null;
    const stopRelations = onSnapshot(query(
      collection(db, "subCoordinationSchools"),
      where("schoolId", "==", school.id),
      where("coordinationId", "==", coordinationId),
    ), (snapshot) => {
      const ids = [...new Set(snapshot.docs.map((item) => item.data()).filter((relation) => relation.active === true).map((relation) => relation.subCoordinationId).filter((value): value is string => typeof value === "string" && Boolean(value)))].sort();
      const print = ids.join("|");
      const changed = lastRelations !== null && lastRelations !== print;
      lastRelations = print;
      setSubCoordinationIds((current) => current.join("|") === print ? current : ids);
      if (changed) void reload();
    }, () => setError("Actualisation temps réel des Sous-coordinations indisponible."));
    return () => { stopCoordination(); stopRelations(); };
  }, [coordinationId, watch, reload, school.id, user.role]);

  const subKey = subCoordinationIds.join("|");
  useEffect(() => {
    if (!db || user.role !== "school_admin" || !subKey) return;
    const stops = subKey.split("|").map((id) => watch(doc(db!, "subCoordinations", id), () => undefined, "Actualisation temps réel des Sous-coordinateurs indisponible."));
    return () => stops.forEach((stop) => stop());
  }, [subKey, watch, user.role]);

  const coordinationKey = useMemo(() => recipients
    .filter((recipient) => recipient.role === "coordination_admin" || recipient.role === "sub_coordination_admin")
    .map((recipient) => recipient.uid)
    .sort().join("|"), [recipients]);

  useEffect(() => {
    if (!db || user.role !== "school_admin" || !coordinationKey) return;
    const stops = coordinationKey.split("|").map((id) => watch(doc(db!, "users", id), () => undefined, "Actualisation temps réel des destinataires indisponible."));
    return () => stops.forEach((stop) => stop());
  }, [coordinationKey, watch, user.role]);

  return { recipients, loading, error, hasCoordination: Boolean(coordinationId) };
}

/** Préparation discrète pour l'Administrateur d'école : la liste est prête quand il ouvre Messages. */
export function usePrefetchSchoolMessageRecipients(user: Pick<AppUser, "id" | "role"> | null | undefined, schoolId?: string, schoolYearId?: string) {
  const key = user?.role === "school_admin" && schoolId && schoolYearId ? recipientsMemoryKey(user.id, schoolId, schoolYearId) : "";
  useEffect(() => { if (!user) forgetSchoolMessageRecipients(); }, [user]);
  useEffect(() => {
    if (!key || peekSchoolMessageRecipients(key)) return;
    const timer = window.setTimeout(() => { void fetchSchoolMessageRecipients(key, schoolYearId).catch(() => undefined); }, 2500);
    return () => window.clearTimeout(timer);
  }, [key, schoolYearId]);
}
