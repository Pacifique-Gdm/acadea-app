import type { Correspondence, SecretaryReport, SecretaryReportType } from "./secretaryTypes";

export function normalizeSecretarySearch(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("fr");
}

export function matchesReportSearch(report: SecretaryReport, query: string, typeLabel: string) {
  const needle = normalizeSecretarySearch(query);
  if (!needle) return true;
  const values = [
    report.reportNumber, report.title, typeLabel, report.documentDate, report.startTime, report.endTime,
    report.authorName, ...Object.values(report.structuredContent ?? {}), ...(report.signatories ?? []).map((item) => item.name),
  ];
  return normalizeSecretarySearch(values.join(" ")).includes(needle);
}

export function filterSecretaryReports(reports: SecretaryReport[], query: string, type: "all" | SecretaryReportType, typeLabels: Record<SecretaryReportType, string>) {
  return reports.filter((report) => (type === "all" || report.type === type) && matchesReportSearch(report, query, typeLabels[report.type]));
}

export function matchesCorrespondenceSearch(item: Correspondence, query: string) {
  const needle = normalizeSecretarySearch(query);
  if (!needle) return true;
  return normalizeSecretarySearch([
    item.referenceNumber, item.date, item.subject, item.sender, item.recipient, item.content,
    item.outgoing?.recipient.institution, item.outgoing?.authorName, ...(item.outgoing?.keywords ?? []),
  ].join(" ")).includes(needle);
}
