import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { AdminDrawer } from "../ui";

export function MessagingDrawerShell({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return createPortal(
    <AdminDrawer title="Boîte à Messagerie" onClose={onClose} closeLabel="Fermer la boîte à messagerie">
      {children}
    </AdminDrawer>,
    document.body,
  );
}
