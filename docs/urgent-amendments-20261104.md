# Amendements urgents — état vérifiable du candidat

Base : `a8b44c0d833a2b1ec164f020be7aa7e6363e911a` (main).
Branche : `codex/acadea-urgent-amendments-20261103`.

## Corrections

- Cause CDF reproduite : après affichage de `1 000`, une frappe produit `1 0000` ; le parseur strict le conservait, puis `Number` renvoyait `NaN`. Le composant utilise maintenant une normalisation des frappes, distincte de la validation stricte des collages. Précision monétaire/API inchangée.
- Création de frais : défaut CDF `10000`, USD `100`, édition conservant le montant existant. Test émulateur existant enrichi pour saisir réellement les chiffres et vérifier le défaut CDF.
- Carte Arriérés dans le Dashboard partagé Administrateur/Caissier et Coordination/Sous-coordination. Réutilisation des API canoniques des dettes historiques, lots de 50, devises séparées, aucune assimilation du solde courant à une dette historique, chargement/erreur explicites et actualisation sur changement des paiements confirmés.
- Agrégation Coordination : devise annuelle prioritaire sur la devise actuelle de l'école, fallback historique préservé.
- Formulaire social commun : onglets égaux Bénéficiaires/Nouveau/Historique, filtres cumulés avec retrait individuel, PDF, recherche unique et sélection multiple, décisions individuelles et clés de réessai conservées en cas d'échec partiel.
- Confirmation exacte de modification contrôlée côté serveur. Versions, transactions et autorisations existantes conservées.
- Actions Détails/Annuler retirées de la liste ; ancienne logique d'annulation serveur conservée. Mentions techniques Engagement/Tiers retirées de cette interface, sans migration des données.
- Rapport financier : panneaux Paiements/Dépenses/Autres entrées de caisses verticaux.

## Preuves locales obtenues

- 98 tests unitaires ciblés PASS (argent, décisions sociales, agrégations Coordination, arriérés existants).
- TypeScript PASS et lint ciblé PASS avant les derniers ajouts de scénarios ; contrôle final relancé.
- Build Vite mode `test` PASS ; ce n'est pas un build hébergé Staging.
- Chromium : 21 scénarios sociaux PASS, 1 scénario monétaire PASS, 1 scénario supplémentaire d'échec partiel/rejeu groupé PASS. Services sociaux simulés pour ces tests de composant : ils ne prouvent pas une authentification Firebase hébergée.
- Neuf largeurs contrôlées : 320, 360, 375, 390, 414, 768, 1024, 1280, 1440.
- PDF locaux : génération et document multipage contrôlés automatiquement ; pas encore de revue visuelle humaine page par page dans cette exécution.
- WebKit : expiration lors de la création de `page`, avant interaction. NON VALIDÉ. Aucun téléphone physique testé.

## Contrôles encore obligatoires

- CI du SHA publié et scénarios Auth/Firestore émulateurs sur le candidat final.
- Build Vercel Staging : les variables sensibles sont masquées dans l'export CLI ; ne pas interpréter les valeurs masquées comme une configuration Production.
- Recette authentifiée hébergée CDF/USD, classes multiples, quatre rôles, décisions groupées, arriérés et PDF.
- Aucune fixture hébergée créée pour ce candidat à ce stade ; aucune clôture distante à déclarer PASS.
- WIF existant restreint à l'ancienne branche : aucune permission ni condition IAM élargie.

## Déploiement

Le frontend et l'API Vercel doivent être livrés ensemble sur le seul projet `acadea-staging`. Aucun changement Firestore/Storage/Functions n'est inclus dans ce lot. Garder le déploiement Staging précédent, vérifier le SHA et la configuration avant toute création de fixture. Aucune fusion ni publication Production autorisée dans cette mission.

Verdict actuel : candidat en cours de validation, **pas prêt pour une livraison Production**.
