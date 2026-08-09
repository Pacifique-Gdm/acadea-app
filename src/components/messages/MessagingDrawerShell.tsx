import type { ReactNode } from "react";
import { AdminDrawer } from "../ui";

export function MessagingDrawerShell({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <AdminDrawer title="Boîte à Messagerie" onClose={onClose} closeLabel="Fermer la boîte à messagerie">
      {children}
    </AdminDrawer>
  );
}
