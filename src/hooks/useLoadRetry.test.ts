import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { armLoadRetry, LOAD_RETRY_DELAYS_MS } from "./useLoadRetry";

describe("relance automatique des chargements", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("relance aussitôt au retour de la connexion", () => {
    const target = new EventTarget();
    const retry = vi.fn();
    const disarm = armLoadRetry({ target, retry, attempt: { current: 0 } });
    expect(retry).not.toHaveBeenCalled();
    target.dispatchEvent(new Event("online"));
    expect(retry).toHaveBeenCalledTimes(1);
    disarm();
    target.dispatchEvent(new Event("online"));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("refait trois essais espacés puis s'arrête (réseau faible sans coupure franche)", () => {
    const target = new EventTarget();
    const attempt = { current: 0 };
    const retry = vi.fn();
    for (const delay of LOAD_RETRY_DELAYS_MS) {
      const disarm = armLoadRetry({ target, retry, attempt });
      vi.advanceTimersByTime(delay - 1);
      const before = retry.mock.calls.length;
      vi.advanceTimersByTime(1);
      expect(retry.mock.calls.length).toBe(before + 1);
      disarm();
    }
    const disarm = armLoadRetry({ target, retry, attempt });
    vi.advanceTimersByTime(10 * 60_000);
    expect(retry).toHaveBeenCalledTimes(LOAD_RETRY_DELAYS_MS.length);
    // Le retour du réseau relance encore, et repart du premier délai.
    target.dispatchEvent(new Event("online"));
    expect(retry).toHaveBeenCalledTimes(LOAD_RETRY_DELAYS_MS.length + 1);
    expect(attempt.current).toBe(0);
    disarm();
  });

  it("ne relance rien une fois désarmé (chargement réussi ou écran fermé)", () => {
    const target = new EventTarget();
    const retry = vi.fn();
    armLoadRetry({ target, retry, attempt: { current: 0 } })();
    vi.advanceTimersByTime(10 * 60_000);
    target.dispatchEvent(new Event("online"));
    expect(retry).not.toHaveBeenCalled();
  });
});

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");

describe("les chargements en échec se relancent seuls", () => {
  it.each([
    ["modules/platform/useSchoolSearch.ts", "loadRetryToken"],
    ["hooks/useRealtimeCoordinations.ts", "[token]"],
    ["modules/studies/useStudyData.ts", "loadRetryToken"],
    ["modules/teacher/useTeacherPortalData.ts", "loadRetryToken"],
    ["hooks/useSchoolMessageRecipients.ts", "loadRetryToken"],
    ["modules/coordination/useCoordinationControlPage.ts", "loadRetryToken"],
  ])("%s relit les données au signal de relance", (path, token) => {
    const source = read(path);
    expect(source).toContain("useLoadRetry(");
    expect(source).toContain(token);
  });

  it("l'onglet Écoles du Super administrateur relance ses chargements", () => {
    const source = read("modules/platform/PlatformModule.tsx");
    expect(source).toContain("<ErrorNotice error={serverSearch.error} onRetry={serverSearch.retry} />");
    expect(source).toContain("<ErrorNotice error={allSchoolsError} onRetry={allSchoolsRetry.retry} />");
    expect(source).toMatch(/<ErrorNotice error=\{platformLoadError\} onRetry=\{platformRetry\.retry\} \/>/);
  });
});

describe("jamais de relance automatique d'un enregistrement d'argent", () => {
  /** États d'erreur des enregistrements d'argent : bouton « Réessayer » seulement. */
  const moneySaves: Array<[string, string[]]> = [
    ["modules/control/ControlModule.tsx", ["paymentError", "expenseError", "paymentEditError", "expenseEditError"]],
    ["components/finance/OtherCashInflowForm.tsx", ["error"]],
    ["components/finance/FormerStudentPaymentForm.tsx", ["error"]],
    ["components/personnel/PersonnelPaymentForm.tsx", ["error"]],
  ];
  it.each(moneySaves)("%s ne branche pas ses enregistrements sur la relance automatique", (path, states) => {
    const source = read(path);
    for (const state of states) {
      expect(source).not.toMatch(new RegExp(`useLoadRetry\\(Boolean\\(${state}\\)`));
      expect(source).not.toMatch(new RegExp(`\\b${state}Retry\\b`));
    }
  });

  it("le composant d'erreur ne relance un formulaire que sur un clic", () => {
    const source = read("components/ui/ErrorNotice.tsx");
    expect(source).not.toMatch(/addEventListener|"online"|setTimeout|setInterval/);
    expect(source).toMatch(/onClick=\{retry\}/);
  });
});
