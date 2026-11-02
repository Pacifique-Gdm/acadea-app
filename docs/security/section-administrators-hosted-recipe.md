# PR #40 — recette B08 hébergée préparée

## État (2 novembre 2026)

Préparation uniquement : aucune fixture distante, activation réelle, publication de
règles, Function ou application n'a été effectuée. Les scénarios hébergés restent
NON EXÉCUTÉS. Ne pas convertir un succès des tests de contrat en succès Staging.

### Orchestration livrée

- `sectionStagingPlan.mjs` : identifiant cryptographique, deux écoles et années,
  huit élèves dans quatre sections, parents multi-sections, profils, paiements,
  dépenses, autres recettes et paies exclusivement fictifs. Les administrateurs
  de section sont initialement inactifs ; l'API normale du Super Administrateur
  effectue l'activation pendant le test. Aucun contournement d'authentification.
- `sectionStagingFixture.mjs` : vérification préalable de chaque document/UID,
  manifeste sans mot de passe sauvegardé avant création, opérations create-only.
  Nettoyage borné aux écoles du manifeste, contrôle de propriété, préconditions
  de suppression Firestore/Storage, contrôle Auth et recherche des résidus.
- `section-admin-staging-recipe.yml` : lancement manuel, branche unique,
  environnement Staging, WIF sans clé, contrôle SHA/bundle, aucun déploiement.
  Identifiant de connexion généré par run, masqué, jamais conservé en artefact.
- `section-admin-staging.spec.mjs` : connexions réelles, appels au Preview réel,
  aucune réponse API simulée. Les trois profils parcourent les cinq onglets.
- `sectionStagingPdfCheck.mjs` : génération depuis les interfaces, rendu de toutes
  les pages, OCR de cloisonnement des listes élèves, preuves PNG/PDF. L'inspection
  visuelle humaine/agent des PNG reste distincte de l'OCR et n'est pas annoncée PASS.
- `section-admin-staging-cleanup.yml` : récupération d'un manifeste archivé si
  arrêt brutal du runner. Vérifie le dépôt, workflow et branche du run source.

### Matrice exécutée lors du lancement autorisé

| Périmètre | Assertions préparées |
| --- | --- |
| Dashboard | Bootstrap de la seule école, population et montant scolaire exact par section, refus autre année/école, export PDF |
| Élèves | Listes quatre sections, modification autorisée, refus déplacement hors section et suppression directe, export PDF avec absence des autres élèves |
| Contrôle | Historique scolaire borné, dépenses/recettes/paie globales lisibles, solde global, création de paiement et rejeu idempotent, refus suppression et montant nul, mutations comptables interdites |
| Message | Parent multi-sections joignable, parent étranger absent, envoi réciproque via API, lecture du message et notification propre au compte, autre notification refusée, pièce jointe via Function et refus interécole |
| Menu | Lecteurs scolaires, personnel, frais, médical, Valves ; ouverture des rubriques et rapport financier PDF ; absence des commandes interdites |
| Intégrité | Comparaison des documents de l'école témoin avant/après, nettoyage des ressources générées par les API inclus |

Les envois bidirectionnels et fichiers sont contrôlés via les vrais endpoints
authentifiés ; cela ne prétend pas tester chaque geste de composition ou chaque
bouton d'upload du navigateur. Le téléversement par ces trois rôles reste interdit.

## Accès existants vérifiés en lecture seule

- Projet : `acadea-staging`, numéro **1039133094640**.
- Les cinq variables publiques `STAGING_FIREBASE_*` existent déjà dans
  l'environnement GitHub `acadea-staging-e2e` ; ne pas les recréer.
- Aucun pool WIF retourné par Google Cloud ; aucun compte de service dédié à
  cette recette identifié parmi les quatre comptes existants. Ne pas réutiliser
  implicitement le compte Firebase Admin général.
- `GCP_STAGING_WIF_PROVIDER` et `GCP_STAGING_E2E_SERVICE_ACCOUNT` absents.
- Aucun secret présent dans l'environnement GitHub (notamment le secret officiel
  Vercel Automation Bypass si le Preview reste protégé).
- L'identité Google Cloud locale dispose des permissions de création du pool,
  fournisseur, compte et rôle IAM, ainsi que des liaisons nécessaires. Aucune
  modification IAM n'a été appliquée dans cette préparation.
- L'environnement GitHub a une politique de branches, mais pas de règle de
  reviewer obligatoire au moment de la vérification.

## Une seule configuration à approuver, exécutable par Codex

Le propriétaire n'a pas besoin de créer une clé, de copier des secrets dans le
chat, ni de réaliser la recette. Avant l'exécution, approuver la création d'une
identité WIF dédiée Staging et le rattachement de ses seuls droits de fixture.
Codex peut réaliser cette configuration avec la session disponible, puis :

1. Créer un pool/fournisseur OIDC dédié et un compte de service de recette ;
   lier `roles/iam.workloadIdentityUser` uniquement à ce compte. Appliquer les
   restrictions dépôt `1280525031`, propriétaire `296899034`, branche exacte,
   événement `workflow_dispatch`, environnement `acadea-staging-e2e` décrites dans
   `section-administrators-staging-access.md`. Restreindre aussi `workflow_ref`
   aux trois workflows Staging `section-admin-staging-preflight.yml`,
   `section-admin-staging-recipe.yml` et `section-admin-staging-cleanup.yml`.
2. Le rôle `projects/acadea-staging/roles/sectionAdminFixture` est désormais
   attribué au compte `section-admin-e2e@acadea-staging.iam.gserviceaccount.com` :
   Auth users get/create/update et Firestore entities get/list/create/update,
   exclusivement. Aucun droit de suppression, Owner/Editor ou Production.
   Les droits Admin SDK restent de portée projet, conformément à l'autorisation.
   Ne pas ajouter de droits Storage ou de suppression implicitement.
3. Enregistrer les deux noms réels créés dans les variables WIF existantes
   attendues. Ajouter le reviewer du propriétaire à l'environnement GitHub et
   autoriser seulement la branche candidate. Enregistrer le secret officiel
   Vercel dans l'environnement, sans l'afficher, si nécessaire.

Références officielles :
[WIF GitHub](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines),
[permissions Auth](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseauth),
[permissions Storage](https://docs.cloud.google.com/iam/docs/roles-permissions/storage).

## Autorisation de lancement distincte

Il faut autoriser le déploiement coordonné candidat **Staging uniquement**
(application/API, Functions, règles, index nécessaires), puis le lancement de la
recette et ses écritures fictives. Aucun workflow de ce dossier ne déploie ces
composants. Le Preview isolé doit être issu du SHA approuvé, utiliser le projet
Staging et contenir les mêmes API que les scripts.

Après déploiement autorisé, Codex lance `section-admin-staging-recipe` avec URL,
SHA complet et confirmation `RECETTE STAGING AUTORISEE`, conserve les résultats
expurgés, inspecte les PNG et contrôle la clôture des fixtures.
Les workflows utilisent désormais `retire`, sans suppression : profils et écoles
fictifs désactivés, comptes Auth désactivés, claims retirés et refresh tokens
révoqués. Les documents financiers et objets sont conservés. Le manifeste porte
`retired: true`, `cleaned: false`, `retained: true` ; ce n'est PAS zéro résidu.
Les chemins et comptes sont contrôlés avant mutation, les mises à jour Firestore
utilisent une précondition et un réessai est possible après interruption.
La révocation effective des accès avec des jetons déjà émis doit encore être
contrôlée sur l'environnement hébergé avant de déclarer le cycle maîtrisé.
La commande distante `cleanup` est désactivée ; ses anciens tests restent locaux.
Tout test, clôture ou OCR échoué interdit un verdict PASS global.

Un `always()` ne peut pas garantir son exécution après destruction du runner.
Dans ce cas Codex lance le workflow de récupération avec run/tentative source,
URL et SHA. L'artefact préalable expire après sept jours : intervenir avant cette
expiration. Aucun document ambigu n'est supprimé ; un conflit bloque le nettoyage.

Les trois workflows sont désormais autorisés sur `push` dans WIF, uniquement
sur la branche candidate, le dépôt et l'environnement protégés. Le précontrôle
41363999505 a réussi. Chaque nouveau job conserve son approbation GitHub.
La recette compare le SHA servi au SHA du push avant toute identité ou fixture.
La récupération sur push nécessite les variables ACADEA_SECTION_RECOVERY_RUN,
ACADEA_SECTION_RECOVERY_ATTEMPT et ACADEA_SECTION_RECOVERY_SHA ; sans run explicite
elle est ignorée. Elle vérifie dépôt, branche, workflow, événement, SHA, tentative
et état terminé du run source avant de télécharger son manifeste.
Le scénario de fichier passe maintenant par une vraie connexion Secrétaire,
l'upload client soumis aux règles Storage et l'API send-school-message ; aucun
upload Admin SDK ni modification directe des pièces jointes du message.
Seul le brouillon propre au Secrétaire est supprimé par ses droits applicatifs.
Le fichier final fictif reste conservé selon la politique de clôture sans purge.
Ce parcours modifié n'est pas encore validé sur Firebase hébergé.

## Preuves locales de préparation

14 tests de contrat PASS (plan, exclusions Production, comptes inactifs,
nettoyage, création interrompue, idempotence et préservation d'un tiers) sur backend
en mémoire, sans accès Firebase. Syntaxe des scripts et des workflows vérifiée ;
Playwright découvre les trois scénarios. Ces résultats ne valident pas les
endpoints hébergés, leurs index, les PDF réels ni la disponibilité du Preview.
