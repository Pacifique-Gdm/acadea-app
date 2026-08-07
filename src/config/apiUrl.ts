const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() ?? "";

export function resolveApiUrl(path: string, baseUrl = configuredApiBaseUrl) {
  if (!path.startsWith("/api/")) {
    throw new Error(`Chemin API invalide : ${path}`);
  }

  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
  return normalizedBaseUrl ? `${normalizedBaseUrl}${path}` : path;
}
