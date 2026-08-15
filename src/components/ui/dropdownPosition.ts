export type FloatingDropdownPosition = { left: number; top: number; bottom?: number; width: number; maxHeight: number; placement: "above" | "below" };

export function calculateDropdownPosition(rect: Pick<DOMRect, "left" | "bottom" | "top" | "width">, viewportWidth: number, viewportHeight: number, gap = 4): FloatingDropdownPosition {
  const margin = 8;
  const minimumHeight = 120;
  const preferredHeight = Math.min(320, Math.max(minimumHeight, viewportHeight - margin * 2));
  const below = viewportHeight - rect.bottom - margin - gap;
  const above = rect.top - margin - gap;
  const openAbove = below < minimumHeight && above > below;
  const maxHeight = Math.max(72, Math.min(preferredHeight, openAbove ? above : below));
  const width = Math.min(Math.max(rect.width, 220), Math.max(0, viewportWidth - margin * 2));
  const left = Math.min(Math.max(margin, rect.left), Math.max(margin, viewportWidth - width - margin));
  const top = openAbove ? Math.max(margin, rect.top - gap - maxHeight) : Math.min(viewportHeight - margin - maxHeight, rect.bottom + gap);
  return { left, top, bottom: openAbove ? viewportHeight - rect.top + gap : undefined, width, maxHeight, placement: openAbove ? "above" : "below" };
}
