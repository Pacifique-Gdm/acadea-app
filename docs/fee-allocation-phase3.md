# Phase 3 — Encaissements affectés, sans activation réelle

Base : phase 2, PR #54 fusionnée au commit `d7054a8c7f0f7d4c4647ab829698ef5e37b8d188`.

## Frontière de sécurité

Le moteur est branché sur **les transactions financières existantes**, mais ne
s'exécute que lorsque le projet réel du client Admin SDK est `demo-acadea`,
les émulateurs Auth/Firestore sont sur les adresses loopback attendues, la
recette locale est explicite et aucun identifiant distant / environnement
Vercel n'est présent. Une école fictive identifiée et un état de recette
concordant sont également obligatoires. Une variable seule, un document ACTIVE
ou une demande client ne peuvent activer la ventilation sur un projet hébergé.

Sur `acadea-production` **et** `acadea-staging`, le hook est inerte avant toute
lecture supplémentaire. La recette hébergée du moteur n'est donc pas revendiquée.
L'API publique refuse toujours publication et activation. Aucune permission,
règle, index, Function, donnée réelle ni file IndexedDB n'est modifié par cette
phase. Les collections existantes `feeAllocation*` restent fermées au client.

## Source unique et atomicité

`executeFinancialOperation` conserve ses rôles, ses contrôles de compte, école,
année, devise, solde de caisse, net social, plafonds tiers, version attendue et
reçu `financialIdempotency`. `create-payment`, `update-payment` et
`delete-payment` appellent un préparateur **lecture seule** avant les écritures
de caisse. Sa fermeture écrit ensuite ancre, mouvement, cumul et soldes dans
**la même transaction Firestore** que le paiement et son reçu. Un échec annule
tout ; le rejeu de la même demande retourne le reçu sans deuxième mouvement.
Il n'existe ni nouveau endpoint d'encaissement ni déclencheur asynchrone.

Les dépenses, `cashInflows`, salaires et primes ne sont pas branchés au moteur.
Un paiement tiers conserve son `supportDecisionId`, mais reste une seule source
`payments/{id}`. Réduction, exonération et engagement ne créent aucun mouvement.
Le net exigible reste calculé par `supportBalance`, sans seconde dette.

## Calcul exact des paiements partiels

Les poids entiers du tarif sont ceux de `validateFeeAllocationRubrics` (fixes
exacts et pourcentages, reliquat UNALLOCATED, plus grands restes du tarif).
Les paiements partiels utilisent ces poids proportionnellement au tarif,
y compris pour les rubriques fixes : un fixe de 40 sur 100 reçoit 16 sur 40
encaissés. Les réductions ne créditent pas la différence avec le tarif officiel.

La cible est recalculée sur le **cumul affecté**, puis seul l'écart avec la
cible précédente est journalisé. Pour les centimes successifs, la méthode des
plus fortes moyennes est retenue, en BigInt et avec départage par ID stable.
Elle évite le paradoxe des plus grands restes : une rubrique pourrait autrement
perdre un centime alors qu'un nouveau paiement augmente le total. Elle part des
quotas inférieurs et attribue au plus 40 centimes restants ; aucune boucle
proportionnelle au montant. À paiement complet, tous les poids du tarif sont
retrouvés exactement. Les tests parcourent chaque centime de poids adverses.

## Historique, années et réserve

`feeAllocationAnchors` fige école, élève, frais, année d'origine, devise, tarif,
classe-option et version. Une nouvelle obligation courante peut lire une
version publiée vérifiée ; une dette historique sans ancre prouvée va à
UNALLOCATED, jamais à la configuration de l'année de collecte. Une version
superseded/disabled reste utilisable par son ancre, sans mutation de ses poids.
Une empreinte normalisée empêche une modification ultérieure de la version.

Les mouvements conservent année d'origine **et** année de collecte, date réelle
du paiement, date de comptabilisation, auteur, paiement/frais/élève et copie de
la source. Les paiements antérieurs à la coupure ne sont pas réaffectés.
UNALLOCATED est consolidé par école, année de collecte et devise, pas par frais
ou classe ; chaque entrée garde sa provenance. Les monnaies ne sont pas ajoutées
entre elles ; aucun transfert interannuel de disponibilité n'est inventé.

## Registre et corrections

- `feeAllocationMovements/receipt_<empreinte>` : création conditionnelle,
  source/révision uniques, lignes uniques, somme signée exacte, historique intact.
- `feeAllocationRequests/obligation_<empreinte>` : cumul sérialisé et empreinte
  de version ; ce n'est pas une créance ou une deuxième caisse.
- `feeAllocationRequests/payment_<empreinte>` : dernière révision confirmée,
  empreinte de source et référence du mouvement précédent.
- `feeAllocationBalances/<empreinte école/collecte/devise/rubrique>` : reçu net,
  dépenses/réservations de contrôle, `operational:false`. **Pas de disponible**.

Une correction enregistre l'écart sur l'ancre d'origine ; une suppression
autorisée crée une contrepassation et conserve la copie source dans le registre.
Les autres paiements et anciens mouvements ne sont pas réécrits. Les contrôles
de caisse restent obligatoires. Une contrepassation qui rendrait une rubrique
négative ou empiéterait sur une dépense/réservation est refusée atomiquement.
Une réaffectation de référence nécessite un rapprochement, pas une mutation
silencieuse. Les refus existants de correction d'année archivée et de paiement
tiers sont conservés : cette phase ne crée pas de nouvelles autorisations.

## Hors connexion

Aucun format local ni protocole de synchronisation n'est changé. La proposition
reste chiffrée dans IndexedDB et n'est jamais une recette. Son ID existant reste
le `clientRequestId`. Le serveur confirme paiement et mouvement ensemble.
Réponse perdue, redémarrage Chromium et synchronisations répétées doivent
retrouver ce même reçu ; un conflit tarif/devise refuse les deux écritures.

## Vérification et limites avant activation

Tests unitaires : mathématiques, bornes, fidélité du tarif, garde hébergé,
intégration du vrai handler financier avec transaction isolée, corrections,
annulation, versions, social/tiers, non-régression et interruption atomique.
Tests Auth/Firestore Emulator : vrais jetons, handlers, transactions concurrentes,
arriérés de deux années, versions historiques, réserve, restrictions de rôles,
école étrangère et écritures clientes interdites. Chromium : parcours hors
connexion existant étendu à la ventilation et à la perte d'accusé serveur.
Les résultats réellement exécutés et les CI du SHA final sont consignés dans
la PR ; une liste de scénarios n'est pas une preuve PASS.

Restent indispensables aux phases 4–5 : dépenses/paie et imputation obligatoire,
ouverture vérifiée, publication/activation complète et ancres initiales,
rapports opérationnels paginés, réconciliation exhaustive, contention/charge
hébergée, validation mobile physique. Le drawer et ses PDF restent préparatoires
avec Encaissé/Dépensé/Disponible indisponibles. Aucun tableau permanent ajouté.

## Livraison et retour arrière

Cette PR ne doit pas être fusionnée automatiquement ni promue en Production.
Un Preview peut être créé par l'intégration existante, sans moteur actif.
Aucun changement Firebase n'est nécessaire pour le mode inactif. Un retrait de
ce code avant activation n'exige aucune suppression de documents, ID ou file.
Après une future activation, seul un correctif compatible avec les registres
sera acceptable ; aucun retour isolé à un serveur ignorant les imputations.
