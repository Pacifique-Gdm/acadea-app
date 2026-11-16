import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formerStudentsRefreshKey, isArchivedStudent, searchFormerStudentsLocally, visibleFormerStudents } from "../../utils/formerStudents";
import type { FormerStudentDebts } from "../../services/financialTransactions";
import type { Payment, Student } from "../../types";

const control = readFileSync(new URL("./ControlModule.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const form = readFileSync(new URL("../../components/finance/FormerStudentPaymentForm.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const debt = (remaining: number) => ({ schoolYearId: "y1", yearName: "2025-2026", studentId: "x", feeTypeId: "fee", feeName: "Minerval", expected: 100, paid: 100 - remaining, remaining, currency: "USD" as const });
const former = (id: string, name: string, remaining = 20): FormerStudentDebts => ({ id, matricule: `M-${id}`, className: "1ère Primaire", name, exitReason: "", debts: [debt(remaining)], totals: { USD: remaining, CDF: 0 } });
const yearStudent = (id: string, changes: Partial<Student> = {}) => ({ id, schoolId: "s", schoolYearId: "y2", matricule: id, nom: "N", postnom: "", prenom: id, sexe: "F", birthDate: "", address: "", phone: "", className: "1ère Primaire", status: "ACTIVE", ...changes }) as Student;

describe("lot 22 : « Enregistrer un paiement » ne propose plus les élèves archivés", () => {
  it("filtre la recherche et retire une sélection devenue archivée (écoute en temps réel)", () => {
    expect(control).toContain("yearData.students.filter((student) => !isArchivedStudent(student) && `${student.nom}");
    expect(control).toContain("selectedPaymentStudentRecord && !isArchivedStudent(selectedPaymentStudentRecord)");
    expect(control).toContain('if (selectedPaymentStudentArchived && !paymentSubmittingRef.current) { setStudentId(""); setPaymentStudentQuery(""); }');
  });
  it("reconnaît un élève archivé par statut ou par date d'archivage", () => {
    expect(isArchivedStudent({ status: "TRANSFERRED" })).toBe(true);
    expect(isArchivedStudent({ status: "ACTIVE", deletedAt: "2026-11-16" })).toBe(true);
    expect(isArchivedStudent({ status: "ACTIVE" })).toBe(false);
    expect(isArchivedStudent({})).toBe(false);
  });
});

describe("lot 22 : « Paiement anciens élèves » cherche comme « Enregistrer un paiement »", () => {
  it("n'a plus de notice ni de bouton « Rechercher » ; les résultats apparaissent pendant la saisie", () => {
    expect(form).not.toContain("Seuls les élèves archivés");
    expect(form).not.toContain(">Rechercher<");
    expect(form).toContain('placeholder="Rechercher par nom, postnom, prénom ou matricule"');
    const list = [former("a", "Kabila Mbuyi Anne"), former("b", "Tshisekedi Lukusa Paul"), ...Array.from({ length: 10 }, (_, i) => former(`k${i}`, `Kabamba ${i}`))];
    expect(searchFormerStudentsLocally(list, "kab").map((item) => item.id)).toHaveLength(8);
    expect(searchFormerStudentsLocally(list, "M-b").map((item) => item.id)).toEqual(["b"]);
    expect(searchFormerStudentsLocally(list, "  ")).toEqual([]);
  });
  it("un élève soldé ou réactivé disparaît aussitôt de la liste", () => {
    const list = [former("paid", "Soldé", 0), former("back", "Réactivé"), former("still", "Toujours archivé")];
    const yearStudents = [yearStudent("back", { status: "ACTIVE" }), yearStudent("still", { status: "TRANSFERRED", deletedAt: "2026-11-16" })];
    expect(visibleFormerStudents(list, yearStudents).map((item) => item.id)).toEqual(["still"]);
  });
  it("relit la liste quand un élève de l'année est archivé, réactivé, ou paie", () => {
    const base = [yearStudent("a")];
    const key = formerStudentsRefreshKey(base, []);
    const archived = [yearStudent("a", { status: "TRANSFERRED" })];
    expect(formerStudentsRefreshKey(archived, [])).not.toBe(key);
    expect(formerStudentsRefreshKey(archived, [{ id: "p", studentId: "a", amount: 5 } as Payment])).not.toBe(formerStudentsRefreshKey(archived, []));
    expect(formerStudentsRefreshKey(base, [{ id: "p", studentId: "a", amount: 5 } as Payment])).toBe(key);
    expect(form).toContain("[year.id, refreshKey, reload]");
  });
});
