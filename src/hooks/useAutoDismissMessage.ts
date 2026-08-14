import { useEffect, useRef } from "react";

export const SUCCESS_MESSAGE_DURATION_MS = 3500;
export const ERROR_MESSAGE_DURATION_MS = 5000;

export function replaceTemporaryMessageTimer(
  currentTimer: ReturnType<typeof setTimeout> | undefined,
  clearMessage: () => void,
  duration: number,
) {
  if (currentTimer !== undefined) clearTimeout(currentTimer);
  return setTimeout(clearMessage, duration);
}

export function clearTemporaryMessageTimer(timer: ReturnType<typeof setTimeout> | undefined) {
  if (timer !== undefined) clearTimeout(timer);
}

export function useAutoDismissMessage(message: string, onDismiss: () => void, duration: number) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!message) return undefined;
    const timer = replaceTemporaryMessageTimer(undefined, () => dismissRef.current(), duration);
    return () => clearTemporaryMessageTimer(timer);
  }, [duration, message]);
}
