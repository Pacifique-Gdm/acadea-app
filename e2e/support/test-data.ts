export function uniqueTestId(label: string) {
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  return `e2e-${suffix}-${label}`.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
}

export class TestDataCleanup {
  private readonly ownedIds = new Set<string>();
  private readonly cleanups: Array<() => Promise<void>> = [];

  own(id: string, cleanup: () => Promise<void>) {
    if (!id.startsWith("e2e-")) throw new Error(`Nettoyage refusé pour une donnée non E2E : ${id}`);
    this.ownedIds.add(id);
    this.cleanups.unshift(cleanup);
  }

  async run() {
    for (const cleanup of this.cleanups) await cleanup();
    this.cleanups.length = 0;
    this.ownedIds.clear();
  }
}
