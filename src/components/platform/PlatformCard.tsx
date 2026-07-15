import { BookOpen } from "lucide-react";

export function PlatformCard({
  label,
  value,
  icon: Icon,
  description,
  tone = "mint",
}: {
  label: string;
  value: string | number;
  icon: typeof BookOpen;
  description?: string;
  tone?: "mint" | "sky" | "violet" | "amber";
}) {
  const tones = {
    mint: "bg-mint/10 text-mint",
    sky: "bg-sky-50 text-sky-700",
    violet: "bg-violet-50 text-violet-700",
    amber: "bg-amber-50 text-amber-700",
  };
  return (
    <article className="min-w-0 max-w-full rounded border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded ${tones[tone]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <p className="break-words text-sm text-slate-500">{label}</p>
      <p className="mt-1 break-words text-2xl font-bold text-ink">{value}</p>
      {description && <p className="mt-2 break-words text-xs text-slate-500">{description}</p>}
    </article>
  );
}
