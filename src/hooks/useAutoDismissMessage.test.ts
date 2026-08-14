import { afterEach, describe, expect, it, vi } from "vitest";
import { clearTemporaryMessageTimer, ERROR_MESSAGE_DURATION_MS, replaceTemporaryMessageTimer, SUCCESS_MESSAGE_DURATION_MS } from "./useAutoDismissMessage";

describe("temporisation centralisée des messages", () => {
  afterEach(() => vi.useRealTimers());

  it("masque succès et erreur après leurs délais respectifs", () => {
    vi.useFakeTimers();
    const success = vi.fn(), error = vi.fn();
    replaceTemporaryMessageTimer(undefined, success, SUCCESS_MESSAGE_DURATION_MS);
    replaceTemporaryMessageTimer(undefined, error, ERROR_MESSAGE_DURATION_MS);
    vi.advanceTimersByTime(SUCCESS_MESSAGE_DURATION_MS);
    expect(success).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
    vi.advanceTimersByTime(ERROR_MESSAGE_DURATION_MS - SUCCESS_MESSAGE_DURATION_MS);
    expect(error).toHaveBeenCalledOnce();
  });

  it("annule l'ancien délai lorsqu'un nouveau message le remplace", () => {
    vi.useFakeTimers();
    const oldDismiss = vi.fn(), newDismiss = vi.fn();
    let timer = replaceTemporaryMessageTimer(undefined, oldDismiss, SUCCESS_MESSAGE_DURATION_MS);
    vi.advanceTimersByTime(2000);
    timer = replaceTemporaryMessageTimer(timer, newDismiss, SUCCESS_MESSAGE_DURATION_MS);
    vi.advanceTimersByTime(2000);
    expect(oldDismiss).not.toHaveBeenCalled();
    expect(newDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    expect(newDismiss).toHaveBeenCalledOnce();
    clearTemporaryMessageTimer(timer);
  });

  it("nettoie le délai à la fermeture avant tout setState tardif", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    const timer = replaceTemporaryMessageTimer(undefined, dismiss, ERROR_MESSAGE_DURATION_MS);
    clearTemporaryMessageTimer(timer);
    vi.runAllTimers();
    expect(dismiss).not.toHaveBeenCalled();
  });
});
