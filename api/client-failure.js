import { initAdmin } from "./_lib/firebaseAdmin.js";
import { allowClientFailure, validateClientFailure } from "./_lib/clientFailureTelemetry.js";

const MAX_BODY_BYTES = 2048;

async function readBody(req) {
  if (req.body !== undefined) {
    let raw;
    try { raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body); } catch { return null; }
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end();
  }
  const authorization = req.headers?.authorization ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token || token.length > 8192) {
    res.statusCode = 401;
    return res.end();
  }
  const event = validateClientFailure(await readBody(req));
  if (!event) {
    res.statusCode = 400;
    return res.end();
  }
  let auth;
  try { ({ auth } = initAdmin()); } catch {
    res.statusCode = 503;
    return res.end();
  }
  let actor;
  try { actor = await auth.verifyIdToken(token, true); } catch {
    res.statusCode = 401;
    return res.end();
  }
  try {
    if (!actor?.uid) {
      res.statusCode = 401;
      return res.end();
    }
    if (!allowClientFailure(actor.uid)) {
      res.statusCode = 429;
      return res.end();
    }
    // Only schema-validated metadata reaches Vercel logs. No account, school,
    // student, financial value, URL, token, message or file content is logged.
    console.warn("[Acadéa client-failure]", { at: new Date().toISOString(), ...event });
    res.statusCode = 204;
    return res.end();
  } catch {
    res.statusCode = 401;
    return res.end();
  }
}
