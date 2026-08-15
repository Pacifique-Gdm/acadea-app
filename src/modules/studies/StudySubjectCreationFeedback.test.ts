import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { replaceStudySubjectFeedbackTimer, STUDY_SUBJECT_FEEDBACK_DURATION_MS } from "./studySubjectFeedback";

const source = readFileSync("src/modules/studies/StudyTeachersModule.tsx", "utf8");

describe("Ajout local d’un cours", () => {
  afterEach(() => vi.useRealTimers());

  it("rend l’action pleine largeur avec un état pressé accessible au tactile", () => {
    expect(source).toContain("secondary-button w-full justify-center active:translate-y-px active:scale-[0.99] motion-reduce:transform-none");
    expect(source).toContain('disabled={busy || !newSubject.trim()}');
    expect(source).toContain('busy ? "Ajout en cours…" : "Ajouter un cours"');
  });

  it("n’affiche le succès local qu’après la résolution du service", () => {
    expect(source.indexOf("await createStudySubject")).toBeLessThan(source.indexOf('showSubjectFeedback("success"'));
    expect(source).toContain('showSubjectFeedback("error", "Impossible d’ajouter ce cours.")');
    expect(source).toContain('subjectFeedback.type === "error" ? "alert" : "status"');
  });

  it("bloque une double soumission et conserve la saisie en cas d’erreur", () => {
    expect(source).toContain("if (busy || !newSubject.trim()) return;");
    expect(source.indexOf('setNewSubject("")')).toBeGreaterThan(source.indexOf("await createStudySubject"));
    const submitStart = source.indexOf("async function submitSubject");
    const catchBlock = source.slice(source.indexOf("catch (cause)", submitStart), source.indexOf("finally { setBusy(false); }", submitStart));
    expect(catchBlock).not.toContain("setNewSubject");
  });

  it("remplace l’ancien timer et efface uniquement le feedback courant après quatre secondes", () => {
    vi.useFakeTimers();
    const stale = vi.fn();
    const current = vi.fn();
    const staleTimer = replaceStudySubjectFeedbackTimer(undefined, stale);
    replaceStudySubjectFeedbackTimer(staleTimer, current);
    vi.advanceTimersByTime(STUDY_SUBJECT_FEEDBACK_DURATION_MS);
    expect(stale).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledOnce();
  });

  it("nettoie le timer au démontage", () => {
    expect(source).toContain("useEffect(() => () => {");
    expect(source).toContain("clearTimeout(subjectFeedbackTimer.current)");
  });
});
