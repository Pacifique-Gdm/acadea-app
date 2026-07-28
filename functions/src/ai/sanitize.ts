const SENSITIVE_PATTERNS: Array<{ code: string; expression: RegExp; replacement: string }> = [
  { code: "password", expression: /\b(mot\s*de\s*passe|password|pwd)\s*[:=]\s*\S+/gi, replacement: "$1: [MASQUÉ]" },
  { code: "api_key", expression: /\b(api[_ -]?key|secret|token|bearer)\s*[:=]\s*[A-Za-z0-9_.-]{8,}/gi, replacement: "$1: [MASQUÉ]" },
  { code: "private_url", expression: /https?:\/\/(?:localhost|127\.0\.0\.1|[^\s/]+\.internal)\S*/gi, replacement: "[URL PRIVÉE MASQUÉE]" },
  { code: "medical", expression: /\b(diagnostic|groupe sanguin|traitement médical|maladie chronique|allergie médicale)\s*[:=]\s*[^\n]+/gi, replacement: "$1: [DONNÉE MÉDICALE MASQUÉE]" },
  { code: "financial", expression: /\b(numéro de carte|compte bancaire|iban|solde bancaire)\s*[:=]\s*[^\n]+/gi, replacement: "$1: [DONNÉE FINANCIÈRE MASQUÉE]" },
];

export function sanitizeAiText(value: string) {
  const detected: string[] = [];
  let sanitized = value;
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.expression.test(sanitized)) detected.push(pattern.code);
    pattern.expression.lastIndex = 0;
    sanitized = sanitized.replace(pattern.expression, pattern.replacement);
  }
  return { sanitized, detected: [...new Set(detected)] };
}

export function sanitizeAiContext(value: unknown): unknown {
  if (typeof value === "string") return sanitizeAiText(value).sanitized;
  if (Array.isArray(value)) return value.slice(0, 50).map(sanitizeAiContext);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !/password|token|secret|api.?key|medical|payment|attachment|url/i.test(key)).slice(0, 50).map(([key, item]) => [key, sanitizeAiContext(item)]));
  return value;
}
