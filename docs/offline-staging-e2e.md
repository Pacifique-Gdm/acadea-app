# Recette authentifiée hors connexion sur Firebase Staging

Ce workflow est volontairement séparé des deux CI obligatoires. Il ne se lance
qu'à la demande, depuis `preproduction-ci` avec l'entrée
`run_offline_staging_e2e=true` et la ref
`codex/offline-staging-e2e-20261028`. Le nouveau workflow seul n'est pas encore
présent sur `main`, d'où ce point d'entrée manuel déjà connu de GitHub Actions.

## Configuration préalable unique

Créer l'environnement GitHub `acadea-staging-e2e`, idéalement avec approbation
requise. Y enregistrer sept **variables d'environnement**, sans clé privée :
`GCP_STAGING_WIF_PROVIDER`, `GCP_STAGING_E2E_SERVICE_ACCOUNT`,
`STAGING_FIREBASE_API_KEY`, `STAGING_FIREBASE_AUTH_DOMAIN`,
`STAGING_FIREBASE_STORAGE_BUCKET`, `STAGING_FIREBASE_MESSAGING_SENDER_ID` et
`STAGING_FIREBASE_APP_ID`. Les cinq dernières proviennent de l'application Web
officielle de `acadea-staging`. Le domaine et le bucket sont bloqués dans le
workflow à `acadea-staging.firebaseapp.com` et
`acadea-staging.firebasestorage.app`; le projectId est fixé dans le code.

Sur Google Cloud, utiliser un compte de service **dans `acadea-staging`**,
sans clé, autorisé à gérer uniquement les utilisateurs fictifs Auth et les
documents Firestore de cette recette. Les rôles prédéfinis nécessaires sont
`roles/firebaseauth.admin` et `roles/datastore.user` sur `acadea-staging` ;
ils donnent accès à l'ensemble du projet Staging, pas seulement à la fixture.
Restreindre donc rigoureusement le fournisseur WIF à
`assertion.repository=='Pacifique-Gdm/acadea-app'` et
`assertion.ref=='refs/heads/codex/offline-staging-e2e-20261028'`, puis accorder
`roles/iam.workloadIdentityUser` à cette seule identité sur le compte de service.
Ne donner aucun rôle sur `acadea-production`. Ajouter éventuellement une
approbation GitHub obligatoire sur l'environnement avant l'exécution.

Le job vérifie l'identité fédérée, construit le bundle Staging, compare
`/version.json` au SHA GitHub, crée une école et quatre comptes aléatoires,
authentifie les rôles via Firebase Auth, puis teste les brouillons et
l'API candidate locale avec Firestore Staging. Les requêtes API sont traitées
par les véritables handlers de la branche dans le processus Playwright ; ce
n'est **pas** une recette d'un déploiement Vercel Staging. Aucune règle Firebase
ni donnée Production n'est modifiée.

Le nettoyage `if: always()` supprime les documents et comptes identifiés dans
le manifeste du run et vérifie l'absence de résidus. Une interruption brutale
du runner peut empêcher même cette étape : dans ce cas, conserver le run en
échec et faire une revue ciblée de l'école `e2e-offline-<run>-...` avant toute
relance. Aucun nettoyage global n'est autorisé.
