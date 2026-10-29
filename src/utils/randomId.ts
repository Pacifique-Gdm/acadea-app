/** Only for new random resource IDs. Fail closed if secure randomness is unavailable. */
export function randomId(prefix: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `${prefix}-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
