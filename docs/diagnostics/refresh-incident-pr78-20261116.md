# PR #78 — incident d’actualisation, 16 novembre 2026

## Périmètre et faits Production

- Branche : `codex/refresh-scope-recovery-20261116`. Travail isolé dans un worktree ; travail local antérieur préservé.
- Production observée : `1f79a199b86777ec142cced8cba5991fb5fc7f59`, déploiement `dpl_7Q9Bjjkgoyf5sjjp9yytkvFVcMqE`.
- Session autorisée Administrateur C.S LUMBULA, année 2027–2028. Actualisation du Menu, mise à jour PWA normale puis actualisation du Dashboard : aucun bandeau reproduit. Les chiffres et le bouton PDF sont revenus disponibles.
- Console : avertissement de transport Firestore `WebChannelConnection ... Listen ... transport errored` à 04:47:53 UTC. Aucun code de quota ou de permission capturé pendant ces observations. Cet avertissement seul n’identifie pas une collection ni la cause du ralentissement intermittent.
- La vérification ultérieure de l’outil de navigateur interactif a expiré : pas de nouvelle preuve Production revendiquée.
- Aucune donnée réelle modifiée, aucun nettoyage de file IndexedDB, aucune modification de règle, d’index, de Function ou de facturation.

## Facturation — lecture seule

`gcloud billing projects describe` : `billingEnabled: true` pour **acadea-production** et **acadea-staging**, chacun rattaché à un compte de facturation. `gcloud billing accounts describe` : compte `open: true`. Le rattachement actif correspond au forfait Blaze selon la documentation officielle Firebase. Aucune valeur de paiement ou identité du compte de facturation n’est publiée ici.

- Paiement/règlement de la dette : non vérifié.
- Suspension active : non constatée dans les informations accessibles.
- Requête de journaux Firestore/Rules sur les dernières 24 heures (erreurs, statuts 7/8) : aucune entrée retournée. La couverture de ces journaux ne permet pas d’exclure toutes les erreurs clientes ou un incident passé.
- Le message exact signalé provient du délai **client de 15 secondes**, pas d’un diagnostic de facturation. Aucun lien avec Blaze démontré.

Source : <https://firebase.google.com/docs/projects/billing/firebase-pricing-plans>.

## Défauts démontrés et corrections

1. L’ancien délai rejetait la promesse et perdait sa réponse tardive. La lecture n’était pas annulée côté Firebase mais son succès n’était plus appliqué.
2. Un groupe secondaire pouvait retenir les données financières déjà reçues. Les états financier, messages, valves, présences et historique sont maintenant indépendants.
3. L’ouverture et le changement d’année utilisent aussi le suivi borné au compte et à l’année. Les réponses d’un contexte quitté sont ignorées.
4. Une réponse provenant uniquement du cache ou contenant des écritures locales non confirmées n’autorise pas le PDF financier. Les PDF Dashboard, Rapport et Contrôle sont protégés.
5. Les lectures temps réel financières ne remplacent pas les chiffres confirmés par un cache ou par la moitié seulement des deux sources de paiements. Une réponse ponctuelle tardive ne remplace pas un snapshot serveur plus récent.
6. L’avertissement secondaire reste dans l’onglet concerné. Le succès réel de la même lecture le retire, sans minuteur d’effacement, allongement du délai ou boucle de requêtes.

La collection responsable du symptôme intermittent **en Production reste inconnue**, faute de reproduction. La simulation réseau hébergée démontre le comportement et sa récupération, pas la cause réseau historique de C.S LUMBULA.

## Preuves de validation

- Tests locaux ciblés : réponses tardives, cache, écritures en attente, refus de permission/quota, isolation de session/année, double source de paiements et gardes PDF.
- CI `43826340537` sur `018fcdd5c98a5e32c520f65a86114aa539ffef8c` : 2 955 tests applicatifs, 160 tests Functions, TypeScript, lint, build et règles PASS. Le job des règles a été relancé une fois après expiration de 5 s d’un test transactionnel concurrent sur émulateur ; succès sans modifier les règles ni retirer les assertions.
- CI Chromium authentifiée `43826340506` : PASS. Parcours hors connexion sur émulateurs : PASS.
- Staging hébergé : `ae2283753411c300268219ca53b13736c0fa7928`, `dpl_G4iL2i9uDYR4tCmPATsiTEUnmncV`, <https://acadea-staging.vercel.app/>. Environnement frontend et API confirmé `acadea-staging` par le build officiel.
- Le contenu applicatif du SHA hébergé et de `018fcdd` est identique ; seules des assertions de tests diffèrent.
- Authentification réelle, rafraîchissement normal, PDF disponible : PASS.
- Requête secondaire retardée, sans réponse simulée : `client-timeout` à environ 15 004 ms ; réponse Firebase réelle à environ 22 376 ms ; PDF financier disponible, avertissement visible seulement dans Message puis retrait automatique : PASS.
- Coupure réseau : lecture `students` renvoyant `unavailable`/cache non confirmé ; données conservées, PDF suspendu, avertissement borné aux onglets touchés : PASS.
- File locale créée par le mécanisme normal PWA ; retour en ligne, confirmation serveur, une seule inscription après deux actualisations, PDF réautorisé : PASS.
- PDF réel téléchargé depuis l’aperçu intégré ; ses trois pages ont été rendues et vérifiées visuellement : deux élèves (une fille et un garçon), 200 USD exigibles, 0 encaissé, 200 USD restant à payer, sans page blanche ni texte tronqué. Les deux premiers échecs du scénario provenaient du blocage du Service Worker dans le test, puis de l’attente erronée d’une popup au lieu de l’aperçu intégré. La fixture initiale a aussi été complétée avec son sexe pour vérifier la cohérence des compteurs. Aucune protection applicative n’a été contournée.
- Les quatre comptes fictifs créés pendant les essais sont désactivés, sessions révoquées, claims vidés et écoles neutralisées. Documents fictifs conservés et inventoriés, aucune suppression. Preuves locales dans `diagnostics/refresh-recovery-hosted/`, hors Git ; inventaire indépendant en lecture seule via `scripts/verifyRefreshFixtureClosure.mjs`.

## État de livraison au moment de la recette

Vercel a refusé les nouveaux builds des projets `acadea-app` et `acadea-staging` avec le statut officiel **« Deployment rate limited — retry in 24 hours. »** Aucun contournement, changement d’offre ou nouvelle identité n’a été utilisé.

À la fin de la recette, PR non fusionnée et Production inchangée. L’attribution automatique des domaines Production était déjà désactivée ; sa configuration et la protection Preview sont inchangées. Le propriétaire a ensuite signalé la levée de la limite : la reprise doit confirmer ce fait par un build réel et les contrôles de livraison, sans affaiblir les protections.

Après rétablissement du quota : vérifier la tête de PR et les contrôles obligatoires, construire le SHA final, confirmer son identité fonctionnelle avec la recette, fusionner par le circuit protégé, attendre les CI de main puis promouvoir uniquement son build READY. Le secours reste `dpl_7Q9Bjjkgoyf5sjjp9yytkvFVcMqE`. Aucun changement Firebase ni migration requis. Refaire ensuite le parcours Production en lecture seule, sans prétendre que le symptôme intermittent était reproduit avant correction.
