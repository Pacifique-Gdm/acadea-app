# Répartition des frais — phase 1 (fondations inactives)

Cette phase ajoute des contrats et une API de **préparation seulement**. Elle ne branche aucun paiement, arriéré, cas social, dépense, salaire, prime ou opération hors connexion sur les nouvelles collections. Aucun écran, drawer, PDF ou solde utilisable n'est livré. Les écoles sans configuration conservent le circuit financier actuel.

## Contrats et invariants

- L'état est lié à `(schoolId, schoolYearId, currency)` : `NON_CONFIGURE` par défaut, `EN_PREPARATION` après le premier brouillon. `ACTIVE` existe dans le contrat pour une phase future, mais l'API rejette toujours publication et activation (`409 phase-not-ready`). Aucun brouillon ou version préparée ne déclenche une imputation.
- Une configuration est liée à un `feeTypeId` existant, à sa classe ou classe-option, à l'année scolaire active, à la devise et au tarif de référence en unités mineures. Les frais non configurés restent possibles.
- Les rubriques sont personnalisées, avec un identifiant hexadécimal stable de 32 caractères, un nom unique et un mode propre (`percent` en points de base ou `fixed` en unités mineures). Les modes sont combinables. `UNALLOCATED` / « Non affecté » est une réserve technique non éditable. L'arrondi déterministe conserve exactement le montant du tarif, et le dépassement est refusé.
- Le brouillon a une révision optimiste et une clé de requête idempotente. La version préparée est créée une seule fois par révision, avec copie des rubriques, du tarif, de la classe, de la devise et de l'auteur. Les statuts futurs `published`, `superseded`, `disabled` sont distincts de l'état du système. Il n'existe pas d'API de mutation d'une version publiée.
- Les modèles `FeeAllocationAnchor`, `FeeAllocationMovement`, `FeeAllocationBalance` et `FeeAllocationOpeningProposal` réservent les références d'année d'origine, d'année de recouvrement, de source et de version. Ils ne sont écrits par aucun flux en phase 1.
- Un mouvement futur doit conserver la somme de ses lignes en montant signé et être identifié par source et révision. Le rapprochement et l'idempotence devront être transactionnels avant toute activation.

## Solde d'ouverture et transition historique

L'ouverture devra partir d'une date de coupure, d'un inventaire documenté des recettes et dépenses, d'une vérification par devise et d'un rapprochement avec la caisse réelle. Une proposition ne peut dépasser ni les fonds disponibles ni les recettes scolaires justifiées ; les références doivent être uniques. Le validateur de phase 1 retourne toujours `approved: false`. **Il ne déduit jamais une disponibilité de la somme brute des recettes historiques** et ne crédite aucune rubrique. Une approbation future exigera la vérification des pièces et obligations, un historique d'approbation et une transaction atomique empêchant tout double crédit. Une incohérence ou une opération hors connexion en attente devra bloquer l'activation future.

Les paiements partiels, arriérés, décisions sociales et prises en charge ne sont pas des recettes supplémentaires. Une réduction, exonération ou promesse de prise en charge ne crédite rien. Les versions historiques et rubriques déjà utilisées devront rester consultables sans migration destructive ; aucune configuration passée ne sera inventée.

## API et sécurité

`POST /api/manage-fee-allocation` exige un jeton Firebase vérifié, un profil actif stocké, le périmètre école ou coordination vérifié côté serveur, une année valide et une limite de débit. L'Administrateur de l'école peut enregistrer un brouillon et préparer sa version. Le Caissier, le Coordinateur et le Sous-coordinateur ne peuvent que lire dans leur périmètre. Les mutations utilisent transaction, révision attendue, reçu idempotent et audit. Le client ne peut lire ni écrire directement les nouvelles collections : les règles Firestore les ferment toutes.

Actions préparatoires : `get-state`, `get-permissions`, `list-configurations`, `validate-draft`, `save-draft`, `prepare-version`, `list-versions`, `check-activation`. `publish-configuration` et `activate` retournent toujours `409 phase-not-ready`. Il n'existe pas d'API de solde d'ouverture approuvé en phase 1.

Les règles ajoutent un garde **conditionnel** à `feeTypes` : si `feeAllocationFeeGuards/{feeTypeId}` existe, les écritures clientes sur le frais sont refusées. Le serveur `saveFeeTypes` vérifie ce garde dans sa transaction. Aucun garde n'est créé par la phase 1, afin de préserver l'édition légitime actuelle pendant la préparation. Une phase ultérieure devra créer le garde atomiquement avec la publication d'une version, et prévoir le flux de changement de tarif par nouvelle version avant toute activation.

## Déploiement ultérieur et retour arrière

La PR ne doit être ni fusionnée ni déployée dans cette mission. Une publication future nécessitera une comparaison et une sauvegarde des règles actives, puis le déploiement coordonné des règles et de l'API compatible ; les anciens clients conservent le comportement des frais non gardés. Un retour arrière ne doit jamais effacer les configurations, versions, reçus, données historiques ou files IndexedDB. Dès qu'un garde ou un mouvement réel existera, un retour arrière isolé du code ou des règles sera interdit ; privilégier un correctif compatible.

Les phases 2 à 5 devront ajouter l'interface, le rapprochement approuvé, la publication atomique, les imputations de paiements confirmés, les sorties et contrôles de soldes, les exports et la recette hébergée. L'état `ACTIVE` ne pourra être accessible qu'après validation de l'ensemble du circuit.
