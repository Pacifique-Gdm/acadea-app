# Validation financière distante isolée — préparation uniquement

Statut : **aucune ressource créée et aucun test distant exécuté**. Le seul accès
Firebase actuellement identifié est `acadea-staging` et `acadea-production` ;
aucun des deux ne doit recevoir les écritures fictives ci-dessous.

## Architecture requise

1. Obtenir l'autorisation explicite d'un **nouveau projet Firebase dédié**,
   avec un identifiant distinct de Staging et Production, un budget approuvé et
   une durée de vie décidée. Une base Firestore nommée dans un projet existant
   ne suffit pas : Auth, Storage et l'API Admin resteraient partagés, et le
   backend utilise actuellement la base `(default)`.
2. Dans ce projet uniquement, préparer Firebase Authentication (comptes
   fictifs), Firestore `(default)`, Storage et les règles/index nécessaires au
   candidat. Aucun import, copie ou lien vers des données scolaires existantes.
3. Utiliser un Preview Vercel **exclusivement** lié à ce projet de test. Avant
   tout déploiement, démontrer que ses variables et credentials sont propres à
   ce Preview et ne changent ni le Preview Staging partagé ni la Production.
   Si cette séparation n'est pas possible sur le projet Vercel actuel, demander
   l'autorisation d'un projet Vercel de test distinct et son plafond de coût.
4. Adapter puis tester les garde-fous du candidat avant de le connecter à ce
   projet : `src/config/environment.ts` accepte aujourd'hui seulement
   `acadea-staging`, `acadea-production` ou l'émulateur local `demo-acadea` ;
   `e2e/support/environment.ts` refuse tout autre projet distant. Ajouter un
   mode de test **explicitement opt-in**, limité à l'identifiant approuvé, sans
   assouplir les modes Staging/Production. `api/_lib/firebaseAdmin.js` doit
   conserver l'égalité stricte entre le project ID du credential Admin, celui
   du frontend et le project ID attendu du Preview.

## Configuration à préparer après approbation

Variables publiques du Preview : `VITE_APP_ENV`, `VITE_FIREBASE_API_KEY`,
`VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
`VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`,
`VITE_FIREBASE_APP_ID`. Variables serveur :
`FIREBASE_SERVICE_ACCOUNT_JSON`, `ACADEA_EXPECTED_PREVIEW_FIREBASE_PROJECT_ID`,
`ACADEA_PAYROLL_WRITES_SUSPENDED`. Variable du harnais :
`ACADEA_E2E_BASE_URL`. Ne placer aucune valeur secrète dans Git, les journaux,
les captures ou un artefact Playwright. Ne jamais copier un credential
Staging/Production. Le compte de service de test doit être limité au projet de
test ; contrôler IAM et `project_id` avant chaque exécution.

Avant le premier test d'écriture, vérifier indépendamment : project ID du
frontend, `project_id` du credential Admin, cible Auth, base Firestore, bucket
Storage, URL Vercel et SHA `/version.json`. **Arrêter** si une cible est
Staging/Production, ambiguë ou si l'alias canonique est utilisé.

## Scénarios fictifs et contrôles

Créer deux établissements fictifs et les rôles minimaux (administrateur,
secrétaire, caissier, personnel avec et sans compte). Utiliser un préfixe
unique pour tous les UID, documents, objets et clés d'idempotence. Depuis
l'interface **et** l'API, contrôler :

- Création de personnel sans compte, sans altérer la création Parent existante.
- Salaires de périodes distinctes, prime, plusieurs avances et récupérations
  partielles sur salaire puis prime ; cohérence du solde des avances.
- Une seule dépense liée par paiement, aucun double débit, rejeu identique
  idempotent et rejeu divergent refusé.
- Modification/suppression de la dépense liée refusée ; dépenses ordinaires
  toujours possibles ; historiques et bulletins privés accessibles seulement
  aux rôles autorisés.
- Paiement d'un personnel inactif refusé ; refus des mauvais rôles et de toute
  référence croisée entre établissements.
- Avec `ACADEA_PAYROLL_WRITES_SUSPENDED=true` sur un **nouveau déploiement de
  test**, refus des nouveaux salaires/primes/avances, maintien des lectures,
  historiques, dépenses ordinaires et rejouements idempotents identiques.

Conserver les preuves sous forme d'agrégats et d'IDs fictifs uniquement.
Après les tests, supprimer seulement les comptes/documents/objets préfixés
créés dans le projet dédié, puis effectuer un scan indépendant Auth,
Firestore et Storage et rapporter le nombre de résidus. Ne jamais lancer un
nettoyage large ou pointer un script de nettoyage vers Staging/Production.

## Coût et décision préalable

Un petit jeu de données peut rester dans les quotas gratuits de Firestore
`(default)` et d'Authentication, mais ce n'est **pas une garantie de coût nul**.
Cloud Storage for Firebase nécessite le plan Blaze ; Vercel et les ressources
Google Cloud associées dépendent du plan et de la consommation. Une base
Firestore **nommée** ne bénéficie pas du quota gratuit. Faire approuver le
projet, le plan de facturation, la région, les limites de volume/durée et un
plafond budgétaire avant création. Aucun coût n'est engagé par ce document.
Pour un jeu limité à quelques centaines d'opérations et à moins de 100 Mo,
le coût direct Firestore/Auth/Storage est estimé à **0 USD si tous les quotas
gratuits applicables sont respectés** ; cela n'inclut pas un éventuel coût
Vercel, Cloud Build ou dépassement. Recalculer le devis après choix du projet,
de la région et du plan, sans considérer cette estimation comme un plafond.
Références officielles : https://cloud.google.com/firestore/pricing et
https://firebase.google.com/pricing.

## Garde de sortie

Ne déclarer le test distant PASS que si la séparation des cinq cibles
(frontend, Admin, Auth, Firestore, Storage), le SHA servi, tous les scénarios
et le scan à zéro résidu ont été observés. Sinon : NON VÉRIFIÉ ou FAIL avec la
première cause précise. Le résultat des émulateurs ne remplace pas ce contrôle.
