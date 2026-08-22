import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";

export function AdminDrawer({
  title,
  children,
  onClose,
  closeLabel,
  width = "default",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  closeLabel: string;
  width?: "default" | "wide";
}) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusableElements = drawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusableElements || focusableElements.length === 0) return;
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      previousActiveElement?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-ink/30 p-3 backdrop-blur-sm" onMouseDown={onClose} role="presentation">
      <div
        ref={drawerRef}
        className={`box-border ml-auto flex h-full min-h-0 w-full min-w-0 max-w-[calc(100vw-1.5rem)] flex-col rounded border border-slate-200 bg-white p-4 shadow-2xl ${width === "wide" ? "sm:max-w-3xl xl:max-w-4xl" : "sm:max-w-xl"}`}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="mb-4 flex min-w-0 items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <h2 id={titleId} className="min-w-0 break-words text-lg font-bold text-ink">{title}</h2>
          <button ref={closeButtonRef} onClick={onClose} className="rounded bg-slate-100 p-2 text-slate-700" aria-label={closeLabel} type="button">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto pr-1 scrollbar-thin">{children}</div>
      </div>
    </div>
  );
}
