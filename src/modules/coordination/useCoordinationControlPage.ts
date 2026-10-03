import { useEffect, useMemo, useState } from "react";
import type { AppUser, FeeType, School, SchoolYear } from "../../types";
import { loadCoordinationStudentYears, type CoordinationStudentFilters } from "../../services/coordinationStudentPagination";
import { loadCoordinationControlFees, loadCoordinationControlPage, type CoordinationControlCursor, type CoordinationControlPage } from "../../services/coordinationControlPagination";
import { getSchoolClassChoices } from "../../utils/schoolConfig";
import { getClassSection } from "../../utils/studentClasses";
import { normalizeSchoolOptions } from "../../utils/schoolOptions";
import type { CoordinationStudentStatus } from "../../utils/coordinationSupervision";
import type { ArrearsFilter } from "../../utils/arrearsFilter";

const emptyPage: CoordinationControlPage = { rows: [], fetchedStudents: 0 };
export function useCoordinationControlPage(user: AppUser, schools: School[], selectedSchoolId: string, refreshToken: number, classKey: string, amountComparator: string, amountThreshold: string, arrearsFilter: ArrearsFilter) {
  const [years, setYears] = useState<SchoolYear[]>([]);
  const [fees, setFees] = useState<FeeType[]>([]);
  const [metadataKey, setMetadataKey] = useState("");
  const [metadataError, setMetadataError] = useState("");
  const [selectedYearId, setSelectedYearId] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<CoordinationStudentStatus>("all");
  const [option, setOption] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [cursors, setCursors] = useState<Array<CoordinationControlCursor | undefined>>([undefined]);
  const [page, setPage] = useState(emptyPage);
  const [pageKey, setPageKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const schoolKey = schools.map((school) => school.id).sort().join("|");
  const contextKey = `${schoolKey}:${refreshToken}`;
  useEffect(() => {
    let cancelled = false;
    setMetadataKey(""); setMetadataError("");
    const ids = schoolKey ? schoolKey.split("|") : [];
    Promise.all([loadCoordinationStudentYears(ids), loadCoordinationControlFees(ids)])
      .then(([nextYears, nextFees]) => { if (!cancelled) { setYears(nextYears); setFees(nextFees); setMetadataKey(contextKey); } })
      .catch(() => { if (!cancelled) setMetadataError("Impossible de charger les années et frais du contrôle."); });
    return () => { cancelled = true; };
  }, [contextKey, schoolKey]);
  const sections = useMemo(() => user.sectionIds?.length ? user.sectionIds : user.section ? [user.section] : [], [user.sectionIds, user.section]);
  const visibleSchools = useMemo(() => schools.filter((school) => !selectedSchoolId || school.id === selectedSchoolId), [schools, selectedSchoolId]);
  const classChoices = useMemo(() => visibleSchools.flatMap((school) => getSchoolClassChoices(school).filter((name) => !sections.length || sections.includes(getClassSection(name))).map((name) => ({ value: `${school.id}::${name}`, name, schoolId: school.id, label: `${name}${selectedSchoolId ? "" : ` — ${school.name}`}` }))), [visibleSchools, sections, selectedSchoolId]);
  const options = useMemo(() => [...new Set(visibleSchools.flatMap((school) => normalizeSchoolOptions(school.schoolOptions)))], [visibleSchools]);
  const choice = classChoices.find((item) => item.value === classKey);
  const filters = useMemo<CoordinationStudentFilters>(() => ({ schools, years, selectedSchoolId, selectedYearId, filterSchoolId: choice?.schoolId ?? "", search, status, className: choice?.name ?? "", option, allowedSections: sections }), [schools, years, selectedSchoolId, selectedYearId, choice?.schoolId, choice?.name, search, status, option, sections]);
  const amountFilter = useMemo(() => ({ comparator: amountComparator, threshold: amountThreshold }), [amountComparator, amountThreshold]);
  const filterKey = JSON.stringify({ contextKey, selectedSchoolId, selectedYearId, classKey, search, status, option, sections, amountFilter, arrearsFilter });
  const currentPageKey = `${filterKey}:${pageIndex}`;
  useEffect(() => { setPageIndex(0); setCursors([undefined]); setPage(emptyPage); setPageKey(""); }, [filterKey]);
  useEffect(() => {
    if (metadataKey !== contextKey || pageIndex >= cursors.length) return;
    let cancelled = false;
    setLoading(true); setError("");
    loadCoordinationControlPage(filters, fees, amountFilter, cursors[pageIndex], arrearsFilter)
      .then((result) => { if (!cancelled) { setPage(result); setPageKey(currentPageKey); } })
      .catch(() => { if (!cancelled) setError("Impossible de charger la page du contrôle."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [metadataKey, contextKey, pageIndex, cursors, currentPageKey, filters, fees, amountFilter, arrearsFilter]);
  useEffect(() => { setSelectedYearId(""); setOption(""); }, [selectedSchoolId]);
  return { years, fees, classChoices, options, filters, amountFilter, filterKey, selectedYearId, setSelectedYearId, search, setSearch, status, setStatus, option, setOption,
    rows: pageKey === currentPageKey ? page.rows : [], loading: loading || (!metadataError && metadataKey !== contextKey), error: metadataError || error, pageIndex,
    hasNext: pageKey === currentPageKey && Boolean(page.nextCursor),
    previous: () => setPageIndex((value) => Math.max(0, value - 1)),
    next: () => { if (!page.nextCursor || pageKey !== currentPageKey) return; setCursors((value) => [...value.slice(0, pageIndex + 1), page.nextCursor]); setPageIndex((value) => value + 1); },
  };
}
