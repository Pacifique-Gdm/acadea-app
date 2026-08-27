import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export type MobileBottomNavigationItem<T extends string> = {
  id: T;
  label: string;
  icon: LucideIcon;
};

export function MobileBottomNavigation<T extends string>({
  ariaLabel,
  items,
  activeId,
  onSelect,
  maxWidthClass = "max-w-4xl",
  trailingItem,
}: {
  ariaLabel: string;
  items: readonly MobileBottomNavigationItem<T>[];
  activeId: T;
  onSelect: (id: T) => void;
  maxWidthClass?: string;
  trailingItem?: ReactNode;
}) {
  const columnCount = items.length + (trailingItem ? 1 : 0);

  return (
    <nav aria-label={ariaLabel} className="mobile-bottom-navigation">
      <div
        className={`mobile-bottom-navigation__grid ${maxWidthClass}`}
        style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
      >
        {items.map((item) => {
          const Icon = item.icon;
          const active = activeId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              aria-current={active ? "page" : undefined}
              className={`mobile-bottom-navigation__item ${active ? "bg-blue-50 text-blue-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"}`}
            >
              <Icon className={`h-5 w-5 shrink-0 ${active ? "text-blue-700" : "text-slate-400"}`} />
              <span className="mobile-bottom-navigation__label">{item.label}</span>
            </button>
          );
        })}
        {trailingItem}
      </div>
    </nav>
  );
}
