# Répartition générale — candidat du 13 novembre 2026

## Clôture de la recette hébergée — 13 novembre 2026

Cette section remplace les états intermédiaires conservés ci-dessous.

- Candidat Staging testé : `5c6f22012f3d10034b177a35499c448c0705679d`,
  déploiement `dpl_35HhSuJ75UCeeRf4Ba8rRYspa1uW`, Firebase `acadea-staging`.
  Aucun changement applicatif depuis la recette complète du SHA `8da0ab9` :
  seules l'orchestration, les sélecteurs Playwright et la documentation ont changé.
- Recette complète : 20 contrôles fonctionnels PASS et clôture PASS ; quatre PDF,
  12 pages inspectées, équations 0 + 60 - 42 = 18 et 5 + 255 - 0 = 260 USD.
  Les écarts de filtre 56/211 USD, le filtre vide et le total 544 USD concordent.
  Deux écoles USD/CDF ont été activées indépendamment ; une troisième conserve
  sa caisse inactive. Isolation, quatre rôles, pause/reprise, concurrence et
  synchronisation hors connexion avec réponse perdue et rejeu unique : PASS.
- Reprise ciblée du dernier SHA : cinq contrôles PASS, dont justificatif absent
  refusé, reçu serveur concordant accepté, original inchangé et clôture vérifiée.
- Volume hébergé : 3 003 pièces rapprochées, 3 004 sources lues (configuration
  incluse), 382 887 ms pour le rapprochement, 3 002 mouvements distincts et
  3 032 lectures de mouvements pour la consultation complète. p95 : 12 461 ms ;
  maximum : 14 089 ms ; réponse maximale : 47 257 octets. Tous les seuils fixés
  avant l'essai sont satisfaits, sans relèvement. Les lectures SDK sont mesurées
  hors authentification, rate limiting et préparation des fixtures ; elles ne
  remplacent pas les métriques de facturation Google Cloud.
- Les données de volume sont synthétiques et identifiées : 3 001 pièces avant
  activation, 3 001 mouvements après activation, plus deux paiements réellement
  enregistrés via l'API authentifiée. Cela ne représente pas 6 002 paiements saisis
  au navigateur. Le PDF volumineux authentifié est complet : 3 007 + 3 001 - 0 =
  6 008 USD, périmètres filtré/global distincts, deux pages inspectées.
- Les deux comptes de la reprise sont désactivés, leurs sessions révoquées et
  leur école neutralisée. Les 6 004 paiements et 3 002 mouvements fictifs sont
  conservés dans l'inventaire ; aucune donnée financière n'a été supprimée.
- CI du SHA testé : `43479307549` et `43479307499`, contrôles obligatoires PASS.
  Le job Staging optionnel ignoré n'est pas compté PASS ; les preuves hébergées
  ci-dessus proviennent de la recette exécutée directement sur le site réel.
- Livraison autorisée conditionnellement : vérifier les CI du commit intégré et
  le build Production, créer les deux index nécessaires, publier les gardes
  Firestore compatibles puis promouvoir manuellement. Aucun changement Storage
  ou Functions n'est requis. Les sauvegardes du ruleset actif et du déploiement
  `dpl_8VqkjKBujPUbBJR9mHkMZc2FDXN8` sont conservées. Après une activation réelle,
  privilégier pause d'établissement et correctif compatible, jamais un ancien
  serveur ignorant les imputations. Aucune école réelle n'est activée par défaut.

## État vérifié au SHA applicatif `8da0ab97297a28611543cac2990631211f66354b`

- CI 43449137298 : application/Functions, règles Firebase et E2E hors connexion
  PASS. 2 745 tests applicatifs, 149 tests Functions, 451 règles Firestore (1 test
  ignoré, non compté PASS), 55 règles Storage. Le job hébergé optionnel est ignoré.
- CI Chromium authentifiée 43449137307 : PASS (19 parcours métier, 1 parcours
  de fluidité et 29 assertions préparatoires). Aucun échec n'est masqué.
- Staging `dpl_ExVvJPRRMYXjVrhHc6ecSTFxRtLu` : SHA exact, règles candidates et
  index de registre READY vérifiés avant les fixtures.
- Recette hébergée : deux écoles USD/CDF activées indépendamment, école inactive,
  permissions, concurrence, compensations, tiers payeurs et réouverture hors ligne
  validés. Les quatre PDF (12 pages) sont générés, rapprochés et inspectés visuellement.
  Les équations 0 + 60 - 42 = 18 et 5 + 255 - 0 = 260 USD restent exactes.
- La partie historique/volume n'est PAS encore validée. Deux sélecteurs exacts
  `getByLabel` englobaient le texte des options ou la valeur du textarea ; une
  reproduction Chromium et la trace hébergée le confirment. Le scénario utilise
  désormais leurs rôles et noms accessibles, sans modification de permissions.
- Les comptes de la recette complète ont été neutralisés. Une tentative locale
  interrompue pendant la préparation a été récupérée depuis son manifeste : aucun
  compte Auth créé, 10 périmètres fictifs neutralisés, aucun document supprimé.
  La recette ciblée utilise maintenant seulement une école et deux comptes.
- Aucune fusion/promotion n'est autorisée tant que la justification historique,
  les mesures de volume et la clôture de la reprise ne sont pas toutes PASS.

## Reprise : lots, registre et historiques (validation en cours)

Le candidat local remplace désormais la transaction exhaustive par un travail
serveur reprenable de 100 sources par lot. Chaque lot conserve son curseur,
sa séquence et son empreinte ; un rejeu après réponse perdue ne recompte rien.
Les révisions des deux caisses et des configurations/justificatifs invalident
le calcul si elles changent. Les versions approuvées sont conservées en documents
individuels liés au rapprochement ; préparation, approbation et activation finales
ne relisent ni toutes les pièces ni toutes les configurations.

Le registre utilise un curseur de document, 100 mouvements et une sentinelle par
page, avec empreinte commune des gardes et soldes. Le client refuse tout export
incomplet, doublonné ou dont la somme diffère des soldes. Les pages suivantes ne
rechargent pas les métadonnées de tous les tarifs.

L'Administrateur peut consulter les pièces bloquantes et soumettre un reçu serveur
ou un paiement de personnel lié. Le serveur contrôle école, année, montant,
identité d'opération, devise et réutilisation ; la décision est auditée sans
réécriture de la source. Une pièce absente, modifiée ou non concordante est refusée.

Vérifications de cette reprise : 178 exécutions ciblées PASS (12 fichiers, dont
réexécutions dues à la fixture importée), TypeScript et lint PASS. Le build Staging
a réussi avec les paramètres officiels issus de GitHub ; les derniers ajustements
d'interface restent soumis à la CI du commit publié. L'émulateur local n'a pas
terminé son démarrage : il n'est pas compté PASS ; la CI Linux doit valider les
règles. Le nouvel index du registre est en cours de création sur Staging uniquement.

Les seuils hébergés sont fixés dans `fee-allocation-volume-gates.md`. La recette
du nouveau code et les mesures de volume ne sont pas encore exécutées. Les preuves
ci-dessous concernent l'ancien candidat et ne valident pas ces modifications.
Aucune fusion ni promotion Production n'a eu lieu pendant cette reprise.

Base : `6ab7bc9e5f4cf81c9cebb1de75d15ade4a15dc94` (PR #57).
Branche : `codex/fee-allocation-general-activation-20261113`.

## Livré dans le candidat, pas en Production

- Éligibilité serveur par projet, école active, année active, devise et profil
  Administrateur stocké. Aucun nom/identifiant d'école en dur. Aucune activation
  implicite au déploiement. Les fixtures gardent leurs contrôles d'isolement.
- Parcours Administrateur : publication d'une version préparée, consultation des
  pièces, saisie explicite de l'ouverture et de la caisse constatée, approbation,
  confirmation, pause et reprise motivées. Une réponse perdue conserve la même
  clé de demande ; aucun succès optimiste.
- Une modification des pièces/configurations invalide l'approbation. Le compte
  qui confirme doit être celui qui a approuvé. Les consultations de préparation
  sont réservées à l'Administrateur, sans données d'élèves dans les preuves.
- Liaison des versions approuvées aux seuls encaissements futurs de l'année.
  Les anciens encaissements restent dans l'ouverture ; ils ne sont ni modifiés
  ni ventilés une seconde fois. Les dettes d'anciennes années ne récupèrent pas
  arbitrairement une nouvelle configuration.
- Pagination des pièces et mouvements, sans troncature à 200/2 000 lignes.
  Archivage des preuves en pages serveur, avec refus en cas de preuve incomplète.
- Conservation de la présentation PR #57 : « Selon le filtre » distinct de
  « Situation globale », avec ouverture + recettes cumulées − dépenses nettes.

## Preuves locales

- 157 exécutions Vitest ciblées réussies (11 fichiers ; certains fichiers
  réutilisent encore une fixture définie dans une suite de tests).
- Cas volumineux : 1 201 pièces d'ouverture ; 2 401 mouvements, sans troncature.
- Ancien paiement 30 + nouvel encaissement 70 : ouverture 24 et nouvelles recettes
  56 dans une rubrique à 80 %, soit 80 disponibles ; rejeu sans second mouvement.
- Refus : autre école/rôle, profil suspendu, preuve absente, approbation périmée,
  page répétée/interrompue et version ancienne non liée au rapprochement.
- TypeScript, lint et build Staging réussis sur le lot local initial ; toute
  modification ultérieure reste soumise aux contrôles de son SHA final.
- Au SHA `9423edc0cde024589c7e04bc722214c2bf8ceb64` : les CI
  `application-and-functions`, `firebase-rules`, `offline-emulator-e2e` et
  `authenticated-emulator-e2e` sont PASS. La recette hébergée optionnelle de la
  CI reste SKIPPED ; elle n'est pas comptée comme un succès.
- Cinq tests de règles ciblés réussis sur émulateur, dont le refus de lecture et
  d'écriture clientes des pages de preuves d'ouverture.

## Recette hébergée du candidat

- Staging sert `9423edc0cde024589c7e04bc722214c2bf8ceb64`, déploiement
  `dpl_Fd6R8YM6w4qSaQ9N5pLMDZUhVi6s` ; Firebase `acadea-staging` confirmé.
- Première tentative : contrôles API de l'école inactive, activation idempotente,
  encaissements concurrents, paie, dépenses, refus interétablissements, cas
  sociaux, arriérés et compensations réussis. L'assertion navigateur de publication
  a expiré à cinq secondes. Une lecture du document fictif a confirmé le statut
  `published` et l'instant `2026-11-13T13:03:31.015Z` : publication aboutie, pas un
  rejet démontré de l'application.
- Le scénario attend maintenant la réponse authentifiée de chaque mutation,
  exige HTTP 200 et son contrat de confirmation, puis vérifie l'interface avec
  un délai adapté. Aucun contrôle métier ni test n'est désactivé.
- Les neuf comptes de la première tentative sont désactivés, leurs sessions
  révoquées ; les trois écoles et périmètres fictifs sont neutralisés. Les pièces
  de test sont inventoriées et conservées, pas supprimées.
- Seconde tentative : **20 groupes de contrôles PASS, zéro FAIL**, terminée le
  13 novembre 2026 à 13:34:36 UTC. Deux écoles activées indépendamment (USD/CDF),
  une inactive ; publication, rapprochement, approbation et activation CDF depuis
  le vrai formulaire Administrateur ; retour hors ligne et réponse perdue sans
  double encaissement ; refus de mutation aux autres rôles.
- Quatre PDF authentifiés régénérés (Administrateur, Caissier, Coordination,
  Sous-coordination), douze pages rendues et inspectées visuellement. Filtre vide
  vérifié. Rubrique fictive 1 : 0 + 60 - 42 = 18 USD, 4 USD selon filtre (écart
  56 USD). Non affecté : 5 + 255 - 0 = 260 USD, 44 USD selon filtre (écart 211 USD).
  Total USD : 5 + 581 - 42 = 544 ; total CDF : 90 + 10 000 - 2 000 = 8 090 FC.
- Seconde clôture vérifiée : neuf comptes désactivés et sessions révoquées,
  trois écoles neutralisées, 211 documents générés par les opérations et pages
  de preuve inventoriés, en complément des documents de préparation du manifeste.
  Ces documents fictifs sont conservés : ne pas annoncer leur suppression.
- Preuves locales : `diagnostics/fee-allocation-hosted/9423edc0cde024589c7e04bc722214c2bf8ceb64/`.
  Le correctif du scénario et ce compte rendu ne modifient pas le code applicatif
  du SHA hébergé testé. Les identifiants d'accès ne figurent pas dans les preuves.

## Verrous de livraison générale à lever

1. Le rapprochement reste une transaction exhaustive : l'archivage refuse une
   preuve dépassant 7 Mo/450 pages. La pagination ne suffit pas à lever les
   limites de durée/taille d'une transaction. Il faut un traitement reprenable
   avec preuve de cohérence complète, pas simplement relever les seuils.
2. Le registre est maintenant transmis en pages bornées (200 mouvements et
   500 ko par page) avec empreinte de continuité ; aucun total partiel n'est
   exposé. Sa vérification exhaustive par transaction reste toutefois coûteuse
   pour les très gros volumes et doit encore être rendue reprenable.
3. Les écritures historiques sans provenance serveur ou sans devise justifiée
   restent refusées. Aucun mécanisme ne doit fabriquer leur justification.
4. La recette hébergée fonctionnelle est PASS sur les fixtures ci-dessus, mais
   les volumes 1 201/2 401 restent des validations locales en mémoire, pas des
   mesures de charge Firebase hébergées. Le chemin sans marqueur de fixture est
   testé localement ; les fixtures hébergées conservent leur isolation renforcée.

Verdict : **NON DÉPLOYÉE**. Les limites de volume et le rapprochement des anciens
historiques nécessitent encore du développement et une validation, pas une
extension IAM ni une approbation technique du propriétaire. La PR #58 reste en
brouillon. Aucun test réussi ici ne justifie de contourner ces verrous.

Pas de fusion ni promotion tant que ces contrôles bloquants subsistent.

## Production conservée au début de l'intervention

- SHA servi : `d46a5b499c34eeb92e10d6c36752c43dee9f3bf5`.
- Déploiement : `dpl_8VqkjKBujPUbBJR9mHkMZc2FDXN8`.
- Aucune donnée réelle, file IndexedDB, règle Production ou activation d'école
  modifiée par ce lot. Ne pas revenir à un serveur ignorant un registre actif.
