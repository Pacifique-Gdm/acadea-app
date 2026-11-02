# PR 40 — tentative hébergée 4

Run 41364945734, candidat 18e446d99dfb91493c942efbaf9e7eda59294e3d.

## Preuves

- Précontrôle SHA/bundle, WIF, installation Chromium, plan et provisioning : succès.
- `kindergarten_admin` échoue en environ deux secondes ; les deux autres scénarios sont ignorés.
- Le rapporteur ne sauvegardait aucune erreur : le message et l'assertion exacts ne sont pas récupérables dans les artefacts.
- L'artefact initial contient le manifeste ; l'artefact final ne contient que le rapport des statuts, sans manifeste ni PDF.
- Playwright utilisait son outputDir par défaut `test-results`, également utilisé pour le manifeste.
- Un test de reproduction utilisant réellement Playwright confirme l'effacement du manifeste au lancement et sa conservation avec un outputDir enfant isolé.
- `beforeAll` appelle `manifest()` avant toute activation/connexion applicative. L'absence du fichier bloque donc les parcours avant les cinq onglets. Aucun défaut métier ne peut être conclu de ce run.
- La clôture retournait silencieusement sans manifeste : son statut GitHub success ne prouve aucune désactivation.

## Corrections

- Output Playwright limité à `test-results/playwright-section-output`.
- Clôture en erreur explicite si le manifeste manque.
- Diagnostic expurgé : catégorie d'erreur et coordonnées source, sans requêtes, jetons ni valeurs d'assertion.
- Recette sur push conditionnée à une variable **de dépôt** `ACADEA_SECTION_READY_SHA` égale au SHA, afin de ne pas demander d'approbation avant les prérequis. Une relance du run ignoré sera nécessaire après préparation.
- Récupération du manifeste initial sauvegardé via workflow protégé ; les variables d'environnement sont vérifiées dans les étapes, pas dans le `if` du job (elles ne sont pas disponibles à cette phase).

## Fixtures à clôturer avant toute nouvelle recette

Identifiant : `e2e-section-efc6aeb0c0204991906866506996b317`.
Deux écoles suffixées `-a` et `-b`, neuf comptes et 47 documents planifiés.
Le provisioning a réussi ; le manifeste initial précède les créations et ses tableaux createdPaths/createdUsers sont donc vides.
La récupération examine tous les chemins et comptes du plan, pas ces tableaux.
Aucune suppression générale : désactivation profils/écoles, comptes désactivés,
claims retirés, refresh tokens révoqués, puis relecture. Les données restent conservées.
À ce stade la désactivation hébergée n'est **pas encore confirmée**.

## Verdict

PR #40 non prête : récupération sécurisée et nouvelle recette authentifiée encore nécessaires.
Les règles, les fonctions métier et leurs permissions ne sont pas modifiées par ce correctif.
