import type { School } from "../../types";

function buildAcronym(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("");
}

export function SchoolLogo({ school }: { school: School }) {
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-200 bg-slate-50 text-sm font-bold text-ink">
      {school.logoUrl ? <img src={school.logoUrl} alt="" className="h-full w-full object-cover" /> : school.acronym ?? buildAcronym(school.name)}
    </div>
  );
}
