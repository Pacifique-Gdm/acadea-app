# PR #44 — recette complémentaire hébergée du 5 novembre 2026

Version initialement testée : `d0e6e3197d1824ff77043a6d6ff990a4cfeb7f53`, sur `acadea-staging` uniquement.

## Preuves acquises sans rejouer les contrôles antérieurs

- Quatre écoles fictives : CDF/USD, indépendantes/coordonnées. Créations par le vrai formulaire Administrateur pour une et plusieurs classes, montants persistés exacts, classe non sélectionnée inchangée, réessai idempotent. Défauts initiaux 10 000 CDF / 100 USD vérifiés.
- Montants positifs jusqu'à 12 500 000 CDF acceptés ; zéro, négatif, texte et précision excessive refusés par l'API.
- Recherche de bénéficiaires, trois sélections, retrait et anti-doublon vérifiés dans Chromium hébergé.
- Échec partiel réel provoqué en désactivant un élève fictif juste avant sa requête serveur : deux décisions préservées, reprise avec les mêmes clés, trois décisions finales, un événement de création par décision.
- Confirmation sociale absente/incorrecte/incomplète refusée ; confirmation exacte acceptée ; utilisateur non autorisé refusé ; recalcul et audit vérifiés.
- Export authentifié de 45 bénéficiaires : quatre pages A4 paysage rendues et inspectées intégralement. En-têtes répétés, montants et colonnes lisibles, aucune coupure ni page blanche.
- Coordinateur et Sous-coordinateur : montants exacts USD/CDF vérifiés séparément, six élèves du périmètre, exonération et réduction partielle, élèves sans paiement, refus de l'école extérieure, filtres CDF seul/USD seul.
- Neuf largeurs Chromium (320 à 1440 px) : formulaires des frais, trois onglets sociaux, Dashboard Administrateur, Coordinateur et Sous-coordinateur sans débordement horizontal.

## Défaut applicatif confirmé et correction ciblée

Un paiement historique fictif de 2 000 CDF est confirmé et rejoué sans doublon. Les dashboards Coordination ouverts conservent pourtant 8 000 CDF au lieu de 6 000 CDF : le modèle de supervision était chargé par `getDocs` sans abonnement aux transactions. Le hook des arriérés ne pouvait donc pas observer ce changement.

Correction : abonnements Firestore aux collections financières et scolaires déjà autorisées, dans le même périmètre d'écoles et avec les mêmes limites de lots (6 principal / 3 délégué). Seuls les changements confirmés serveur invalident le modèle existant ; regroupement des événements, chargements sérialisés, désabonnement à la sortie, erreurs explicites. Aucun calcul, rôle ou règle Firebase modifié.

Trois tests dédiés couvrent les écritures non confirmées, le regroupement des événements, les périmètres, les erreurs et la libération des abonnements. La validation hébergée du correctif doit être rattachée au SHA final dans le rapport de PR.

## Incidents de recette (pas des défauts de l'application)

- HTTP 429 lors de la préparation rapide de 45 décisions : reprise espacée respectant Retry-After, sans modification du limiteur.
- HTTP 403 sur une tentative d'encaissement avec Administrateur : corrigé en utilisant deux Caissiers fictifs, sans élargissement de droits.
- Attente erronée de `/dashboard` pour Coordination : route effective `/coordination`, scénario corrigé.
- La protection système a exigé une traçabilité et une clôture explicites des décisions ; script complété avant reprise autorisée.

## Clôture et limites

Neuf comptes fictifs désactivés, claims retirés et sessions révoquées après chaque tentative ; nouvelles connexions refusées. Années fictives archivées et décisions expirées via la réconciliation applicative normale, avec audit conservé. Écoles, coordination, sous-coordination et rattachements désactivés. Documents conservés inventoriés dans le manifeste ; aucune déclaration de « zéro résidu ».

Preuves locales ignorées par Git : `diagnostics/pr44-final/` (résultats, manifeste sans mot de passe, captures et PDF).

WebKit/Safari et téléphones physiques non validés. Aucun Linux local installé pour une reprise WebKit. Les cas supplémentaires de devise invalide et la matrice responsive complète du rapport financier ne sont pas encore prouvés par cette recette.

Aucune fusion, aucun changement IAM, aucune modification Production, aucune suppression de données réelles ni de file IndexedDB.
