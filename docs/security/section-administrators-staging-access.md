# B08 — préparation de l'accès Staging (sans déploiement)

Le workflow manuel `section-admin-staging-preflight.yml` vérifie uniquement la
configuration et l'obtention d'une identité fédérée. Il ne déploie rien et ne
crée aucune fixture. Son succès n'est pas une recette fonctionnelle.
Le workflow historique hors connexion est inchangé.

## Intervention du propriétaire Google Cloud / GitHub

1. Dans **acadea-staging**, choisir/créer un compte de service dédié à la recette,
   sans clé privée. Configurer un fournisseur OIDC Workload Identity Federation
   pour `https://token.actions.githubusercontent.com`.
2. Restreindre la confiance au dépôt `Pacifique-Gdm/acadea-app` (utiliser ses
   identifiants numériques réels de dépôt/propriétaire), à la branche
   `refs/heads/codex/section-admin-profiles-final-20261031`, à l'événement
   `workflow_dispatch` et à l'environnement `acadea-staging-e2e`. Ne pas autoriser
   les forks ni toutes les branches. Mapper `google.subject=assertion.sub` et
   les attributs nécessaires à ces restrictions.
3. Accorder `roles/iam.workloadIdentityUser` à cette identité fédérée **sur ce seul
   compte de service**. Aucun rôle Owner/Editor, aucun accès Production.
4. Dans GitHub → Settings → Environments → **acadea-staging-e2e** → Variables,
   renseigner les valeurs réelles non secrètes :
   - `GCP_STAGING_WIF_PROVIDER` : nom complet du fournisseur créé, au format
     `projects/NUMERO_REEL/locations/global/workloadIdentityPools/POOL_REEL/providers/FOURNISSEUR_REEL`.
   - `GCP_STAGING_E2E_SERVICE_ACCOUNT` : adresse réelle du compte dédié,
     se terminant par `@acadea-staging.iam.gserviceaccount.com`.
   Conserver une approbation obligatoire de cet environnement.

Le numéro de projet, le pool et l'adresse du compte ne sont pas connus ici :
ils ne doivent pas être inventés. Aucune valeur sensible à copier dans le chat.

Référence officielle : https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines

## Avant une recette hébergée (autorisation distincte requise)

Il faudra autoriser le déploiement candidat coordonné du frontend, des API,
Functions, index et règles sur Staging, puis vérifier son SHA et sa cible.
Le compte de fixture devra disposer des permissions minimales de création,
lecture, mise à jour et suppression des utilisateurs fictifs Auth et des
documents fictifs Firestore. Les droits IAM Firestore ne sont pas bornés par les
règles clientes : cette portée doit être explicitement acceptée sur Staging,
avec manifeste et contrôles d'appartenance stricts. Aucun droit de déploiement
ou de modification IAM n'est nécessaire au runner de recette.
Les permissions Storage doivent être accordées seulement si le scénario écrit
des fichiers, sur le bucket Staging et un préfixe de fixture contrôlé.

Le préflight ne vérifie pas ces permissions métier et ne les accorde pas.
La recette devra créer deux écoles fictives, les trois profils, des élèves de
sections différentes et un parent mixte ; utiliser de vraies connexions ;
vérifier les cinq onglets, les accès refusés, les PDF et les fichiers ; nettoyer
dans un bloc `finally`/étape `always` et contrôler les résidus. Ne pas réutiliser
le helper émulateur qui autorise uniquement `demo-acadea` contre un projet hébergé.
