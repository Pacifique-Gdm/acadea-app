export declare const RELEASE_TYPES: Record<"correction" | "fonctionnalite" | "majeur", string>;
export declare function parseVersion(value: string): [number, number, number];
export declare function nextVersion(current: string, type: string): string;
export declare function compareVersions(left: string, right: string): number;
export declare function releaseTypeBetween(base: string, head: string): string | null;
export declare function changelogEntry(changelog: string, version: string): { title: string; changes: string[] } | null;
export declare function addChangelogEntry(changelog: string, entry: { version: string; type: string; date: string; changes: string[] }): string;
export declare function checkRelease(input: { baseVersion: string; headVersion: string; changelog: string }): { ok: boolean; type: string | null; problems: string[]; entry: { title: string; changes: string[] } | null };
