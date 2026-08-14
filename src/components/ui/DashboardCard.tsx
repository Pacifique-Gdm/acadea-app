import type { ComponentType, ReactNode } from "react";

export function DashboardCard({ title, icon: Icon, tone = "bg-blue-50 text-blue-700", value, children }: { title: string; icon: ComponentType<{ className?: string }>; tone?: string; value?: ReactNode; children?: ReactNode }) {
  return <article className="min-w-0 rounded border border-slate-200 bg-white p-4 shadow-sm">
    <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded ${tone}`} aria-hidden="true"><Icon className="h-5 w-5" /></div>
    <h2 className="text-sm font-semibold text-slate-500">{title}</h2>
    {value !== undefined && <p className="mt-1 break-words text-2xl font-bold text-ink">{value}</p>}
    {children && <div className="mt-3 min-w-0">{children}</div>}
  </article>;
}
