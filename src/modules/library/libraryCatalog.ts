import type { Role } from "../../types";

export type LibraryAudience = Extract<Role, "study_director" | "teacher" | "parent">;
export type LibraryLanguage = "Français" | "Anglais";
export type LibraryOrigin = "RDC" | "Francophonie / Afrique" | "International";
export type LibraryAccess = "Gratuit" | "Gratuit + payant";

export interface LibraryResource {
  id: string;
  name: string;
  description: string;
  descriptionsByAudience?: Partial<Record<LibraryAudience, string>>;
  url: string;
  language: LibraryLanguage;
  accessType: LibraryAccess;
  origin: LibraryOrigin;
  audiences: readonly LibraryAudience[];
  category: string;
  featured: boolean;
  official: boolean;
  enabled: boolean;
  order: number;
}

export type LibraryFilters = {
  query?: string;
  language?: LibraryLanguage | "";
  origin?: LibraryOrigin | "";
  accessType?: LibraryAccess | "";
};

export const libraryResources: readonly LibraryResource[] = [
  {
    id: "minedu-nc", name: "Ministère de l’Éducation nationale — RDC",
    description: "Actualités et informations officielles du ministère de l’Éducation nationale et Nouvelle Citoyenneté.",
    descriptionsByAudience: { parent: "Retrouvez les informations officielles sur l’école et l’éducation en RDC." },
    url: "https://edu-nc.gouv.cd/", language: "Français", accessType: "Gratuit", origin: "RDC",
    audiences: ["study_director", "teacher", "parent"], category: "Informations officielles", featured: true, official: true, enabled: true, order: 1,
  },
  {
    id: "programmes-rdc", name: "Programmes scolaires officiels — RDC",
    description: "Consultez les programmes nationaux pour organiser les enseignements et préparer les cours.",
    descriptionsByAudience: { parent: "Découvrez les programmes scolaires pour mieux suivre ce que votre enfant apprend." },
    url: "https://edu-nc.gouv.cd/programmes-nationaux", language: "Français", accessType: "Gratuit", origin: "RDC",
    audiences: ["study_director", "teacher", "parent"], category: "Programmes", featured: true, official: true, enabled: true, order: 2,
  },
  {
    id: "documentation-rdc", name: "Documentation et réformes — MINEDU-NC",
    description: "Documents officiels et réformes du secteur éducatif congolais.",
    url: "https://edu-nc.gouv.cd/documentation", language: "Français", accessType: "Gratuit", origin: "RDC",
    audiences: ["study_director", "teacher"], category: "Documentation", featured: false, official: true, enabled: true, order: 3,
  },
  {
    id: "unesco-ressources", name: "UNESCO — Ressources éducatives",
    description: "Bibliothèque numérique et ressources pédagogiques pour l’Afrique francophone.",
    url: "https://www.ressources-educatives.org/bibliotheque-numerique", language: "Français", accessType: "Gratuit", origin: "Francophonie / Afrique",
    audiences: ["study_director", "teacher"], category: "Ressources pédagogiques", featured: false, official: false, enabled: true, order: 4,
  },
  {
    id: "lumni-enseignement", name: "Lumni Enseignement",
    description: "Vidéos, dossiers et pistes pédagogiques pour préparer et illustrer les cours.",
    url: "https://enseignants.lumni.fr/", language: "Français", accessType: "Gratuit", origin: "Francophonie / Afrique",
    audiences: ["study_director", "teacher"], category: "Préparation des cours", featured: false, official: false, enabled: true, order: 5,
  },
  {
    id: "pass-education", name: "Pass Éducation",
    description: "Exercices et supports pédagogiques ; certaines ressources nécessitent une adhésion.",
    descriptionsByAudience: { parent: "Trouvez des exercices pour aider votre enfant à réviser ; certains contenus sont payants." },
    url: "https://www.pass-education.fr/", language: "Français", accessType: "Gratuit + payant", origin: "Francophonie / Afrique",
    audiences: ["study_director", "teacher", "parent"], category: "Exercices", featured: false, official: false, enabled: true, order: 6,
  },
  {
    id: "khan-fr", name: "Khan Academy — Français",
    description: "Cours et exercices gratuits pour approfondir les notions et accompagner les apprentissages.",
    descriptionsByAudience: { parent: "Aidez votre enfant à apprendre et à s’exercer à son rythme." },
    url: "https://fr.khanacademy.org/", language: "Français", accessType: "Gratuit", origin: "International",
    audiences: ["study_director", "teacher", "parent"], category: "Cours et exercices", featured: false, official: false, enabled: true, order: 7,
  },
  {
    id: "tv5-enseigner", name: "TV5MONDE — Enseigner",
    description: "Vidéos et fiches pédagogiques gratuites pour enseigner le français.",
    url: "https://enseigner.tv5monde.com/", language: "Français", accessType: "Gratuit", origin: "Francophonie / Afrique",
    audiences: ["study_director", "teacher"], category: "Langues", featured: false, official: false, enabled: true, order: 8,
  },
  {
    id: "homeschool-123", name: "123 Homeschool 4 Me",
    description: "Fiches et activités éducatives gratuites en anglais, à adapter au contexte de la classe.",
    descriptionsByAudience: { parent: "Activités et fiches gratuites en anglais pour apprendre à la maison." },
    url: "https://www.123homeschool4me.com/", language: "Anglais", accessType: "Gratuit", origin: "International",
    audiences: ["study_director", "teacher", "parent"], category: "Activités", featured: false, official: false, enabled: true, order: 9,
  },
  {
    id: "lumni", name: "Lumni",
    description: "Vidéos, quiz et jeux gratuits pour apprendre et réviser à son rythme.",
    url: "https://www.lumni.fr/", language: "Français", accessType: "Gratuit", origin: "Francophonie / Afrique",
    audiences: ["parent"], category: "Révisions", featured: false, official: false, enabled: true, order: 10,
  },
  {
    id: "tv5-apprendre", name: "TV5MONDE — Apprendre le français",
    description: "Exercices gratuits pour pratiquer le français à partir de vidéos.",
    url: "https://apprendre.tv5monde.com/fr", language: "Français", accessType: "Gratuit", origin: "Francophonie / Afrique",
    audiences: ["parent"], category: "Langues", featured: false, official: false, enabled: true, order: 11,
  },
];

export function libraryDescription(resource: LibraryResource, audience: LibraryAudience): string {
  return resource.descriptionsByAudience?.[audience] ?? resource.description;
}

export function selectLibraryResources(audience: LibraryAudience, filters: LibraryFilters = {}, catalog: readonly LibraryResource[] = libraryResources): LibraryResource[] {
  const query = filters.query?.trim().toLocaleLowerCase("fr") ?? "";
  return catalog.filter((resource) => {
    if (!resource.enabled || !resource.audiences.includes(audience)) return false;
    if (filters.language && resource.language !== filters.language) return false;
    if (filters.origin && resource.origin !== filters.origin) return false;
    if (filters.accessType && resource.accessType !== filters.accessType) return false;
    const searchable = `${resource.name} ${libraryDescription(resource, audience)} ${resource.category}`.toLocaleLowerCase("fr");
    return !query || searchable.includes(query);
  }).sort((left, right) => left.order - right.order || left.name.localeCompare(right.name, "fr"));
}
