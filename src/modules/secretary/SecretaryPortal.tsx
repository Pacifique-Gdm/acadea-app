import { useState } from "react";
import type { ReactNode } from "react";
import { FileText, GraduationCap, Mail, Menu as MenuIcon } from "lucide-react";
import type { SecretaryTab } from "../../components/layout/SecretaryBottomNavigation";
import { SectionTitle } from "../../components/ui";

const tabContent: Record<Exclude<SecretaryTab, "students">, { title: string; description: string; icon: typeof Mail }> = {
  correspondence: { title: "Correspondance", description: "Courriers administratifs entrants et sortants.", icon: Mail },
  reports: { title: "Rapports", description: "Documents administratifs structurés de l'établissement.", icon: FileText },
  menu: { title: "Menu", description: "Listes, exports, profil et fonctions secondaires.", icon: MenuIcon },
};

export function SecretaryPortal({
  renderHeader,
  renderStudents,
  renderCorrespondence,
  renderReports,
  renderMenu,
  renderBottomNavigation,
}: {
  renderHeader: () => ReactNode;
  renderStudents?: () => ReactNode;
  renderCorrespondence?: () => ReactNode;
  renderReports?: () => ReactNode;
  renderMenu?: () => ReactNode;
  renderBottomNavigation: (activeTab: SecretaryTab, onTab: (tab: SecretaryTab) => void) => ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<SecretaryTab>("students");
  const section = activeTab === "students" ? undefined : tabContent[activeTab];
  const Icon = section?.icon ?? GraduationCap;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f6f8fb]">
      {renderHeader()}
      <main className="mx-auto w-full max-w-7xl min-w-0 flex-1 overflow-y-auto px-3 py-5 pb-28 sm:px-6 sm:pb-32 lg:px-8">
        {activeTab === "students" && (renderStudents?.() ?? <SectionTitle title="Élèves" subtitle="Gestion administrative des élèves." />)}
        {activeTab === "correspondence" && renderCorrespondence?.()}
        {activeTab === "reports" && renderReports?.()}
        {activeTab === "menu" && renderMenu?.()}
        {section && !(activeTab === "correspondence" && renderCorrespondence) && !(activeTab === "reports" && renderReports) && !(activeTab === "menu" && renderMenu) && (
          <section className="grid gap-4">
            <SectionTitle title={section.title} subtitle={section.description} />
            <div className="grid min-h-48 place-items-center rounded border border-slate-200 bg-white p-6 text-center shadow-sm">
              <div><Icon className="mx-auto mb-3 h-8 w-8 text-blue-600" /><p className="text-sm text-slate-500">Module prêt à recevoir ses fonctionnalités métier.</p></div>
            </div>
          </section>
        )}
      </main>
      {renderBottomNavigation(activeTab, setActiveTab)}
    </div>
  );
}
