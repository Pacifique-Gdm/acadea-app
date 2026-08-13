import { useEffect, useRef } from "react";

export function useDismissibleDropdown<T extends HTMLElement = HTMLDivElement>(onDismiss: () => void) {
  const root = useRef<T>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      const rootElement = root.current;
      const siblingMenu = rootElement?.parentElement?.querySelector('[role="menu"]');
      if (!rootElement?.contains(target) && !siblingMenu?.contains(target)) dismissRef.current();
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") dismissRef.current(); };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, []);
  return root;
}
