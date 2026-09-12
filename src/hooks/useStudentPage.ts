import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../firebase";
import type { Student } from "../types";
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
    void countStudentResults(filters).then((count) => { if (active) setTotal(count); }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "Impossible de compter les élèves.");
    });
    return () => { active = false; };
  }, [filters, key]);

  useEffect(() => {
    if (!db) return;
    setLoading(true);
    setError("");
    const cursor = cursors.current.get(page);
    return subscribeStudentPage(filters, cursor, (items, nextCursor) => {
      setRemoteStudents(items);
      setHasRemoteSnapshot(true);
      if (nextCursor) cursors.current.set(page + 1, nextCursor);
      setLoading(false);
    }, (cause) => {
      setError(cause.message);
      setLoading(false);
    });
  }, [filters, key, page]);

  const students = db && hasRemoteSnapshot ? remoteStudents : fallback.slice((page - 1) * STUDENT_SOURCE_PAGE_SIZE, page * STUDENT_SOURCE_PAGE_SIZE);
  const resultTotal = db && hasRemoteSnapshot ? total : fallback.length;
  const pageCount = Math.max(1, Math.ceil(resultTotal / STUDENT_SOURCE_PAGE_SIZE));
  const previous = () => setPage((current) => Math.max(1, current - 1));
  const next = () => setPage((current) => Math.min(pageCount, current + 1));

  return { students, total: resultTotal, page, pageCount, loading, error, previous, next, setPage };
}
