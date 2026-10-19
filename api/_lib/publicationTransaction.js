import { GradingApiError } from "./teacherGrading.js";

// Every source query (including an empty result) is read by Firestore's
// read-write transaction, not by Query.get(). This protects predicate matches
// as well as existing documents; a returned-document updateTime check cannot.
// Bounds fail closed: never calculate a publication from a truncated query.
export function publicationReader(db, transaction) {
  let reads = 0;
  let documents = 0;
  let bytes = 0;
  const read = async (reference, query = false) => {
    if (++reads > 500) throw tooLarge();
    const snapshot = await transaction.get(query ? reference.limit(2001) : reference);
    const items = query ? snapshot.docs : snapshot.exists ? [snapshot] : [];
    if (query && items.length > 2000) throw tooLarge();
    documents += items.length;
    for (const item of items) bytes += Buffer.byteLength(JSON.stringify(item.data()), "utf8");
    if (documents > 5000 || bytes > 6 * 1024 * 1024) throw tooLarge();
    return snapshot;
  };
  const queryView = (query) => ({
    where: (...args) => queryView(query.where(...args)),
    get: () => read(query, true),
  });
  return {
    doc: (path) => ({ get: () => read(db.doc(path)) }),
    collection: (name) => queryView(db.collection(name)),
  };
}

const tooLarge = () => new GradingApiError(409, "failed-precondition", "Sources trop volumineuses pour une publication atomique. Contactez l’administrateur.");

export async function runPublicationTransaction(db, callback) {
  try {
    // Never silently publish recalculated criteria after a concurrent change.
    // A client retry with the SAME requestId remains idempotent.
    return await db.runTransaction(callback, { maxAttempts: 1 });
  } catch (error) {
    if ([4, 10, "aborted", "deadline-exceeded"].includes(error?.code)) {
      throw new GradingApiError(409, "publication-conflict", "Les données ont changé ou la publication a été interrompue. Réessayez la publication.");
    }
    throw error;
  }
}

export function validatePublicationWrites(records) {
  const sizes = records.map((record) => Buffer.byteLength(JSON.stringify(record), "utf8"));
  // Conservative application bounds, in addition to Firestore's actual
  // document/request/index limits (not an estimate of protobuf request size).
  if (records.length > 400 || sizes.some((size) => size > 512 * 1024)
    || sizes.reduce((sum, size) => sum + size, 0) > 4 * 1024 * 1024) throw tooLarge();
}
