import { useEffect, useMemo, useState } from "react";
import type { AppUser, FeeType, School, SchoolClassRecord, SchoolYear } from "../../types";
import { COORDINATION_ACTIVE_YEAR, loadCoordinationStudentYears, type CoordinationStudentFilters } from "../../services/coordinationStudentPagination";
import { loadCoordinationControlFees, loadCoordinationControlPage, type CoordinationControlCursor, type CoordinationControlPage } from "../../services/coordinationControlPagination";
import { loadCoordinationClassFilterChoices } from "../../services/coordinationService";
import { coordinationFilterChoices } from "./coordinationFilterChoices";
import { classFilterReadyForPage } from "./classFilterReadiness";
import type { CoordinationStudentStatus } from "../../utils/coordinationSupervision";
import type { ArrearsFilter } from "../../utils/arrearsFilter";

const emptyPage: CoordinationControlPage = { rows: [], fetchedStudents: 0 };
export function useCoordinationControlPage(user: AppUser, schools: School[], selectedSchoolId: string, refreshToken: number, classKey: string, amountComparator: string, amountThreshold: string, arrearsFilter: ArrearsFilter) {
  const [years, setYears] = useState<SchoolYear[]>([]);
  const [fees, setFees] = useState<FeeType[]>([]);
  const [classes, setClasses] = useState<SchoolClassRecord[]>([]);
  const [metadataKey, setMetadataKey] = useState("");
  const [metadataError, setMetadataError] = useState("");
  const [classMetadataKey, setClassMetadataKey] = useState("");
  const [classMetadataError, setClassMetadataError] = useState("");
  const [selectedYearId, setSelectedYearId] = useState<string>(COORDINATION_ACTIVE_YEAR);
  const [status, setStatus] = useState<CoordinationStudentStatus>("all");
  const [option, setOption] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [cursors, setCursors] = useState<Array<CoordinationControlCursor | undefined>>([undefined]);
  const [page, setPage] = useState(emptyPage);
  const [pageKey, setPageKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [errorKey, setErrorKey] = useState("");
  const schoolKey = schools.map((school) => school.id).sort().join("|");
  const activeYearKey = schools.map((school) => `${school.id}:${school.activeSchoolYearId ?? ""}`).sort().join("|");
  const contextKey = `${schoolKey}:${activeYearKey}:${refreshToken}`;
  useEffect(() => {
    let cancelled = false;
    setMetadataKey(""); setMetadataError("");
    const ids = schoolKey ? schoolKey.split("|") : [];
    Promise.all([loadCoordinationStudentYears(ids, user.role === "sub_coordination_admin"), loadCoordinationControlFees(ids, user.role === "sub_coordination_admin")])
      .then(([nextYears, nextFees]) => { if (!cancelled) { setYears(nextYears); setFees(nextFees); setMetadataKey(contextKey); } })
      .catch(() => { if (!cancelled) setMetadataError("Impossible de charger les années et frais du contrôle."); });
    return () => { cancelled = true; };
  }, [contextKey, schoolKey, user.role]);
  useEffect(() => {
    let cancelled = false;
    setClassMetadataKey(""); setClassMetadataError(""); setClasses([]);
    const ids = schoolKey ? schoolKey.split("|") : [];
    const request = ids.length ? loadCoordinationClassFilterChoices() : Promise.resolve<SchoolClassRecord[]>([]);
    request
      .then((nextClasses) => { if (!cancelled) { setClasses(nextClasses); setClassMetadataKey(contextKey); } })
      .catch(() => { if (!cancelled) setClassMetadataError("Impossible de charger les choix de classes du contrôle."); });
    return () => { cancelled = true; };
  }, [contextKey, schoolKey]);
  const sections = useMemo(() => user.sectionIds?.length ? user.sectionIds : user.section ? [user.section] : [], [user.sectionIds, user.section]);
  const choices = useMemo(() => coordinationFilterChoices(schools, years, classes, selectedSchoolId, selectedYearId, sections, classKey), [schools, years, classes, selectedSchoolId, selectedYearId, sections, classKey]);
  const classChoices = choices.classes;
  const choice = useMemo(() => classChoices.find((item) => item.value === classKey), [classChoices, classKey]);
  const options = choices.options;
  const validOption = options.includes(option) ? option : "";
  const classChoicesReady = classMetadataKey === contextKey;
  const classFilterReady = classFilterReadyForPage(classKey, option, classChoicesReady, Boolean(choice), Boolean(validOption));
  const filters = useMemo<CoordinationStudentFilters>(() => ({ schools, years, selectedSchoolId, selectedYearId, filterSchoolId: choice?.schoolId ?? "", search: "", status, className: choice?.name ?? "", classBranchesBySource: choice?.branchesBySource, option: validOption, allowedSections: sections }), [schools, years, selectedSchoolId, selectedYearId, choice?.schoolId, choice?.name, choice?.branchesBySource, status, validOption, sections]);
  const amountFilter = useMemo(() => ({ comparator: amountComparator, threshold: amountThreshold }), [amountComparator, amountThreshold]);
  const filterKey = JSON.stringify({ contextKey, selectedSchoolId, selectedYearId, classKey, status, option, sections, amountFilter, arrearsFilter });
  const currentPageKey = `${filterKey}:${pageIndex}`;
  useEffect(() => { setPageIndex(0); setCursors([undefined]); setPage(emptyPage); setPageKey(""); }, [filterKey]);
  useEffect(() => {
    if (metadataKey !== contextKey || !classFilterReady || pageIndex >= cursors.length) return;
    let cancelled = false;
    setLoading(true); setError(""); setErrorKey("");
    loadCoordinationControlPage(filters, fees, amountFilter, cursors[pageIndex], arrearsFilter)
      .then((result) => { if (!cancelled) { setPage(result); setPageKey(currentPageKey); } })
      .catch(() => { if (!cancelled) { setError("Impossible de charger la page du contrôle."); setErrorKey(currentPageKey); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [metadataKey, contextKey, classFilterReady, pageIndex, cursors, currentPageKey, filters, fees, amountFilter, arrearsFilter]);
  useEffect(() => { if (metadataKey === contextKey && selectedYearId && selectedYearId !== COORDINATION_ACTIVE_YEAR && !years.some((year) => year.id === selectedYearId && (!selectedSchoolId || year.schoolId === selectedSchoolId))) setSelectedYearId(COORDINATION_ACTIVE_YEAR); }, [contextKey, metadataKey, selectedSchoolId, selectedYearId, years]);
  useEffect(() => { if (classChoicesReady && option && !options.includes(option)) setOption(""); }, [classChoicesReady, option, options]);
  const pagePending = pageKey !== currentPageKey && errorKey !== currentPageKey;
  return { years, fees, classChoices, options, filters, amountFilter, filterKey, metadataReady: classChoicesReady, classChoicesReady, selectedYearId, setSelectedYearId, status, setStatus, option, setOption,
    rows: pageKey === currentPageKey ? page.rows : [], loading: loading || (!metadataError && !classMetadataError && (metadataKey !== contextKey || !classFilterReady || pagePending)), error: metadataError || classMetadataError || (errorKey === currentPageKey ? error : ""), pageIndex,
    hasNext: pageKey === currentPageKey && Boolean(page.nextCursor),
    previous: () => setPageIndex((value) => Math.max(0, value - 1)),
    next: () => { if (!page.nextCursor || pageKey !== currentPageKey) return; setCursors((value) => [...value.slice(0, pageIndex + 1), page.nextCursor]); setPageIndex((value) => value + 1); },
  };
}
