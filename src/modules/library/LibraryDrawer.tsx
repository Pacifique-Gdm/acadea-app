import { useState } from "react";
import { BookOpen, ExternalLink, Languages, Laptop } from "lucide-react";
import { AdminDrawer } from "../../components/ui";
import {
  libraryDescription, selectLibraryResources,
  type LibraryAccess, type LibraryAudience, type LibraryLanguage, type LibraryOrigin, type LibraryResource,
} from "./libraryCatalog";

function ResourceCard({ resource, audience }: { resource: LibraryResource; audience: LibraryAudience }) {
  return <article className={`min-w-0 rounded border bg-white p-4 shadow-sm dark:bg-slate-900 ${resource.featured ? "border-blue-300" : "border-slate-200 dark:border-slate-700"}`}>
    <div className="flex min-w-0 items-start gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-blue-50 text-blue-700"><BookOpen className="h-5 w-5" aria-hidden="true" /></div>
      <div className="min-w-0 flex-1">
        <h4 className="break-words font-bold text-ink dark:text-slate-100">{resource.name}</h4>
        <p className="mt-1 break-words text-xs font-semibold text-slate-600 dark:text-slate-300">{resource.provider ?? resource.name}</p>
        <p className="mt-1 break-words text-sm text-slate-600 dark:text-slate-300">{libraryDescription(resource, audience)}</p>
      </div>
    </div>
    <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-600 dark:text-slate-200">
      <span className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">{resource.origin}</span>
      <span className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">{resource.language}</span>
      <span className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">{resource.accessType}</span>
      <span className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">{resource.category}</span>
      <span className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">{resource.resourceType ?? "Ressource éducative"}</span>
      {resource.official && <span className="rounded bg-blue-50 px-2 py-1 text-blue-700">Officiel RDC</span>}
      {resource.featured && <span className="rounded bg-blue-50 px-2 py-1 text-blue-700">À la une</span>}
    </div>
    <a href={resource.url} target="_blank" rel="noopener noreferrer" className="primary-button mt-4 inline-flex max-w-full items-center justify-center gap-2">
      {resource.order >= 12 ? "Voir le cours" : "Visiter le site"} <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="sr-only">{resource.name} — ouvre un nouvel onglet</span>
    </a>
  </article>;
}

function CategorySections({ resources, audience }: { resources: LibraryResource[]; audience: LibraryAudience }) {
  const categories = Array.from(new Set(resources.map((resource) => resource.category)));
  return categories.map((category) => {
    const Icon = category === "Apprendre l'anglais" ? Languages : category === "Apprendre l'informatique" ? Laptop : BookOpen;
    return <section key={category} className="grid min-w-0 gap-3 border-t border-slate-200 pt-5 dark:border-slate-700" aria-label={category}>
      <h4 className="flex min-w-0 items-center gap-2 break-words text-base font-bold text-ink dark:text-slate-100">
        <Icon className="h-5 w-5 shrink-0 text-blue-700 dark:text-blue-300" aria-hidden="true" />{category}
      </h4>
      <div className="grid min-w-0 grid-cols-1 gap-3">{resources.filter((resource) => resource.category === category).map((resource) => <ResourceCard key={resource.id} resource={resource} audience={audience} />)}</div>
    </section>;
  });
}

export function LibraryDrawer({ audience, onClose }: { audience: LibraryAudience; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState<LibraryLanguage | "">("");
  const [origin, setOrigin] = useState<LibraryOrigin | "">("");
  const [accessType, setAccessType] = useState<LibraryAccess | "">("");
  const [category, setCategory] = useState("");
  const [resourceType, setResourceType] = useState("");
  const allResources = selectLibraryResources(audience);
  const resources = selectLibraryResources(audience, { query, language, origin, accessType, category, resourceType });
  const official = resources.filter((resource) => resource.official);
  const complementary = resources.filter((resource) => !resource.official);
  const hasFilters = Boolean(query || language || origin || accessType || category || resourceType);
  const reset = () => { setQuery(""); setLanguage(""); setOrigin(""); setAccessType(""); setCategory(""); setResourceType(""); };

  return <AdminDrawer title="Bibliothèque" closeLabel="Fermer la bibliothèque" onClose={onClose} adaptiveTheme>
    <p className="break-words text-sm text-slate-600 dark:text-slate-300">Ressources éducatives externes sélectionnées par Acadéa. Ces contenus sont consultés sur leurs sites respectifs ; Acadéa ne les héberge pas.</p>
    <label className="grid min-w-0 gap-1 text-sm font-semibold text-ink dark:text-slate-100">Rechercher une ressource
      <input className="input min-w-0 w-full dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nom, plateforme, catégorie, langue ou formation" />
    </label>
    <details className="min-w-0 rounded border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <summary className="cursor-pointer font-semibold text-ink dark:text-slate-100">Filtres{hasFilters ? " actifs" : ""}</summary>
      <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="grid min-w-0 gap-1 text-sm">Langue
          <select className="input min-w-0 w-full dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" value={language} onChange={(event) => setLanguage(event.target.value as LibraryLanguage | "")}>
            <option value="">Toutes les langues</option><option value="Français">Français</option><option value="Anglais">Anglais</option><option value="Français / Anglais">Français / Anglais</option>
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-sm">Origine
          <select className="input min-w-0 w-full dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" value={origin} onChange={(event) => setOrigin(event.target.value as LibraryOrigin | "")}>
            <option value="">Toutes les origines</option><option value="RDC">RDC</option><option value="Francophonie / Afrique">Francophonie / Afrique</option><option value="International">International</option>
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-sm">Accès
          <select className="input min-w-0 w-full dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" value={accessType} onChange={(event) => setAccessType(event.target.value as LibraryAccess | "")}>
            <option value="">Tous les accès</option><option value="Gratuit">Gratuit</option><option value="Gratuit + payant">Gratuit + payant</option><option value="Gratuit avec compte">Gratuit avec compte</option>
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-sm">Catégorie
          <select className="input min-w-0 w-full dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">Toutes les catégories</option>{Array.from(new Set(allResources.map((resource) => resource.category))).map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-sm">Type de ressource
          <select className="input min-w-0 w-full dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" value={resourceType} onChange={(event) => setResourceType(event.target.value)}>
            <option value="">Tous les types</option>{Array.from(new Set(allResources.map((resource) => resource.resourceType).filter((item): item is string => Boolean(item)))).map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>
      {hasFilters && <button type="button" className="secondary-button mt-3" onClick={reset}>Effacer la recherche et les filtres</button>}
    </details>
    <p className="text-xs text-slate-500 dark:text-slate-300" role="status">{resources.length} ressource{resources.length > 1 ? "s" : ""}</p>
    {resources.length === 0 && <p className="rounded border border-dashed border-slate-300 p-5 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">Aucune ressource ne correspond à vos critères.</p>}
    {official.length > 0 && <section className="grid min-w-0 gap-3" aria-label="Ressources officielles de la RDC">
      <h3 className="break-words text-base font-bold text-ink dark:text-slate-100">Ressources officielles de la RDC</h3>
      <CategorySections resources={official} audience={audience} />
    </section>}
    {complementary.length > 0 && <section className="grid min-w-0 gap-3" aria-label="Ressources éducatives complémentaires">
      <h3 className="break-words text-base font-bold text-ink dark:text-slate-100">Ressources éducatives complémentaires</h3>
      <CategorySections resources={complementary} audience={audience} />
    </section>}
  </AdminDrawer>;
}
