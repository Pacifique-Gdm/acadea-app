export function manageCoordinationAdministrator(input: {
  auth: unknown;
  db: unknown;
  caller: { uid: string; role: string };
  input: Record<string, unknown>;
  coordination: { id: string; status: string };
  now: string;
}): Promise<Record<string, unknown>>;
