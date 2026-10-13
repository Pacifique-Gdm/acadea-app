import type { Role } from "../../types";

export type LibraryAudience = Extract<Role, "school_admin" | "study_director" | "teacher" | "parent" | "secretary" | "cashier" | "discipline_director">;
export type LibraryLanguage = "Français" | "Anglais" | "Français / Anglais";
export type LibraryOrigin = "RDC" | "Francophonie / Afrique" | "International";
export type LibraryAccess = "Gratuit" | "Gratuit + payant" | "Gratuit avec compte";

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
  provider?: string;
  resourceType?: string;
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
  category?: string;
  resourceType?: string;
};

const allSchoolAudiences: readonly LibraryAudience[] = ["school_admin", "study_director", "teacher", "parent", "secretary", "cashier", "discipline_director"];

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
  {
    id: "anglais-video", name: "Apprendre-Anglais.tv", provider: "Apprendre-Anglais.tv", resourceType: "Cours vidéo",
    description: "Cours d’anglais en vidéo expliqués en français, avec des leçons pour débutants et des quiz.",
    url: "https://www.apprendre-anglais.tv/", language: "Français / Anglais", accessType: "Gratuit", origin: "International",
    audiences: allSchoolAudiences, category: "Apprendre l'anglais", featured: false, official: false, enabled: true, order: 12,
  },
  {
    id: "anglais-a1-a2", name: "Anglais — Débutant A1-A2", provider: "Apprendre-Anglais.tv", resourceType: "Formation vidéo",
    description: "Formation vidéo pour apprendre les bases de l’anglais : vocabulaire, grammaire, prononciation et conversation.",
    url: "https://www.apprendre-anglais.tv/courses/anglais-debutant-a1-a2/", language: "Français / Anglais", accessType: "Gratuit", origin: "International",
    audiences: allSchoolAudiences, category: "Apprendre l'anglais", featured: false, official: false, enabled: true, order: 13,
  },
  {
    id: "anglaisfacile", name: "AnglaisFacile", provider: "AnglaisFacile.com", resourceType: "Cours et exercices",
    description: "Leçons, vidéos et exercices interactifs pour améliorer la grammaire, le vocabulaire et la compréhension de l’anglais.",
    url: "https://www.anglaisfacile.com/cours-videos-anglais.php", language: "Français / Anglais", accessType: "Gratuit", origin: "International",
    audiences: allSchoolAudiences, category: "Apprendre l'anglais", featured: false, official: false, enabled: true, order: 14,
  },
  {
    id: "wall-street-english", name: "Wall Street English", provider: "Wall Street English", resourceType: "Vidéos pédagogiques",
    description: "Vidéos et conseils pour améliorer la prononciation, le vocabulaire et la conversation en anglais.",
    url: "https://wallstreetenglish.fr/blog/conseils/videos-apprendre-anglais", language: "Français / Anglais", accessType: "Gratuit + payant", origin: "International",
    audiences: allSchoolAudiences, category: "Apprendre l'anglais", featured: false, official: false, enabled: true, order: 15,
  },
  {
    id: "british-council", name: "British Council — LearnEnglish", provider: "British Council", resourceType: "Cours et vidéos",
    description: "Ressources et vidéos pour développer la compréhension orale, le vocabulaire et la communication en anglais.",
    url: "https://learnenglish.britishcouncil.org/", language: "Anglais", accessType: "Gratuit + payant", origin: "International",
    audiences: allSchoolAudiences, category: "Apprendre l'anglais", featured: false, official: false, enabled: true, order: 16,
  },
  {
    id: "computer-basics", name: "Initiation à l’informatique", provider: "OpenClassrooms", resourceType: "Cours avec vidéos et exercices",
    description: "Apprendre à utiliser un ordinateur, le clavier, la souris, les fichiers et les logiciels de base.",
    url: "https://openclassrooms.com/fr/courses/5737801-faites-vos-premiers-pas-sur-ordinateur", language: "Français", accessType: "Gratuit avec compte", origin: "International",
    audiences: allSchoolAudiences, category: "Apprendre l'informatique", featured: false, official: false, enabled: true, order: 17,
  },
  {
    id: "internet-basics", name: "Apprendre à utiliser Internet", provider: "OpenClassrooms", resourceType: "Cours en ligne",
    description: "Apprendre à naviguer sur Internet, utiliser un navigateur et effectuer des recherches en ligne.",
    url: "https://openclassrooms.com/fr/courses/5870011-naviguez-sur-internet", language: "Français", accessType: "Gratuit avec compte", origin: "International",
    audiences: allSchoolAudiences, category: "Apprendre l'informatique", featured: false, official: false, enabled: true, order: 18,
  },
  {
    id: "khan-programming", name: "Programmation informatique", provider: "Khan Academy", resourceType: "Cours et exercices interactifs",
    description: "Cours interactifs pour découvrir la programmation, JavaScript, HTML et CSS.",
    url: "https://fr.khanacademy.org/computing/cs", language: "Français", accessType: "Gratuit", origin: "International",
    audiences: allSchoolAudiences, category: "Apprendre l'informatique", featured: false, official: false, enabled: true, order: 19,
  },
  {
    id: "understand-web", name: "Comprendre le Web", provider: "OpenClassrooms", resourceType: "Cours en ligne",
    description: "Comprendre le fonctionnement d’Internet, des sites web et des technologies numériques.",
    url: "https://openclassrooms.com/fr/courses/1946386-comprendre-le-web", language: "Français", accessType: "Gratuit avec compte", origin: "International",
    audiences: allSchoolAudiences, category: "Apprendre l'informatique", featured: false, official: false, enabled: true, order: 20,
  },
  {
    id: "programming-c", name: "Apprendre à programmer en C", provider: "OpenClassrooms", resourceType: "Cours de programmation",
    description: "Initiation à la programmation en langage C, avec des exemples et des exercices pratiques.",
    url: "https://openclassrooms.com/fr/courses/19980-apprenez-a-programmer-en-c", language: "Français", accessType: "Gratuit avec compte", origin: "International",
    audiences: allSchoolAudiences, category: "Apprendre l'informatique", featured: false, official: false, enabled: true, order: 21,
  },
  {
    id: "computer-technician", name: "Métier de technicien informatique", provider: "OpenClassrooms", resourceType: "Formation professionnelle",
    description: "Découvrir les missions, les compétences et les responsabilités d’un technicien informatique.",
    url: "https://openclassrooms.com/fr/courses/6825041-decouvrez-le-metier-de-technicien-informatique", language: "Français", accessType: "Gratuit avec compte", origin: "International",
    audiences: allSchoolAudiences, category: "Apprendre l'informatique", featured: false, official: false, enabled: true, order: 22,
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
    if (filters.category && resource.category !== filters.category) return false;
    if (filters.resourceType && resource.resourceType !== filters.resourceType) return false;
    const searchable = `${resource.name} ${resource.provider ?? ""} ${libraryDescription(resource, audience)} ${resource.category} ${resource.language} ${resource.resourceType ?? ""}`.toLocaleLowerCase("fr");
    return !query || searchable.includes(query);
  }).sort((left, right) => left.order - right.order || left.name.localeCompare(right.name, "fr"));
}
