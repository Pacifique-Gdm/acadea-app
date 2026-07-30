export interface AiGenerationLock { current: boolean }

export async function withAiGenerationLock<T>(lock: AiGenerationLock, setBusy: (busy: boolean) => void, operation: () => Promise<T>) {
  if (lock.current) return { started: false as const };
  lock.current = true;
  setBusy(true);
  try {
    return { started: true as const, value: await operation() };
  } finally {
    lock.current = false;
    setBusy(false);
  }
}
