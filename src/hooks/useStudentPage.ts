import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../firebase";
import type { Student } from "../types";
import { reportClientFailure } from "../services/clientFailureTelemetry";
import { failureKind, plainFailureMessage } from "../services/requestFailure";
import { useAutoRetry } from "./useAutoRetry";
import {
  STUDENT_SOURCE_PAGE_SIZE,
  countStudentResults,
  filterStudentFallback,
  studentQueryKey,
  subscribeStudentPage,
  type StudentPageCursor,
  type StudentQueryFilters,
} from "../services/studentPagination";

export function useStudentPage(filters: StudentQueryFilters, fallbackStudents: Student[]) {
  const key = studentQueryKey(filters);
  const cursors = useRef(new Map<number, StudentPageCursor | undefined>([[1, undefined]]));
  const [page, setPage] = useState(1);
  const [remoteStudents, setRemoteStudents] = useState<Student[]>([]);
  const [hasRemoteSnapshot, setHasRemoteSnapshot] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(Boolean(db));
  const [error, setError] = useState("");
  const fallback = useMemo(() => filterStudentFallback(fallbackStudents, filters), [fallbackStudents, filters]);
  // Une écoute ou un comptage refusé (quota, réseau) est relancé après un délai
  // et au retour du réseau, au lieu de rester bloqué jusqu'au changement d'onglet.
  const countRetry = useAutoRetry();
  const pageRetry = useAutoRetry();
  const { token: countRetryToken, schedule: scheduleCountRetry, succeeded: countSucceeded } = countRetry;
  const { token: pageRetryToken, schedule: schedulePageRetry, succeeded: pageSucceeded } = pageRetry;

  useEffect(() => {
    cursors.current = new Map([[1, undefined]]);
    setHasRemoteSnapshot(false);
    setPage(1);
  }, [filters, key]);

  useEffect(() => {
    if (!db) return;
    let active = true;
    setLoading(true);
    setError("");
    const startedAt = Date.now();
    void countStudentResults(filters).then((count) => { if (active) { countSucceeded(); setTotal(count); } }).catch((cause) => {
      if (active) {
        const kind = failureKind(cause);
        setError(plainFailureMessage(kind, scheduleCountRetry(kind)));
        void reportClientFailure("students.count", cause, startedAt);
      }
    });
    return () => { active = false; };
  }, [countRetryToken, countSucceeded, filters, key, scheduleCountRetry]);

  useEffect(() => {
    if (!db) return;
    setLoading(true);
    setError("");
    const startedAt = Date.now();
    const cursor = cursors.current.get(page);
    return subscribeStudentPage(filters, cursor, (items, nextCursor) => {
      setRemoteStudents(items);
      setHasRemoteSnapshot(true);
      if (nextCursor) cursors.current.set(page + 1, nextCursor);
      pageSucceeded();
      setLoading(false);
    }, (cause) => {
      const kind = failureKind(cause);
      setError(plainFailureMessage(kind, schedulePageRetry(kind)));
      setLoading(false);
      void reportClientFailure("students.page", cause, startedAt);
    });
  }, [filters, key, page, pageRetryToken, pageSucceeded, schedulePageRetry]);

  const students = db && hasRemoteSnapshot ? remoteStudents : fallback.slice((page - 1) * STUDENT_SOURCE_PAGE_SIZE, page * STUDENT_SOURCE_PAGE_SIZE);
  const resultTotal = db && hasRemoteSnapshot ? total : fallback.length;
  const pageCount = Math.max(1, Math.ceil(resultTotal / STUDENT_SOURCE_PAGE_SIZE));
  const previous = () => setPage((current) => Math.max(1, current - 1));
  const next = () => setPage((current) => Math.min(pageCount, current + 1));

  return { students, total: resultTotal, page, pageCount, loading, error, previous, next, setPage };
}
