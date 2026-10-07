// Firestore rules inspect the coordination (and, for delegates, sub-coordination)
// relation for every school in an `in` query. Keep below the rules access-call
// budget, not merely the Firestore `in` operand limit of 30.
const PRINCIPAL_BATCH_SIZE = 6;
const DELEGATE_BATCH_SIZE = 3;
const MAX_CONCURRENT_BATCHES = 4;

export function coordinationSchoolBatches(schoolIds: readonly string[], isDelegate: boolean): string[][] {
  const uniqueIds = [...new Set(schoolIds)];
  const size = isDelegate ? DELEGATE_BATCH_SIZE : PRINCIPAL_BATCH_SIZE;
  return Array.from({ length: Math.ceil(uniqueIds.length / size) }, (_, index) => uniqueIds.slice(index * size, (index + 1) * size));
}

export async function mapCoordinationSchoolBatches<T>(schoolIds: readonly string[], isDelegate: boolean, load: (ids: string[]) => Promise<T>): Promise<T[]> {
  const batches = coordinationSchoolBatches(schoolIds, isDelegate);
  const results: T[] = new Array(batches.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_BATCHES, batches.length) }, async () => {
    while (next < batches.length) {
      const index = next++;
      results[index] = await load(batches[index]);
    }
  }));
  return results;
}
