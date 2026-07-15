import type { ReactNode } from "react";

export function FormPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className="min-w-0 max-w-full rounded border border-slate-200 bg-white p-4 shadow-sm">
      {title && <h2 className="mb-3 break-words text-lg font-bold text-ink">{title}</h2>}
      <div className="grid min-w-0 gap-3">{children}</div>
    </aside>
  );
}
