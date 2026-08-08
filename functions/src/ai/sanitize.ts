const SENSITIVE_PATTERNS: Array<{ code: string; expression: RegExp; replacement: string }> = [
  { code: "password", expression: /\b(mot\s*de\s*passe|password|pwd)\s*[:=]\s*\S+/gi, replacement: "$1: [MASQUÉ]" },
  { code: "api_key", expression: /\b(api[_ -]?key|secret|token|bearer|clé\s+firebase)\s*[:=]\s*[^\s,;]+/gi, replacement: "$1: [MASQUÉ]" },
  { code: "email", expression: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: "[EMAIL]" },
  { code: "phone", expression: /(?<!\w)(?!\d{4}-\d{2}-\d{2}\b)(?:\+?\d[\d .()-]{7,}\d)(?!\w)/g, replacement: "[TÉLÉPHONE]" },
  { code: "matricule", expression: /\b(matricule|numéro\s+d['’]élève)\s*[:=]\s*[^\s,;]+/gi, replacement: "$1: [MATRICULE]" },
  { code: "uid", expression: /\b(uid|firebase\s*uid|user\s*id|school\s*id|schoolyear\s*id|document\s*id)\s*[:=]\s*[^\s,;]+/gi, replacement: "$1: [IDENTIFIANT]" },
  { code: "address", expression: /\b(adresse|domicile)\s*[:=]\s*[^\n]+/gi, replacement: "$1: [ADRESSE]" },
  { code: "birth_date", expression: /\b(date\s+de\s+naissance|né(?:e)?\s+le)\s*[:=]?\s*[^\n,;]+/gi, replacement: "$1: [DATE DE NAISSANCE]" },
  { code: "student_identity", expression: /(élève)\s*[:=]\s*[^\n,;]+/gi, replacement: "$1: [ÉLÈVE]" },
  { code: "parent_identity", expression: /(parent|tuteur)\s*[:=]\s*[^\n,;]+/gi, replacement: "$1: [PARENT]" },
  { code: "teacher_identity", expression: /(enseignant|professeur)\s*[:=]\s*[^\n,;]+/gi, replacement: "$1: [ENSEIGNANT]" },
  { code: "private_url", expression: /https?:\/\/(?:localhost|127\.0\.0\.1|[^\s/]+\.internal)\S*/gi, replacement: "[URL PRIVÉE MASQUÉE]" },
  { code: "financial", expression: /\b(numéro de carte|compte bancaire|iban|solde bancaire)\s*[:=]\s*[^\n]+/gi, replacement: "$1: [DONNÉE FINANCIÈRE MASQUÉE]" },
];

const FORBIDDEN_CONTENT_PATTERNS = [
  { code: "medical", expression: /\b(diagnostic|groupe sanguin|rhésus|allergie|maladie chronique|traitement médical|vaccination|handicap médical|fiche médicale)\b/i },
  { code: "biometric", expression: /\b(empreinte digitale|donnée biométrique|biométrie|modèle biométrique)\b/i },
];

const FORBIDDEN_CONTEXT_KEY = /password|token|secret|api.?key|medical|health|allerg|diagnos|vaccin|blood|rhesus|biometric|fingerprint|disciplin|sanction|payment|finance|attachment|url|uid|schoolId|schoolYearId|academicYearId|documentId|studentId|parentId|userId|claims?/i;
const ALLOWED_DOCUMENT_CONTEXT_KEYS = new Set(["date", "time", "endTime", "schoolName", "academicYearName"]);

export function sanitizeAiText(value: string) {
  const detected: string[] = [];
  let sanitized = value;
  for (const pattern of SENSITIVE_PATTERNS) {
    pattern.expression.lastIndex = 0;
    if (pattern.expression.test(sanitized)) detected.push(pattern.code);
    pattern.expression.lastIndex = 0;
    sanitized = sanitized.replace(pattern.expression, pattern.replacement);
  }
  for (const pattern of FORBIDDEN_CONTENT_PATTERNS) {
    if (pattern.expression.test(sanitized)) {
      detected.push(pattern.code);
      sanitized = sanitized.replace(/^.*(?:diagnostic|groupe sanguin|rhÃ©sus|allergie|maladie chronique|traitement mÃ©dical|vaccination|handicap mÃ©dical|fiche mÃ©dicale|empreinte digitale|donnÃ©e biomÃ©trique|biomÃ©trie|modÃ¨le biomÃ©trique).*$/gim, "[DONNÃ‰E INTERDITE MASQUÃ‰E]");
    }
  }
  return { sanitized, detected: [...new Set(detected)] };
}

export function containsForbiddenAiContent(value: string) {
  return FORBIDDEN_CONTENT_PATTERNS.some((pattern) => pattern.expression.test(value));
}

export function sanitizeAiContext(value: unknown): unknown {
  if (typeof value === "string") return sanitizeAiText(value).sanitized;
  if (Array.isArray(value)) return value.slice(0, 50).map(sanitizeAiContext);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !FORBIDDEN_CONTEXT_KEY.test(key))
      .slice(0, 50)
      .map(([key, item]) => [key, sanitizeAiContext(item)]));
  }
  return value;
}

export function sanitizeSelectedSections(sections: Record<string, string>) {
  return Object.fromEntries(Object.entries(sections).map(([key, value]) => [key, sanitizeAiText(value).sanitized]));
}

export function whitelistDocumentContext(context: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(context)
    .filter(([key, value]) => ALLOWED_DOCUMENT_CONTEXT_KEYS.has(key) && typeof value === "string")
    .map(([key, value]) => [key, sanitizeAiText(value as string).sanitized]));
}
