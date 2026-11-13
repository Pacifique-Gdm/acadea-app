# Répartition : candidate de clôture, dépendante de #55

Base : `06357f283df0b207805bf2ed91a5ce4c788861eb` (PR #55 ouverte).
La phase 2 est intégrée dans `main` à `d7054a8c7f0f7d4c4647ab829698ef5e37b8d188`.
Ne pas fusionner cette branche avant sa dépendance ; ne pas rejouer ses commits deux fois.

## Périmètre et garde d'activation

Cette candidate ne peut activer ni Production ni une école réelle. Les opérations
actives exigent `acadea-staging`, une école fictive identifiable et une inscription
serveur dans `feeAllocationTestScopes`, expirant sous 24 h. Ce registre est interdit
aux SDK clients. Les permissions normales, le profil actif, l'établissement et
l'année active restent vérifiés. Une variable d'environnement ne confère aucun rôle.

Sans activation, les dépenses et paies gardent le circuit historique. Avec activation,
une seule rubrique valide est obligatoire ; `UNALLOCATED` est la rubrique réservée
« Non affecté ». La sélection ne remplace jamais les permissions financières.
Les paiements, dépenses, mouvements compensatoires, reçus d'idempotence, soldes de
rubrique et contrôle de trésorerie appartiennent à la même transaction Firestore.
Le salaire et la prime débitent uniquement leur dépense liée, pour leur net.

## Procédure de rapprochement sur une fixture

Toutes les commandes passent par l'API financière authentifiée avec un administrateur
actif de l'école. Une clé `requestId` stable doit être réutilisée après réponse perdue.

1. Enregistrer le brouillon, préparer sa version, puis `fee-allocation.publish-configuration`.
2. Inventorier les paiements scolaires confirmés, dépenses et autres entrées de caisse.
3. `fee-allocation.prepare-opening` : renseigner `cashCountMinor`, les lignes manuelles
   `{rubricId, amountMinor}`, et `RAPPROCHER LA CAISSE`. La somme des lignes doit
   expliquer exactement les recettes scolaires prouvées moins les dépenses.
   Les dons et subventions participent au rapprochement de caisse, jamais à l'ouverture.
4. `fee-allocation.approve-opening` avec l'identifiant obtenu et
   `APPROUVER LE RAPPROCHEMENT`. Toute pièce ou configuration modifiée invalide l'approbation.
5. `fee-allocation.activate`, même identifiant, `ACTIVER LA REPARTITION FICTIVE`.
   La création des soldes, du mouvement d'ouverture et de l'état actif est atomique.
6. `fee-allocation.pause` / `resume` exigent un motif, sont audités et idempotents.
   Pendant la pause, les mutations scolaires nécessitant une ventilation sont refusées,
   et non acceptées silencieusement sans registre.

Les anciennes propositions hors connexion conservent leurs identifiants et données.
Une proposition antérieure à la coupure, non datée ou dont la provenance ne permet
pas une décision certaine est refusée avec rapprochement requis, sans purge locale.
Une correction d'une écriture incluse dans l'ouverture doit être rapprochée explicitement.

## Consultation et PDF

Les quatre rôles utilisent le drawer existant ; seul l'administrateur configure.
Les encaissements suivent le filtre frais/classe/période. Les dépenses et disponibilités
restent globales à la rubrique commune : aucune affectation artificielle par classe.
Le disponible de fin de période inclut l'ouverture et tous les mouvements antérieurs.
Le prévu reste un tarif de référence, pas une créance ni une recette.
Les devises ne sont jamais additionnées entre elles.

## Tests et preuves

- `api/_lib/feeAllocationLifecycle.test.js` : ouverture, idempotence, transaction
  interrompue, débit net, compensation, pause, dons exclus et coupure hors connexion.
- `src/utils/feeAllocationOperational.test.ts` : période, disponible cumulé, devises, PDF.
- `e2e/fee-allocation-complete-emulator.spec.ts` : véritables Auth, Firestore et handlers,
  dépenses concurrentes, rôles et écritures clientes refusées.
- `scripts/feeAllocationHostedRecipe.mjs` : SHA/projet avant toute fixture, OAuth
  officiel temporaire, authentification par mot de passe fictif en mémoire, activation,
  registre, quatre rôles Chromium, exports multipages et clôture dans `finally`.
- Le manifeste et les preuves locales sont sous `diagnostics/fee-allocation-hosted/`,
  ignorés par Git. Les comptes sont désactivés, claims retirés, sessions révoquées ;
  écoles et inscription de recette neutralisées. Les pièces fictives restent inventoriées,
  non supprimées. Aucun droit de suppression général n'est requis.

Ne pas confondre test local et recette Firebase hébergée. Le statut réel est publié
dans le rapport de la PR ; un script disponible n'est pas une preuve d'exécution.

## Limites bloquantes à surveiller

Le rapprochement atomique refuse plus de 200 pièces par collection/école ou plus de
200 pièces pertinentes ; la lecture du registre refuse plus de 2 000 mouvements.
Aucune troncature silencieuse. Une école dépassant ces bornes nécessite un traitement
paginé avec preuve de complétude avant activation. Les obligations historiques non
prouvées ne reçoivent pas arbitrairement la version courante.

## Sauvegarde et retour arrière

Staging avant intervention : `dpl_6cQuFx2uTAB8USrUyqP1CCSXsyAd`, commit
`d7510f1c4fb09188bb751fda56a33303b2606fa0` ; règles sauvegardées :
`projects/acadea-staging/rulesets/027f7c4a-6407-43e0-9b95-59b221c99859`.
Le diff des règles n'ajoute que les protections serveur de la répartition et le verrou
des tarifs configurés. Aucun changement Storage ou Functions n'est nécessaire.

Ne jamais revenir à un serveur qui ignore les imputations d'une école active.
En cas d'incident : pause auditée, maintien des règles restrictives et du registre,
correctif compatible, puis reprise. Aucune restauration isolée des anciennes règles,
aucun effacement IndexedDB, aucune modification des identifiants d'idempotence.
Une restauration du build Staging précédent n'est sûre qu'après clôture des seules
fixtures activées et vérification qu'aucun périmètre actif n'en dépend.

Cette mission n'autorise aucune fusion, promotion Production ou activation réelle.
