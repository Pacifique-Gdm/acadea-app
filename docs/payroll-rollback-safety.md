# Arrêt d'urgence de la paie — candidat Personnel/Paie

Le candidat conserve les protections de `financialTransactions.js` : une dépense liée à `personnelPaymentId` ne peut être ni modifiée ni supprimée par le flux de dépenses ordinaires. Les historiques, audits, avances, dépenses et clés d'idempotence déjà créés ne doivent jamais être supprimés pour revenir en arrière. Un retour au vieux `main` n'est pas un rollback financier sûr, car il ne contient pas ces protections.

Le verrou `ACADEA_PAYROLL_WRITES_SUSPENDED=true` est vérifié dans la transaction de `createPersonnelPayment`, après la lecture d'une clé d'idempotence existante et les contrôles d'établissement, de rôle et de bénéficiaire, mais avant toute écriture. Il suspend **les nouveaux salaires, primes et avances** avec HTTP 409 ; les refus 403/404, les lectures, les rejouements idempotents identiques et les dépenses ordinaires demeurent disponibles. Toute autre valeur, ou l'absence de variable, laisse la paie active. Le verrou n'est pas activé par ce commit.

## Activation d'urgence (autorisation de déploiement distincte)

1. Relever l'incident, le SHA servi, les règles Firestore actives, les écritures déjà effectuées et leurs clés d'idempotence. Geler les promotions concurrentes. Ne pas revenir à un backend sans la protection des dépenses liées.
2. Sur le projet Vercel **exactement ciblé**, configurer la variable serveur `ACADEA_PAYROLL_WRITES_SUSPENDED` à `true` pour l'environnement voulu. Ne jamais l'ajouter à un fichier versionné. Vérifier le projet et l'environnement avant toute modification.
3. Redéployer **le même SHA validé**, selon le processus officiel et seulement après autorisation de l'environnement concerné. Attendre `READY`, puis vérifier `/version.json` et l'alias. Une modification de variable sur un ancien déploiement ne suffit pas : le nouveau déploiement doit l'utiliser.
4. Sur des données fictives isolées, contrôler les refus 409 des trois nouveaux paiements, le rejeu idempotent identique, le refus de rejeu divergent, les historiques, les dépenses ordinaires, l'immutabilité des dépenses liées, les rôles et l'isolation école. Sur Production, n'effectuer que des contrôles non destructifs sauf autorisation distincte.
5. Documenter l'heure, le Deployment ID et le SHA. Surveiller les erreurs et conserver tous les documents financiers et audits existants.

Vérifications locales reproductibles avant l'activation (depuis le worktree du SHA approuvé) :

```powershell
git rev-parse HEAD
git diff --check
npm exec -- vitest run api/_lib/personnelPayroll.test.ts api/_lib/financialTransactions.test.ts
firebase emulators:exec --project acadea-staging --only firestore,storage "npm run test:firestore -- --maxWorkers=1 && npm run test:storage -- --maxWorkers=1"
vercel project inspect acadea-app --scope pacifique-gdms-projects
```

Après validation et autorisation Production **distincte**, l'outil de livraison protégé du dépôt est `npm run deploy:vercel:production` depuis un `main` propre, descendant du SHA validé, lié au Project ID Production attendu. Ne lancer cette commande ni depuis la branche candidate ni simplement pour tester le verrou. Le changement d'environnement et le déploiement sont deux opérations séparées ; vérifier chacune avant de passer à la suivante.

## Retour à la normale

Après correction de la cause, contrôler en lecture seule les paiements, avances, dépenses liées et clés d'idempotence déjà présents. Tester le scénario corrigé sur émulateur et backend isolé, retirer le verrou dans la configuration de l'environnement voulu, redéployer le SHA approuvé, puis vérifier qu'un nouveau paiement fictif crée exactement un paiement et une dépense liée. Ne jamais rejouer manuellement une opération déjà enregistrée avec une autre clé d'idempotence. Aucune étape de ce document n'autorise un déploiement Production.
