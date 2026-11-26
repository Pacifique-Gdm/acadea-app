import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { hasNewStaffPayment, publishStaffPaymentNotificationIds, readStaffChildrenRefresh, readStaffPaymentNotificationIds, requestStaffChildrenRefresh, staffPaymentNotificationIds, subscribeStaffChildrenRefresh, subscribeStaffPaymentNotificationIds } from "../../services/staffChildren";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const order = (source: string, marks: string[]) => marks.map((mark) => { const index = source.indexOf(mark); expect(index, mark).toBeGreaterThanOrEqual(0); return index; });
const increasing = (values: number[]) => values.every((value, index) => index === 0 || value > values[index - 1]);

describe("« Enfants » : pas de rechargement à chaque accès (comme l'Année scolaire)", () => {
  it("la réponse est gardée pendant la session et réutilisée à la réouverture", () => {
    const screen = read("src/components/personnel/StaffChildrenContent.tsx");
    expect(screen).toContain("const staffChildrenCache = createLoadCache<StaffChildrenCacheEntry>(10);");
    expect(screen).toContain("if (cached && !newPayment && !refreshAsked) { setData(cached.result); setLoading(false); setError(\"\"); return undefined; }");
    // Pendant une relecture, les données déjà affichées restent visibles.
    expect(screen).toContain("{loading && !data && <BlockSkeleton");
    expect(screen).toContain("}, [cacheKey, paymentSignal, headerRefresh]);");
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
    // Toujours 3e, même quand « Répartition » est partagée : elle vient après « Enfants ».
    expect(increasing(order(menu, ["{renderStaffChildren?.()}", "<FeeAllocationEntry user={user} schools={[school]} />"]))).toBe(true);
    expect(read("src/App.tsx")).toContain('renderStaffChildren={() => <StaffChildrenEntry school={school} />}');
  });

  // Accord de l'utilisateur (26/11/2026) : Directeur des études = Enfants 3e puis Répartition ;
  // Préfet d'études = Enfants 3e puis Discipline (bouton affiché pour le Préfet seulement).
  it("direction des études : Assistant IA, Salaire/Prime, Enfants, puis Répartition (Préfet : Enfants, puis Discipline)", () => {
    const portal = read("src/modules/studies/StudyDirectorPortal.tsx");
    expect(portal).toContain("<StudyAiAssistant user={user} school={school} year={year} data={data} /><OwnPayrollEntry user={user} school={school} /><StaffChildrenEntry school={school} />{isPrefectOfStudies(user) && <button type=\"button\" className={menuButton} onClick={() => setDrawer(\"prefect-discipline\")}><ShieldAlert className=\"h-5 w-5 shrink-0\"/><strong>Discipline</strong></button>}<FeeAllocationEntry user={user} schools={[school]} />");
  });

  it("enseignant, caissier et discipline : « Enfants » reste un onglet (pas dans le Menu)", () => {
    expect(read("src/modules/teacher/TeacherPortal.tsx")).not.toContain("<StaffChildrenEntry");
    expect(read("src/modules/discipline/DisciplinePortal.tsx")).not.toContain("<StaffChildrenEntry");
    expect(read("src/modules/menu/MenuModule.tsx")).not.toContain("<StaffChildrenEntry");
  });
});

describe("« Enfants » sans bande du haut ; la flèche de l'en-tête suffit", () => {
  it("plus de titre, de phrase ni de bouton « Actualiser » : seulement les cartes ou le message", () => {
    const screen = read("src/components/personnel/StaffChildrenContent.tsx");
    expect(screen).not.toContain("<h1");
    expect(screen).not.toContain("Enfants à votre charge inscrits dans cet établissement");
    expect(screen).not.toContain("data-staff-children-refresh");
    expect(screen).not.toContain("RefreshCw");
    expect(screen).toContain("{STAFF_NO_CHILDREN_MESSAGE}");
  });

  it("la flèche « Actualiser » de l'en-tête demande une relecture de « Enfants »", () => {
    expect(read("src/components/layout/Header.tsx")).toContain("if (refreshed !== false) { setManualRefreshToken((value) => value + 1); requestStaffChildrenRefresh(); }");
    const listener = vi.fn();
    const stop = subscribeStaffChildrenRefresh(listener);
    const before = readStaffChildrenRefresh();
    requestStaffChildrenRefresh();
    expect(readStaffChildrenRefresh()).toBe(before + 1);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });
});
