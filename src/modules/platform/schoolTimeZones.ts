import { rawTimeZones } from "@vvo/tzdb";
import { validSchoolTimeZone } from "./schoolInformation";

export type SchoolTimeZoneOption = {
  value: string;
  city: string;
  country: string;
  offset: string;
  label: string;
  searchText: string;
};

const priorityZones = ["Africa/Kinshasa", "Africa/Lubumbashi"];

export function formatIndicativeUtcOffset(timeZone: string, at: Date): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
    .formatToParts(at).find((item) => item.type === "timeZoneName")?.value ?? "GMT";
  const match = /^(?:GMT|UTC)([+-])(\d{1,2})(?::(\d{2}))?$/.exec(part);
  if (!match) return "UTC+00:00";
  return `UTC${match[1]}${match[2].padStart(2, "0")}:${match[3] ?? "00"}`;
}

function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");
}

export function schoolTimeZoneOptions(at = new Date()): SchoolTimeZoneOption[] {
  const countries = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames("fr", { type: "region" }) : null;
  const options = new Map<string, SchoolTimeZoneOption>();
  for (const zone of rawTimeZones) {
    const country = zone.countryCode === "CD"
      ? "République démocratique du Congo (RDC)"
      : countries?.of(zone.countryCode) ?? zone.countryName;
    for (const value of zone.group) {
      if (options.has(value) || !validSchoolTimeZone(value)) continue;
      const city = value.split("/").at(-1)!.replace(/_/g, " ");
      const offset = formatIndicativeUtcOffset(value, at);
      const label = `${city} — ${country} — ${offset}`;
      options.set(value, { value, city, country, offset, label, searchText: normalizeSearch(`${city} ${country} ${zone.countryName} ${value}`) });
    }
  }
  const collator = new Intl.Collator("fr", { sensitivity: "base" });
  return [...options.values()].sort((a, b) => {
    const aPriority = priorityZones.indexOf(a.value);
    const bPriority = priorityZones.indexOf(b.value);
    if (aPriority !== -1 || bPriority !== -1) return (aPriority === -1 ? priorityZones.length : aPriority) - (bPriority === -1 ? priorityZones.length : bPriority);
    return collator.compare(a.country, b.country) || collator.compare(a.city, b.city);
  });
}

export function filterSchoolTimeZones(options: SchoolTimeZoneOption[], query: string): SchoolTimeZoneOption[] {
  const terms = normalizeSearch(query.trim()).split(/\s+/).filter(Boolean);
  return terms.length ? options.filter((option) => terms.every((term) => option.searchText.includes(term))) : options;
}
