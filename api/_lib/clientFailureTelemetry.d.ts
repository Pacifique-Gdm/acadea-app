export type ClientFailure = {
  operation: string;
  service: string;
  code: string;
  status: number | null;
  correlationId: string;
  durationMs: number;
  attempts: number;
};
export function validateClientFailure(input: unknown): ClientFailure | null;
export function allowClientFailure(uid: string, now?: number): boolean;
