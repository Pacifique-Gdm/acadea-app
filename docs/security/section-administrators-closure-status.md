# PR #40 — état de finalisation du 1er novembre 2026

## B08 — intégration candidate en cours de validation

Les paragraphes historiques ci-dessous décrivent l'état avant le raccordement
B08. Le candidat local remplace maintenant le refus global par la validation du
profil actif, du rôle, de l'établissement et des sections. Activation normale
réservée au Super Administrateur, jetons révoqués et audit transactionnel ; aucun
compte réel activé. Les lectures scolaires restent via les API bornées. Les
messages/conversations/notifications sont lisibles uniquement par leur participant
ou destinataire dans sa section ; mutations sensibles toujours côté serveur.
Les pièces jointes restent servies par les Functions contrôlées, pas par une
ouverture générale de Storage.

Preuves locales du lot : 55 tests Auth/API PASS, 18 tests Firestore sur émulateur
PASS, lint ciblé PASS. Le scénario Chromium B08 ajouté utilise Auth émulé et les
vrais handlers ; son résultat et les CI restent à confirmer. Aucun résultat
hébergé n'est revendiqué. Le préflight WIF manuel ne déploie et ne crée rien ;
voir `section-administrators-staging-access.md` pour les configurations manquantes.
La clôture technique de B08 n'est pas déclarée avant ces validations intégrées.

Ce document ne constitue pas une validation de livraison. Les connexions restent
verrouillées et la PR reste en brouillon. Aucun déploiement ni changement Firebase
distant n'a été effectué pour les lots ci-dessous.

## Registre des blocages confirmés

| ID | Composants | Défaut / correction nécessaire | État |
| --- | --- | --- | --- |
| B01 | `sectionFinancialHistory`, `sectionSchoolRecords`, `sectionAdministratorYearScope` | Les arriérés collectés dans l'année sélectionnée étaient omis. Charger séparément l'année de collecte, préserver les devises, dédupliquer et vérifier les dossiers d'origine et courant. | Corrigé : requête bornée à l'école/année, contrôles transactionnels des deux élèves et conservation de la provenance historique. |
| B02 | `useSchoolMessageRecipients` | Une réponse tardive pouvait conserver un annuaire d'un ancien utilisateur/périmètre ; une erreur conservait les contacts précédents. | Corrigé : invalidation par identité, école, année, statut et sections ; réponse ancienne ignorée ; liste vidée pendant revalidation et après refus. |
| B03 | `conversations`, `usePaginatedConversations` | Les marqueurs historiques utilisaient le compteur de l'administrateur principal par défaut. | Corrigé pour la sécurité : seuls les quatre rôles historiques propriétaires de ces compteurs peuvent les modifier. Cela ne valide pas le parcours de lecture personnel des nouveaux profils (B06). |
| B04 | `Dashboard`, `ControlModule` | Le solde général n'avait pas de consultation dédiée indépendante des commandes de dépense interdites. | Corrigé : composant partagé de consultation, sans mutation, utilisant l'API existante ; réponse école/année/devise vérifiée ; annulation des réponses obsolètes. |
| B05 | `sectionDashboard`, `Dashboard`, `dashboardPdf` | Agrégats scolaires transactionnels bornés aux sections, compteurs et PDF séparés de la comptabilité générale. | Implémenté et testé unitairement ; validation des chargements et PDF depuis une session réelle encore dépendante de B08. |
| B06 | `transactionalMessaging`, `messageRecipients`, `sectionMessageRead`, lecteurs de fichiers | Destinataires réciproques, parent mixte, création transactionnelle, notifications par compte et filtrage des caches implémentés. | Tests ciblés réussis ; parcours bidirectionnel complet non validé. Les gardes globales refusent encore les profils : clôture conditionnée à B08. |
| B07 | `MenuModule`, `sectionSchoolRecords`, lecteurs documentaires | Personnel/paie, frais, bibliothèque, médical, rapport financier, Valves et biométrie raccordés en lecture seule. | Lecteurs et rendus statiques testés ; navigation authentifiée non exécutée. Publications historiques sans section vérifiable non exposées ; aucune association inventée. |
| B08 | `auth`, `activeUser`, règles Firebase et recette | Les gardes de livraison refusent encore les trois rôles. Aucun parcours authentifié de leurs cinq onglets n'a été exécuté. | Ouvert : finaliser les chemins autorisés puis préparer une recette isolée qui conserve les contrôles métier. Une CI E2E historique verte ne prouve pas cette recette. |

Huit blocages initiaux : B01–B04 corrigés, implémentations B05–B07 complétées par
les lots décrits ci-dessous, mais leur recette intégrée n'est pas certifiée.
B08 reste ouvert, avec un volet de raccordement/activation contrôlée et un volet
d'accès Staging. Ne pas interpréter les tests unitaires comme huit blocages clos.

Les sections « Reprise » ci-dessous constituent le journal chronologique : leurs
verdicts intermédiaires ne remplacent pas le présent registre.

## Vérifications réellement exécutées sur les nouveaux lots

- Historique/transport/périmètre annuel : **29 tests PASS** (quatre fichiers).
- Annuaire asynchrone, compteurs historiques et non-régression messagerie :
  **15 tests PASS** (trois fichiers, dont les tests de refus des trois profils).
- Consultation de caisse générale : **6 tests PASS**, dont rendu React statique,
  refus de compte désactivé/sections absentes et réponses étrangères.
- ESLint ciblé et `git diff --check` : **PASS**.
- La CI du commit `03c81c3` a trouvé un type trop large dans une fixture de test ;
  corrigé au commit `254f335` avec un tuple littéral. Ce résultat FAIL n'est pas
  assimilé à une validation du nouveau HEAD.
- Pas de recette Firebase Staging hébergée, pas de test mobile, pas de preuve
  visuelle PDF nouvelle, pas de parcours authentifié des trois profils.

Les tests ci-dessus utilisent des données synthétiques et des doubles de transport
ou de base ; ils ne sont pas une recette Firestore hébergée. Le rendu React statique
ne démontre pas les effets asynchrones d'un navigateur.

## Garde-fous conservés

- Pas d'activation des connexions, de fusion ou de déploiement.
- Pas de modification de règles Firestore/Storage dans ces lots.
- Aucune donnée réelle ni ressource Firebase distante créée, modifiée ou supprimée.
- Les suppressions d'élève, annulations/suppressions de paiement et opérations
  d'administration des utilisateurs restent interdites.
- La comptabilité générale n'est jamais ventilée artificiellement par section.

## Reprise B05

La synthèse scolaire est maintenant calculée côté serveur dans une transaction,
avec profil actif relu, école/année vérifiées, sections bornées et refus des
réponses partielles trop volumineuses. Les effectifs parents sont agrégés sans
exposer les dossiers ni les enfants d'autres sections. Les effectifs de personnel
sont explicitement globaux à l'établissement. Les KPI sont séparés de la caisse
générale et le PDF de section n'attribue plus de dépenses générales aux sections.

28 tests ciblés PASS : calculs comparés au helper historique, refus de section et
école étrangères, compte désactivé, devises incohérentes, transport et contenu du
PDF. Ces tests de contenu ne constituent pas une inspection visuelle PDF ni une
recette authentifiée. B05 implémenté ; validation intégrée finale rattachée à B08.

**Verdict : PR non prête pour validation finale / livraison ; B06–B08 ouverts.**

## Reprise B06 — destinataires réciproques

Le répertoire expose maintenant les administrateurs de section aux interlocuteurs
autorisés. Les envois vers ces profils exigent une section explicite validée côté
serveur. Pour un parent, cette section doit correspondre à au moins un enfant actif
de l'année choisie ; aucune donnée d'enfant n'est ajoutée au répertoire. Les messages
et conversations sont estampillés avec cette section, et les fils parent de
sections différentes ne sont plus réutilisés entre eux. Les formulaires Parent et
personnel utilisent cette sélection. 60 tests ciblés PASS, lint ciblé PASS.

B06 reste ouvert jusqu'à la validation intégrée de lecture, marqueurs personnels
et pièces jointes. Les gardes de connexion n'ont pas été retirées.

Le marquage des notifications des profils de section passe désormais par une
transaction serveur (API existante `message-recipients`, action POST dédiée).
Le profil, l'école, l'année et le destinataire personnel sont vérifiés avant toute
écriture. Seul `read` est modifié ; aucun compteur partagé n'est utilisé.
29 tests ciblés PASS sur les marqueurs, destinataires et API existante ; lint PASS.

La CI complète a détecté cinq assertions de matrice de rôles restées sur la liste
historique. Elles incluent désormais les trois destinataires ajoutés, avec les
tests de refus conservés. Le rendu des messages en cache vérifie aussi le profil,
la section, l'école, l'année et la participation ; les enfants affichés d'un parent
mixte sont re-filtrés au dernier moment. 23 tests ciblés PASS et lint PASS.

Les échanges impliquant un profil de section relisent désormais les autorisations
dans la transaction d'enregistrement : profil, établissement, année, destinataires,
parent et enfants. Une réattribution observée à la nouvelle tentative est refusée.
La création des messages/notifications est conditionnelle et un échec de réponse
ne supprime plus les pièces jointes d'un message déjà enregistré. 30 tests ciblés
PASS, lint PASS. Il s'agit de tests unitaires de transactions simulées, pas d'une
preuve de concurrence sur Firebase hébergé. La validation intégrée reste B08.

## Reprise B07 — consultations bornées du Menu

Types de frais (référentiel en lecture seule), bibliothèque existante, personnel
global et consultation de sa paie sont raccordés. Le lecteur personnel projette
uniquement nom, fonction et statut ; aucune donnée administrative privée ni compte
Parent n'est retourné. Les fiches médicales sont lues par identifiants d'élèves
autorisés dans la même transaction, puis affichées avec le composant existant sans
commande de modification. Aucune mutation de compte ou de paie n'est ajoutée.
47 tests ciblés PASS, lint et diff check PASS. B07 reste ouvert pour les autres
consultations non encore raccordées ; ce lot n'est pas une recette navigateur.

Les 6 tests unitaires Functions de contrôle des pièces jointes de messages sont
PASS. TypeScript local reste limité par les dépendances absentes `@vvo/tzdb`,
`pdfjs-dist` et `tesseract.js`; la CI application/functions du commit f1831c3 est
PASS (installation propre, types, tests et build), sans prétendre valider le lot
Menu postérieur avant sa CI.

Complément B06 : les notifications personnelles des échanges de section portent
désormais la section du message. Requêtes et affichage refusent les aperçus d'une
ancienne section, même si l'utilisateur reste destinataire. Deux index composites
sont préparés (non déployés). 20 tests ciblés PASS, lint PASS. Les notifications
anciennes non étiquetées sont volontairement invisibles aux nouveaux profils.

Complément B07 : le rapport financier réutilise le composant/PDF existants avec
les seuls élèves autorisés, chargés par les lecteurs serveur. Les dépenses et
autres recettes sont chargées séparément, globalement, en lecture seule. Le
rapport de section n'affiche pas de faux solde mélangeant recettes partielles et
dépenses globales ; le solde général dispose de sa consultation dédiée. Pagination
complète, refus d'échec partiel et de curseur répété : 24 tests PASS, lint PASS.
Les preuves PDF portent ici sur le contenu généré, pas sur une inspection visuelle.

Complément B07 : lecture des Valves explicitement attribuées aux sections. Les
URL permanentes et données inline ne sortent pas du lecteur ; les fichiers
canoniques sont servis par la Function authentifiée, avec vérification du profil,
de l'école, de la publication, du chemin, du type et de la taille, puis relecture
après téléchargement. Les archives `all_parents`/sans section vérifiable ne sont
pas devinées ni migrées. 32 tests lecteurs PASS, 17 tests Functions PASS, lint
PASS. Index Valves préparé, non déployé ; téléchargement hébergé non exécuté.

La consultation Empreintes/Cartes réutilise le composant existant, avec les seuls
élèves autorisés et sans commandes d'association, remplacement ou désactivation.
Les trois profils disposent maintenant des entrées de consultation du Menu, sauf
l'annuaire Parents et l'administration des comptes, volontairement interdits.
14 tests ciblés PASS (dont rendu React statique des trois menus), lint PASS.
Ce rendu statique ne démontre pas un parcours de clics authentifié.

## B08 — limites vérifiées et recette à exécuter

Contrôle non destructif de l'environnement GitHub `acadea-staging-e2e` : les cinq
variables publiques `STAGING_FIREBASE_*` sont renseignées. Les variables
`GCP_STAGING_WIF_PROVIDER` et `GCP_STAGING_E2E_SERVICE_ACCOUNT` sont absentes.
Aucun identifiant de fournisseur ou de compte de service n'est inventé. Le chemin
ADC local conventionnel est absent et `GOOGLE_APPLICATION_CREDENTIALS` n'est pas
défini. Cela ne prouve pas l'absence de tout autre accès, mais aucun accès de
fixture hébergée utilisable n'a été établi pour ce lot.

Le workflow Staging existant est spécifique au hors connexion et à sa branche :
il ne constitue pas un runner prêt pour cette recette, et n'a pas été détourné.
L'accès WIF seul ne suffirait donc pas à clôturer B08.

Limite technique distincte : `requireActiveApiUser`, la garde d'authentification
et les règles Firestore/Storage refusent encore les trois profils avant livraison.
Les tests de règles vérifient ce refus, pas les parcours positifs des cinq onglets.
Une intégration candidate permettant une activation isolée tout en conservant les
contrôles de profil/école/sections reste à finaliser et tester avant toute levée de
garde. Aucune garde n'a été contournée pour produire un résultat PASS.

Recette requise sur un environnement candidat isolé et compatible :

1. Refuser toute cible autre que `acadea-staging`, vérifier le SHA et les versions
   candidates d'API, Functions, règles et index. Aucun déploiement effectué ici.
2. Préparer un manifeste de chemins absents, deux écoles fictives, les trois
   profils actifs et des variantes désactivées/sections invalides, des élèves par
   section et un parent mixte. Conserver les secrets hors logs et dépôt.
3. Dashboard : comparer les agrégats aux écritures fictives connues, aux arriérés
   et aux PDF ; distinguer clairement recettes scolaires et solde général.
4. Élèves/Contrôle : création et correction autorisées dans la section, refus de
   suppression/transfert hors section et d'annulation de paiement ; comptabilité
   générale et paie lisibles mais non modifiables, y compris par requêtes directes.
5. Message : envoi/réponse depuis les deux comptes, parent mixte sans fuite de
   fratrie, marqueurs propres au destinataire, changements de section/statut,
   téléchargement autorisé et refus d'un autre fichier/établissement.
6. Menu : toutes les consultations raccordées, changement d'année, erreurs et
   réessais ; absence des commandes interdites ; PDF et fichiers inspectés.
7. Vérifier les refus interétablissements et le retrait des droits après
   désactivation. Nettoyer uniquement les ressources du manifeste et vérifier
   séparément Auth, Firestore et Storage, même après échec.

Cette recette est **NON EXÉCUTÉE**. Aucune fixture distante n'a été créée, donc
aucun nettoyage distant n'est revendiqué. La PR doit rester en brouillon.

## Dernières corrections de validation

La CI a détecté TS7022 dans le lecteur paginé du rapport : résultat typé
explicitement avec `ControlHistoryPage<T>` (`f1d8123`). Elle a ensuite détecté une
assertion imposant l'ancien Menu à trois entrées. Le test vérifie désormais
l'absence des comptes/annuaire Parents sans interdire les consultations légitimes
ajoutées. Les 8 tests des deux fichiers concernés sont PASS (`da33d01`).
La réussite des CI du dernier HEAD doit être vérifiée séparément ; un résultat
vert sur un commit antérieur n'est pas transféré au nouveau HEAD.
