# Répartition : prévu annuel et nouvelle configuration après activation

## Contrat du candidat

- Le prévu est l'agrégat serveur des obligations nettes des élèves actifs de l'année et du périmètre autorisés. Il réutilise les décisions sociales et le moteur de ventilation des encaissements. Aucun paiement n'est nécessaire pour compter une obligation.
- Frais et classe filtrent le prévu ; une période filtre les encaissements, pas l'année prévue. Les soldes restent globaux à la rubrique : ouverture + encaissements cumulés - dépenses nettes cumulées.
- Une configuration déjà publiée ne peut pas être remplacée en état ACTIVE/PAUSED. Un frais non réparti peut être préparé puis publié explicitement, avec audit et reçu d'idempotence transactionnels.
- Les anciens encaissements et leurs ancres restent inchangés. Les nouveaux encaissements confirmés après publication utilisent une ancre versionnée ; une proposition locale antérieure à cette publication, mais postérieure à l'activation, suit cette règle lorsqu'elle est confirmée. Le rejeu d'un paiement confirmé conserve son résultat initial.
- Deux nouvelles Functions en europe-west1 invalident le prévu par métadonnée école/année. Elles n'écrivent aucun élève, paiement, solde ni mouvement. Le panneau ne relit l'école que si la révision change ; l'export demande un instantané serveur récent.
- Les signaux restent inaccessibles aux clients Firestore ; l'API contrôle leur périmètre. Aucun changement de règles ni d'index n'est prévu.
- Le Caissier ne réinitialise sa saisie qu'après confirmation serveur ou accusé durable de la file locale. La file n'est jamais supprimée. Le Super Administrateur utilise le bouton de déconnexion commun, dans un bloc isolé.

## Preuves locales

- 218 tests ciblés allocation/synchronisation réussis, puis 23 tests de phase 2 réussis après ajout des cas de volume (2401 élèves) et d'isolation des signaux.
- 11 tests Functions de déclenchement des invalidations réussis.
- 10 tests de réinitialisation Caissier, file locale et bouton commun réussis.
- TypeScript, lint ciblé, build Staging officiel et build Functions réussis.
- Émulateur Firestore Windows : non exécuté (port 8080 non actif après 60 secondes). La CI Linux doit confirmer les règles ; ce résultat n'est pas remplacé par les tests unitaires.
- Recette hébergée et contrôle visuel : à exécuter sur le SHA déployé ; aucun PASS revendiqué avant les rapports.

## Livraison conditionnelle / retour arrière

1. Conserver les références des déploiements et Functions Staging/Production avant modification ; vérifier le projet exact avant chaque commande.
2. Déployer les deux Functions de signal puis le code candidat sur Staging. Exécuter la recette complète, les quatre PDF, les contrôles de permissions et les nouveaux parcours ; neutraliser et inventorier les fixtures.
3. Fusion protégée et promotion Production uniquement après tous les contrôles requis, CI de main et vérification du SHA du build.
4. Aucun changement de données, d'ouverture ou activation d'école pendant la livraison. Aucun fichier de secrets commité.
5. Après une publication d'un nouveau frais, ne pas revenir à un ancien handler ignorant les ancres versionnées. Privilégier un correctif compatible ; conserver les mouvements, reçus d'idempotence et files IndexedDB. Une défaillance d'affichage ne suspend pas les encaissements.
