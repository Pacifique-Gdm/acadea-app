export const RATE_LIMIT_MESSAGE = "Trop de tentatives. Veuillez patienter quelques instants avant de réessayer.";

export function apiErrorMessage(status: number, payload: { error?: string; code?: string }, fallback: string) {
  return status === 429 || payload.code === "resource-exhausted" ? RATE_LIMIT_MESSAGE : payload.error ?? fallback;
}
