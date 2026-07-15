import type { School } from "../../types";
import { SchoolLogo } from "./SchoolLogo";
import { StatusBadge } from "./StatusBadge";

export function SchoolSaasCard({
  school,
  selected,
  onSelect,
}: {
  school: School;
  selected?: boolean;
  onSelect: () => void;
}) {
  return (
    <article className={`min-w-0 max-w-full rounded border bg-white p-4 shadow-sm ${selected ? "border-ink ring-2 ring-ink/10" : "border-slate-200"}`}>
      <div className="flex min-w-0 items-center gap-3">
        <SchoolLogo school={school} />
        <div className="min-w-0 flex-1">
          <button onClick={onSelect} className="max-w-full break-words text-left font-bold text-ink underline decoration-slate-300 underline-offset-4 transition hover:text-sky-700">
            {school.name}
          </button>
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusBadge status={school.status} />
          </div>
        </div>
      </div>
    </article>
  );
}
