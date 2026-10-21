# Horaires — validation et publication sûres

Le bouton **Vérifier** ne fait aucune écriture. Il contrôle le brouillon et les sources actuellement chargées dans le navigateur. Le rapport devient périmé dès que la version, ses entrées ou les sources changent. Ce contrôle aide à corriger les erreurs, mais ne constitue pas une autorisation de publication.

**Valider** et **Publier** appellent `manage-teacher-grading` avec un jeton Firebase Auth. Le serveur vérifie le rôle Directeur des études, l'établissement, l'année active et l'état du compte dans une transaction Firestore. Il relit les entrées et toutes les sources utiles dans cette même transaction, applique le validateur partagé et refuse une lecture tronquée. La validation enregistre une empreinte des sources et du brouillon. La publication exige que cette empreinte corresponde encore, puis désactive l'ancienne publication et active la nouvelle dans une seule transaction. Un verrou documentaire par établissement/année sérialise les opérations. Les requêtes avec le même identifiant d'opération peuvent être rejouées sans double transition. En cas de conflit, la réponse demande de recharger et réessayer ; l'ancienne publication reste active.

Le périmètre est l'établissement et l'année scolaire entiers. Un Directeur limité à certaines sections ne peut pas publier si une affectation active concerne une autre section. Les transitions `DRAFT → VALID → PUBLISHED` ne sont plus autorisées par le SDK client ; seules les transactions du serveur (Admin SDK) les réalisent. Les règles continuent de protéger les créations de brouillon et leurs entrées. Le nouveau document `timetablePublicationStates` est inaccessible aux clients.

## Compatibilité et ordre de déploiement

Déployer l'API compatible avec le nouveau protocole et les règles Firestore restrictives de manière coordonnée, puis le frontend. Ne jamais publier le frontend avant l'API. Une version `VALID` créée avec l'ancien mécanisme n'a pas d'empreinte de validation : sa publication est refusée de façon sûre ; il faut créer et valider un nouveau brouillon. Les versions déjà `PUBLISHED` et leurs entrées ne sont ni supprimées ni réécrites. Si plusieurs anciennes publications sont simultanément actives pour le même établissement et la même année, le serveur refuse toute nouvelle publication ; une résolution des données nécessite un traitement distinct et autorisé.

Avant promotion, vérifier sur Staging avec des données fictives : brouillon, rapport, validation, publication, lecture Enseignant, conflits de sources, permissions interétablissements, annulation et reprise réseau. Les tests de règles et de transaction doivent passer. Aucun essai ne doit modifier un horaire d'établissement réel.

## Retour arrière

En cas d'incident, suspendre les nouvelles validations/publications en conservant les règles restrictives et l'API transactionnelle tant que le frontend peut les appeler. Réinstaller seulement un frontend compatible si nécessaire. Ne pas rétablir les anciennes règles autorisant les transitions directes depuis le navigateur : cela rouvrirait la publication non atomique. Ne pas restaurer automatiquement des documents d'horaires, ni désactiver une publication existante. Toute correction historique exige un inventaire, une sauvegarde et une autorisation distincte.
