/** Règle du propriétaire (23/11) : SEUL l'Administrateur de l'école (rôle `school_admin`, ancien rôle `admin`)
 * a accès à la « Partie 2 — cas sociaux ». Pour tous les autres rôles (Caissier, Coordination, Sous-coordination,
 * personnel à qui une rubrique est partagée…), les règles de la partie 2 ne sortent jamais du serveur :
 * pas de `socialRubrics`, pas de `socialVersionId`, pas de pourcentages du tableau 2, pas de nombre de cas sociaux.
 * Les montants totaux (prévu et réel) restent visibles : ce sont des sommes, sans règle ni élève. */

export const isSchoolAdminRole = (role) => role === "school_admin" || role === "admin";

/** Configuration d'un frais sans la partie 2 (brouillon et version publiée). */
export function withoutSocialConfig(config) {
  if (!config || typeof config !== "object") return config;
  const { socialVersionId: _version, ...rest } = config;
  if (rest.draft && typeof rest.draft === "object") {
    const { socialRubrics: _rubrics, ...draft } = rest.draft;
    rest.draft = draft;
  }
  return rest;
}

/** Version de la partie 1 sans la partie 2 qui l'accompagne. */
export function withoutSocialVersion(version) {
  if (!version || typeof version !== "object") return version;
  const { socialRubrics: _rubrics, hasSocialPart: _has, ...rest } = version;
  return rest;
}

/** Prévu sans les règles de la partie 2 : le tableau 2 garde ses montants, mais plus son pourcentage ni sa version. */
export function withoutSocialForecast(forecast) {
  if (!forecast || typeof forecast !== "object") return forecast;
  const { socialStudentCount: _count, ...rest } = forecast;
  return { ...rest, rows: Array.isArray(forecast.rows) ? forecast.rows.map((row) => {
    if (row?.table !== 2) return row;
    const { socialVersionId: _version, rubricShare: _share, rubricMode: _mode, basisPoints: _points, ...kept } = row;
    return kept;
  }) : forecast.rows };
}

/** Espace de travail de la répartition, vu par un autre rôle que l'Administrateur. */
export function withoutSocialWorkspace(workspace) {
  return {
    ...workspace,
    configs: Array.isArray(workspace.configs) ? workspace.configs.map(withoutSocialConfig) : workspace.configs,
    ...(workspace.forecast ? { forecast: withoutSocialForecast(workspace.forecast) } : {}),
  };
}
