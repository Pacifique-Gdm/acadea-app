import { randomBytes } from "node:crypto";

/** Only for new random resource IDs, never idempotency keys or historical IDs. */
export function randomId(prefix) {
  return `${prefix}-${randomBytes(16).toString("hex")}`;
}
