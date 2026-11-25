import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { hasNewStaffPayment, publishStaffPaymentNotificationIds, readStaffPaymentNotificationIds, staffPaymentNotificationIds, subscribeStaffPaymentNotificationIds } from "../../services/staffChildren";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const order = (source: string, marks: string[]) => marks.map((mark) => { const index = source.indexOf(mark); expect(index, mark).toBeGreaterThanOrEqual(0); return index; });
const increasing = (values: number[]) => values.every((value, index) => index === 0 || value > values[index - 1]);

describe("« Enfants » : pas de rechargement à chaque accès (comme l'Année scolaire)", () => {
  it("la réponse est gardée pendant la session et réutilisée à la réouverture", () => {
    const screen = read("src/components/personnel/StaffChildrenContent.tsx");
    expect(screen).toContain("const staffChildrenCache = createLoadCache<StaffChildrenCacheEntry>(10);");
    expect(screen).toContain("if (cached && !newPayment) { setData(cached.result); setLoading(false); setError(\"\"); return undefined; }");
    // Pendant une relecture, les données déjà affichées restent visibles.
    expect(screen).toContain("{loading && !data && <BlockSkeleton");
    expect(screen).toContain("}, [cacheKey, paymentSignal, refreshCount]);");
    expect(screen).toContain("data-staff-children-refresh");
  });

  it("seul un nouveau paiement (nouvelle notification « Paiement enregistré ») demande une relecture", () => {
    expect(hasNewStaffPayment([], "")).toBe(false);
    expect(hasNewStaffPayment(["n1", "n2"], "n1|n2")).toBe(false);
    expect(hasNewStaffPayment(["n1"], "n1|n2")).toBe(true);
    // Une notification qui disparaît de la liste (lue, ancienne) ne relance rien.
    expect(hasNewStaffPayment(["n1", "n2"], "n2")).toBe(false);
  });

  it("le signal ne garde que les notifications de paiement de ce membre du personnel", () => {
    const notifications = [
      { id: "b", recipientUserId: "t1", type: "payment", event: "payment_recorded" },
      { id: "a", recipientUserId: "t1", type: "payment", event: "payment_recorded" },
      { id: "c", recipientUserId: "t2", type: "payment", event: "payment_recorded" },
      { id: "d", recipientUserId: "t1", type: "message" },
      { id: "e", parentId: "p1", type: "payment", event: "payment_recorded" },
    ];
    expect(staffPaymentNotificationIds(notifications, "t1")).toEqual(["a", "b"]);
    expect(staffPaymentNotificationIds(undefined, "t1")).toEqual([]);
  });

  it("aucune actualisation en boucle : publier la même liste ne prévient personne", () => {
    const listener = vi.fn();
    const stop = subscribeStaffPaymentNotificationIds(listener);
    publishStaffPaymentNotificationIds(["x1"]);
    publishStaffPaymentNotificationIds(["x1"]);
    publishStaffPaymentNotificationIds(["x1"]);
    expect(listener).toHaveBeenCalledTimes(1);
    publishStaffPaymentNotificationIds(["x1", "x2"]);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(readStaffPaymentNotificationIds()).toBe("x1|x2");
    // Une notification lue qui sort de la liste des non lues ne relance rien.
    publishStaffPaymentNotificationIds(["x2"]);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    publishStaffPaymentNotificationIds(["x3"]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("l'écoute des notifications non lues, déjà active, publie aussi le signal (aucune lecture en plus)", () => {
    expect(read("src/hooks/usePaginatedNotifications.ts")).toContain("publishStaffPaymentNotificationIds(staffPaymentNotificationIds(unread, user.id));");
  });

  it("l'application publie le signal depuis les notifications déjà reçues en direct (aucune lecture en plus)", () => {
    expect(read("src/App.tsx")).toContain('useEffect(() => { publishStaffPaymentNotificationIds(staffPaymentNotificationIds(data.notifications, user?.id ?? "")); }, [data.notifications, user?.id]);');
  });
});

describe("Menu : « Enfants » est le 3e bouton de la liste", () => {
  it("administrateur : Emploi du temps, Salaire/Prime, Enfants, puis Répartition et les autres", () => {
    const app = read("src/App.tsx");
    const adminMenu = app.slice(app.indexOf('{!standaloneAdminRoute && activeTab === "menu" && ('));
    expect(increasing(order(adminMenu, ["<PublishedTimetableDrawerEntry", "<MenuModule"]))).toBe(true);
    expect(app).toContain('renderStaffChildren={() => <>{user.role === "school_admin" && <StaffChildrenEntry school={school} />}</>}');
    const menu = read("src/modules/menu/MenuModule.tsx");
    expect(menu).toContain("      <OwnPayrollEntry user={user} school={school} />\n      {renderStaffChildren?.()}\n      <FeeAllocationEntry user={user} schools={[school]} />\n      {visibleMenuSections");
  });

  it("secrétaire : Salaire/Prime, Emploi du temps, Enfants, puis Valves et les autres", () => {
    const menu = read("src/modules/secretary/SecretaryMenuModule.tsx");
    expect(increasing(order(menu, ["<OwnPayrollEntry", "{renderPublishedTimetable?.()}", "{renderStaffChildren?.()}", ">Valves</span>"]))).toBe(true);
    expect(menu).toContain("      {renderPublishedTimetable?.()}\n      {renderStaffChildren?.()}\n");
    expect(read("src/App.tsx")).toContain('renderStaffChildren={() => <StaffChildrenEntry school={school} />}');
  });

  it("direction des études : Assistant IA, Salaire/Prime, Enfants, puis Répartition", () => {
    const portal = read("src/modules/studies/StudyDirectorPortal.tsx");
    expect(portal).toContain("<StudyAiAssistant user={user} school={school} year={year} data={data} /><OwnPayrollEntry user={user} school={school} /><StaffChildrenEntry school={school} /><FeeAllocationEntry user={user} schools={[school]} />");
  });

  it("enseignant, caissier et discipline : « Enfants » reste un onglet (pas dans le Menu)", () => {
    expect(read("src/modules/teacher/TeacherPortal.tsx")).not.toContain("<StaffChildrenEntry");
    expect(read("src/modules/discipline/DisciplinePortal.tsx")).not.toContain("<StaffChildrenEntry");
    expect(read("src/modules/menu/MenuModule.tsx")).not.toContain("<StaffChildrenEntry");
  });
});
