import { auth, firebaseConfig } from "../firebase";

type Value = { nullValue: null } | { booleanValue: boolean } | { stringValue: string }
  | { integerValue: string } | { doubleValue: number }
  | { arrayValue: { values: Value[] } } | { mapValue: { fields: Record<string, Value> } };

export function firestoreValue(value: unknown): Value {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number" && Number.isFinite(value)) return Number.isSafeInteger(value)
    ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, firestoreValue(item)])) } };
  }
  throw new Error("Valeur Firestore non prise en charge. Enregistrement interrompu.");
}

/** REST preconditions preserve rules (Firebase ID token), without requiring read access to a new document. */
export async function conditionalFirestoreWrite(collection: string, id: string, value: object, exists: boolean) {
  const user = auth?.currentUser;
  if (!user) throw new Error("Connexion requise pour enregistrer.");
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(collection) || !id || id.includes("/")) throw new Error("Chemin Firestore invalide.");
  const token = await user.getIdToken();
  if (auth?.currentUser?.uid !== user.uid) throw new Error("La session a changé. Enregistrement interrompu.");
  const local = import.meta.env.VITE_LOCAL_EMULATORS === "true" && typeof window !== "undefined"
    && ["127.0.0.1", "localhost"].includes(window.location.hostname);
  const origin = local ? "http://127.0.0.1:8080" : "https://firestore.googleapis.com";
  const database = `projects/${firebaseConfig.projectId}/databases/(default)`;
  const encoded = firestoreValue(value);
  if (!("mapValue" in encoded)) throw new Error("Document invalide.");
  const response = await fetch(`${origin}/v1/${database}/documents:commit`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ writes: [{ update: { name: `${database}/documents/${collection}/${id}`, fields: encoded.mapValue.fields }, currentDocument: { exists } }] }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const code = payload?.error?.status;
    throw Object.assign(new Error(code === "ALREADY_EXISTS" ? "Cet identifiant est déjà utilisé. Aucun document existant n'a été remplacé."
      : code === "NOT_FOUND" ? "Le document à modifier n'existe plus."
      : "Enregistrement refusé ou indisponible. Les données n'ont pas été confirmées."), { code: code ?? "unavailable" });
  }
}
