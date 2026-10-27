# Mode hors connexion — contrat de sécurité (étape 1)

Statut : socle de conception. Aucun flux métier hors connexion n'est activé par ce document.

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

Le test Chromium local `e2e/offline-queue-local.spec.ts` a vérifié le rechargement, la lecture après persistance, l'absence de payload en clair dans l'enregistrement, l'isolation de deux périmètres, les transitions interdites, le réessai et la suppression après confirmation. Le lint ciblé et le contrôle TypeScript du module sont réussis. Aucune opération métier n'est activée et aucune donnée distante n'a été touchée. **Verdict de l'étape 1 : NON VALIDÉE** tant que la réouverture de l'application hors connexion, le contrôle de session limitée et la recette authentifiée Staging ne sont pas démontrés. L'étape 2 ne doit pas commencer. La PR #31 suspendue n'est ni base ni dépendance de cette architecture.
