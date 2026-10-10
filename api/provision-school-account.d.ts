declare function handler(request: unknown, response: unknown): Promise<void>;
export function normalizeSectionIds(value: unknown): string[];
export function normalizeServiceJobTitle(jobTitle: unknown, otherJobTitle?: unknown): string;
export function createServicePersonnel(input: { db: unknown; caller: unknown; body: unknown }): Promise<unknown>;
export default handler;
