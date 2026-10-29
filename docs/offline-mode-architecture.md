# Mode hors connexion — contrat de sécurité (étape 1)

## État de livraison — 29 octobre 2026

Les sections ci-dessous décrivent l'historique de conception ; leurs mentions « pas encore implémenté » ne décrivent plus l'état courant. Les flux notes, présences, inscriptions et paiements provisoires, la file chiffrée et la session locale de huit heures sont implémentés.

La chaîne reste volontairement empilée : `main` → `codex/offline-secure-20261027` → PR #34 (`codex/offline-staging-e2e-20261028`). La Production `8585b8bf63e557892e322869d54d64876dddf9a9` a été intégrée dans la base, puis cette base dans #34, sans fusion de PR vers main. Le fichier local `.env.staging` de la base n'a pas été inclus dans ces commits.

### Vérifications après intégration

Les CI du candidat intégré doivent confirmer TypeScript, lint, tests applicatifs/Functions, build Staging et règles Firebase. Le job `offline-emulator-e2e` rejoue les cinq parcours existants : arrêt complet/réouverture Chromium avec brouillon, conflit de maximum, présence avec réponse serveur perdue, inscription idempotente, paiement provisoire et conflit tarifaire. Le workflow `authenticated-emulator-ci` vérifie également les parcours options/élèves et autres entrées de caisse désormais présents dans main.

Les règles Firestore, Storage et index du candidat sont identiques à ceux de ce main : aucun nouveau déploiement de règles ou d'index n'est requis pour le hors connexion. Les accusés serveur restent interdits aux écritures directes du client. La réussite sur émulateurs ne vaut pas recette Firebase hébergé/Vercel ; cette dernière reste distincte et dépend de l'identité WIF Staging autorisée.

### Première activation et procédure de livraison

Après autorisation, recibler la PR #34 existante vers `main` : sa tête contient déjà toute la branche de base et le main intégré. Vérifier le diff complet et les contrôles obligatoires avant sa fusion ; ne pas fusionner simplement #34 dans sa base en croyant avoir livré main. Ce reciblage évite une nouvelle PR et préserve la branche de base. Vérifier les CI du SHA final. Préparer un déploiement Vercel non promu contenant simultanément frontend, API compatibles et Service Worker. Vérifier le SHA, la configuration Firebase, `offline-assets.json` et ses assets avant promotion. Ne pas réinitialiser les bases IndexedDB ni les clés de chiffrement.

La première connexion et le préchargement doivent réussir en ligne sur l'origine finale ; le cache d'un Preview ne prépare pas l'origine Production. L'utilisateur doit conserver le même navigateur/profil. Une expiration de session bloque les opérations, sans supprimer la file. L'effacement volontaire des données du navigateur, l'éviction par l'OS, le mode privé et un appareil compromis restent des risques ; les tests Chromium ne démontrent pas le comportement de tous les appareils mobiles.

### Retour arrière préservant les saisies

Ne pas promouvoir aveuglément une ancienne application dépourvue de lecture de la file hors connexion. Ne jamais effacer IndexedDB, remplacer ses clés ou supprimer les accusés d'idempotence/écritures financières serveur. Préserver les opérations `LOCAL_PENDING`, `SYNCING`, `RETRYABLE_ERROR`, `CONFLICT` et `REJECTED`, ainsi que leurs identifiants. Un accusé perdu doit être résolu en réutilisant le même identifiant, jamais par une nouvelle opération. Aucun reçu définitif ni encaissement supplémentaire ne doit découler d'une proposition locale.

En cas d'incident, privilégier un correctif conservant le schéma local, l'accès à la file et les API de réconciliation. La suspension ciblée de la synchronisation doit elle aussi préserver ces éléments ; aucun interrupteur d'urgence distant préexistant n'est supposé. Un retour à un ancien frontend peut rendre la file temporairement inaccessible, même s'il ne l'efface pas : il n'est pas un retour arrière sans risque. Aucune migration ou purge automatique ne fait partie de cette livraison.

## Historique de conception

## Périmètre actuel constaté

- L'authentification Firebase conserve sa session dans IndexedDB (`src/firebase.ts`) ; cela ne donne **pas** une autorisation de travail hors ligne. Le serveur doit revérifier le jeton, le profil actif, le rôle, l'école et l'année à chaque synchronisation.
- Les cotes de l'enseignant sont chargées et enregistrées par `manage-teacher-grading` (`src/modules/teacher/teacherGradingService.ts`, `api/_lib/teacherGrading.js`). Les écritures existantes sont des lots Firestore, sans clé d'idempotence ni précondition de version pour un brouillon conservé plusieurs jours. Elles ne peuvent donc pas être simplement rejouées après reconnexion.
- La saisie manuelle des présences est aujourd'hui dans le module Discipline (`src/modules/discipline/DisciplinePortal.tsx`) ; il n'existe pas encore de contrat serveur de saisie hors ligne pour l'Enseignant. Le mode hors ligne ne doit pas contourner ce périmètre.
- Les paiements scolaires passent par `manage-financial-transaction` et une transaction avec clé d'idempotence (`api/_lib/financialTransactions.js`). Le montant, le solde, la devise, le rôle et l'année doivent néanmoins être revalidés au serveur. Aucune quittance n'est créée localement.
- Le Service Worker (`public/sw.js`) met en cache le shell de l'application, pas les données pédagogiques ou financières. Les lectures sensibles ne doivent pas entrer dans un cache HTTP partagé.

## Frontière lecture / écriture

| Domaine | Lecture déconnectée envisagée | Préparation locale | Confirmation serveur obligatoire |
| --- | --- | --- | --- |
| Cotes | Dernière liste explicitement téléchargée et minimisée (élèves, affectation, maxima, période) | Cotes non publiées dans une période encore ouverte lors du dernier contrôle | Oui : statut actuel, affectation, maxima, version de chaque cote et période |
| Présences | Dernière liste de classe autorisée et minimisée | Date, élève, séance, statut | Oui : rôle, classe, année, présence existante et identité de l'élève |
| Paiements | Dernières informations affichées, marquées « potentiellement anciennes » | Proposition provisoire sans quittance | Oui : toutes les règles financières et confirmation atomique |
| Inscriptions | Classes et options préchargées avec leurs identifiants stables | Fiche minimale d'élève par Administrateur ou Secrétaire | Oui : doublons, école, année, classe, option et matricule définitif |

Les données non préchargées ne sont pas promises hors ligne. Les résultats publiés, les soldes et les reçus affichés hors ligne ne sont jamais présentés comme actuels.

## File locale et machine à états

Une file IndexedDB distincte de la persistance Firebase contient uniquement le strict nécessaire. Une opération possède : identifiant aléatoire stable, type, version du schéma, UID, école, année, horodatage local, expiration, empreinte des données de base, payload minimal, état, compteur d'essais et dernier résultat. La file est partitionnée par UID et école. Aucun jeton d'authentification, secret, numéro de carte ou URL de téléchargement n'y est stocké.

États : `LOCAL_PENDING` → `SYNCING` → `SERVER_CONFIRMED` ; un refus non temporaire mène à `CONFLICT` ou `REJECTED`, un incident réseau à `RETRYABLE_ERROR` puis `LOCAL_PENDING`. Un accusé perdu permet de renvoyer le **même identifiant** ; `SYNCING` au redémarrage est repris comme demande de statut, jamais comme succès présumé. `SERVER_CONFIRMED` n'est affiché qu'après réponse serveur vérifiée. Une opération rejetée reste visible jusqu'à résolution explicite, sans suppression silencieuse.

La file ne lance aucun envoi en arrière-plan garanti. La synchronisation se fait seulement quand l'application est ouverte, avec session active, et sur demande ou reconnexion. `navigator.onLine` n'est qu'un signal ; le résultat réseau réel fait foi. Un verrou local empêche deux onglets du même profil de lancer le même envoi, mais la garantie finale de non-duplication doit être **serveur**.

## Contrat serveur requis avant activation métier

1. Le client envoie `operationId`, version de schéma, école, année, type, données et versions de base. Les références sont des identifiants, pas des libellés ou des calculs pré-validés.
2. Le serveur authentifie et réévalue le profil courant, l'école, l'année active, l'affectation et les règles propres à l'opération. Il compare les versions/horodatages des documents concernés **dans une transaction** lorsque nécessaire.
3. Le serveur crée un accusé durable indexé par `(UID, école, operationId)` dans la même transaction que les effets métier, avec empreinte du payload. Le même ID et le même payload renvoient le même résultat ; un payload différent sous le même ID est refusé.
4. Les cotes et maxima changés, les périodes fermées, les élèves transférés et les présences déjà modifiées donnent un conflit explicite, jamais un écrasement. Le client garde la saisie locale pour décision humaine.
5. Un paiement provisoire réutilise les contrôles financiers transactionnels existants ; avant l'appel serveur, il n'augmente aucun solde et n'a ni numéro ni PDF de quittance. Si la caisse a physiquement reçu les fonds mais que le serveur refuse l'opération, le dossier reste visible pour traitement comptable humain.

## Confidentialité et durée de vie

Le navigateur ne constitue pas un coffre-fort. IndexedDB peut être effacé par l'utilisateur, le navigateur ou le système ; un appareil partagé ou compromis peut exposer les données. Les opérations sensibles devront être chiffrées avec Web Crypto et une clé non exportable par partition, mais cela ne protège pas contre un script malveillant exécuté sur la même origine. Une politique de rétention bornée et un avertissement avant nettoyage sont nécessaires. Au changement de compte/école, aucune opération de l'ancien périmètre ne doit être affichée ni synchronisée ; au retour, l'utilisateur voit ses opérations encore en attente. Une session expirée bloque l'envoi, pas la conservation de la file.

## Accès à Acadéa après fermeture du navigateur

La session Firebase conservée dans IndexedDB ne suffit pas à démontrer la réouverture hors connexion. Le Service Worker actuel sert le shell en cache, mais le bootstrap de `src/services/auth.ts` dépend du profil Firestore et d'un délai réseau ; aucune autorisation hors ligne limitée dans le temps n'est encore implémentée. Avant l'étape 2, il faut tester sur Staging une première connexion en ligne, la fermeture complète du navigateur, la réouverture sans réseau avec données préchargées, la déconnexion et le refus d'une session expirée. L'accès hors ligne ne peut pas être déclaré disponible aujourd'hui.

## Plan séquentiel actualisé

1. Architecture, sécurité et accès hors connexion.
2. Notes scolaires.
3. Présences et absences.
4. Inscriptions d'élèves.
5. Interface, supervision et résilience.
6. Paiements scolaires provisoires.
7. Validation globale.

L'inscription doit réutiliser le formulaire existant, conserver l'ID stable de l'option même si son nom change et obtenir un ID/matricule définitif seulement après validation serveur idempotente. La PR #31 suspendue n'est ni modifiée ni fusionnée dans ce chantier.

## Validation de l'étape 1

Les tests Chromium locaux `e2e/offline-queue-local.spec.ts` et `e2e/offline-access-local.spec.ts` vérifient le chiffrement, la persistance, l'isolation des périmètres, les transitions interdites, l'expiration de la session locale et son effacement à la déconnexion. L'application possède désormais une session locale limitée à huit heures, affichée seulement si une session Firebase déjà conservée sur cet appareil correspond au dernier profil vérifié. Cette session ne donne aucun droit d'écriture distant. Le test de réouverture de l'application entière avec Auth/Firestore émulés reste nécessaire : le lancement de l'émulateur Firestore local a expiré avant l'ouverture du port 8080 dans cet environnement. **Verdict de l'étape 1 : PARTIELLEMENT VALIDÉE** ; aucune recette authentifiée Staging ni aucun flux métier hors connexion n'est annoncé comme réussi. La nouvelle instruction du propriétaire autorise à poursuivre les développements indépendants des étapes suivantes malgré cette limite, sans déclarer l'étape 1 entièrement validée. La PR #31 suspendue n'est ni base ni dépendance de cette architecture.
