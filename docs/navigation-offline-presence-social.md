# Navigation, formulaires hors connexion, parents, présences et décisions sociales

Base : `main` à `d393c04a86d247e67e825062642982145c0a87ee`, après fusion de #44.
Branche indépendante ; aucune modification des règles Firebase, API financières ou files existantes.

## Causes et corrections

- Direction des études : le changement Élèves/Horaires modifiait `includeStudents`, dépendance de l'effet démarrant tous les abonnements pédagogiques. Les abonnements élèves sont désormais séparés. Les callbacks périmés sont ignorés et un changement de périmètre masque immédiatement les anciennes données.
- Hors connexion : les frais étaient proposés sans attribution individuelle ; les classes ne portaient pas de métadonnée opérationnelle. Le préchargement réutilise les règles métier existantes. Les anciens caches incomplets sont refusés explicitement, sans purge. Les obligations distinctes de même libellé restent distinctes.
- Inscription locale : champs réinitialisés uniquement après confirmation de la file durable ; verrou contre double soumission. Changer de compte/école/année réinitialise uniquement le formulaire, jamais la file.
- Parent : une seule recherche à suggestions, accent-insensible, limitée à l'école, téléphone masqué. Sélection et retrait explicites.
- Présences : les lectures initiales auparavant séquentielles sont parallèles ; affichage des subdivisions opérationnelles et classes vides, sans altérer les statuts ni les données historiques.
- Social : Modifier ouvre une instance indépendante dans un drawer, conserve l'identifiant et la version de la décision, la confirmation serveur et les droits existants. Les drawers imbriqués ne traitent plus tous la même touche Échap.

## Preuves locales au 5 novembre 2026

- 28 scénarios Chromium : PASS, composants réels, IndexedDB réel, réseau coupé pour les saisies locales. Les services du banc social et pédagogique sont simulés : ce n'est pas une recette Firebase hébergée.
- 60 tests ciblés initiaux : PASS (choix hors connexion, StudentForm et classes opérationnelles).
- 19 tests ciblés complémentaires : PASS (présences, choix hors connexion, capture/synchronisation).
- Lint global : PASS après correction des types du banc de test.
- Build Vite mode test : PASS ; ce build n'est pas un build Staging officiel.
- Les délais avant/après, la navigation de chaque rôle, la synchronisation hébergée et les appareils physiques ne sont pas encore validés.

## Sécurité et limites

Aucune nouvelle permission, aucune migration, aucune suppression IndexedDB, aucun nettoyage #40.
La décision de livraison reste suspendue aux CI et à la recette Staging. Pas de fusion ni de déploiement Production autorisé dans cette mission.
