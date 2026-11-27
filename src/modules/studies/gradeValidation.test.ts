import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../services/auth", () => ({ getCurrentFirebaseIdToken: async () => "jeton" }));
vi.mock("../../config/apiUrl", () => ({ resolveApiUrl: (path: string) => path }));

import { loadGradeValidationStatus, validateGrades, validationLabel } from "./gradeValidation";

const portal = readFileSync(new URL("./StudyDirectorPortal.tsx", import.meta.url), "utf8");
const content = readFileSync(new URL("./GradeValidationContent.tsx", import.meta.url), "utf8");
const publication = readFileSync(new URL("./GradePublicationDrawer.tsx", import.meta.url), "utf8");
const bodyOf = (mock: ReturnType<typeof vi.fn>) => JSON.parse(String(((mock.mock.calls[0] as unknown[])[1] as RequestInit).body));

describe("lot P6 : validation des bulletins (écran)", () => {
  it("appels serveur : état de la classe, puis validation de ce qui a été vu (empreinte)", async () => {
    const statusFetch = vi.fn(async () => new Response(JSON.stringify({ required: false }), { status: 200 }));
    expect(await loadGradeValidationStatus("s", "y", "c", statusFetch as unknown as typeof fetch)).toEqual({ required: false });
    expect(bodyOf(statusFetch)).toEqual({ action: "grades-validation-status", schoolId: "s", schoolYearId: "y", classId: "c" });
    const validateFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, validated: true, validatedAt: "x" }), { status: 200 }));
    await validateGrades({ schoolId: "s", schoolYearId: "y", classId: "c", slot: "period_1", expectedFingerprint: "abc" }, validateFetch as unknown as typeof fetch);
    expect(bodyOf(validateFetch)).toEqual({ action: "grades-validation-validate", schoolId: "s", schoolYearId: "y", classId: "c", slot: "period_1", expectedFingerprint: "abc" });
  });

  it("erreur du serveur : message clair", async () => {
    const failing = vi.fn(async () => new Response(JSON.stringify({ error: "Réservé au Préfet d'études de cette section." }), { status: 403 }));
    await expect(loadGradeValidationStatus("s", "y", "c", failing as unknown as typeof fetch)).rejects.toThrow("Réservé au Préfet d'études de cette section.");
  });

  it("libellés de l'état", () => {
    expect(validationLabel({ validated: true, stale: false, fingerprint: "a" })).toBe("Validé");
    expect(validationLabel({ validated: false, stale: true, fingerprint: "a" })).toContain("à valider de nouveau");
    expect(validationLabel(undefined)).toBe("À valider");
  });

  it("Menu du Préfet : Enfants 3e, puis Validation des bulletins, puis Discipline", () => {
    const children = portal.indexOf("<StaffChildrenEntry school={school} />");
    const validation = portal.indexOf('{isPrefectOfStudies(user) && <button type="button" className={menuButton} onClick={() => setDrawer("grade-validation")}>');
    const discipline = portal.indexOf('setDrawer("prefect-discipline")');
    expect(children).toBeGreaterThan(0);
    expect(validation).toBe(children + "<StaffChildrenEntry school={school} />".length);
    expect(discipline).toBeGreaterThan(validation);
    expect(portal.match(/setDrawer\("grade-validation"\)/g)).toHaveLength(1);
  });

  it("drawer du Préfet seulement ; pas de bouton « Actualiser »", () => {
    expect(portal).toContain('{drawer === "grade-validation" && isPrefectOfStudies(user) && <AdminDrawer title="Validation des bulletins"');
    expect(content).not.toMatch(/>\s*Actualiser\s*</);
  });

  it("« Publication des cotes » : état et blocage affichés seulement si la validation est exigée (sinon inchangé)", () => {
    expect(publication).toContain("{options?.validations && <p role=\"status\"");
    expect(publication).toContain("Boolean(options.validations && !options.validations[slot]?.validated)");
  });
});
