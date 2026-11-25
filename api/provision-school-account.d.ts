declare function handler(request: unknown, response: unknown): Promise<void>;
export function normalizeSectionIds(value: unknown): string[];
export function normalizeServiceJobTitle(jobTitle: unknown, otherJobTitle?: unknown): string;
export function createServicePersonnel(input: { db: unknown; caller: unknown; body: unknown }): Promise<unknown>;
export const STUDY_FUNCTIONS: Set<string>;
export function assertStudyDirectorSections(directorProfile: { role?: unknown; section?: unknown; sectionIds?: unknown } | undefined, sectionIds: string[], currentSectionIds?: string[]): void;
export default handler;
