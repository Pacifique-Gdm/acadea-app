import { FieldPath } from "firebase-admin/firestore";
import { allocationFail } from "./feeAllocationRuntime.js";

/** Exhaust a query with snapshot cursors inside the caller's transaction.
 * The page size is a transport bound, never a business-data cutoff. Nothing is
 * returned to the caller until the terminal page has been read successfully.
 * A failed page aborts the whole operation (including any financial writes).
 */
export async function readAllocationPages(query, transaction, pageSize = 200) {
  if (!transaction?.get || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) {
    allocationFail("Lecture paginée sans transaction ou taille invalide.");
  }
  const ordered = query.orderBy(FieldPath.documentId());
  const docs = [], seen = new Set();
  let cursor;
  for (;;) {
    const page = await transaction.get((cursor ? ordered.startAfter(cursor) : ordered).limit(pageSize));
    if (!Array.isArray(page.docs) || page.docs.length > pageSize) allocationFail("Page de registre invalide.");
    for (const doc of page.docs) {
      if (!doc.id || seen.has(doc.id)) allocationFail("Pagination incohérente : document répété.");
      seen.add(doc.id); docs.push(doc);
    }
    if (page.docs.length < pageSize) return { docs };
    cursor = page.docs.at(-1);
  }
}
