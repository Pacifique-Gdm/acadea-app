# Acadéa — workflow de déploiement

## Architecture

- Worktree développement/Staging : branche `codex/*`, Vercel `pacifique-gdms-projects/acadea-staging`, Firebase `acadea-staging`.
- Worktree Production : `C:\Users\Pacifique BILOMBI\Documents\AC-production-deploy`, branche `main`, Vercel `pacifique-gdms-projects/acadea-app`, Firebase `acadea-production`.

Chaque worktree possède son propre `.vercel/project.json`. Ne reliez jamais un même dossier alternativement aux deux projets.

## Workflow normal

1. Vérifier le worktree, les tests, le lint et les builds.
2. Vérifier la cible : `npm run verify:vercel:staging` ou `npm run verify:vercel:production`.
3. Intégrer proprement dans `main`, puis `git push origin main`.
4. Laisser l’intégration Git Vercel produire le déploiement Production.
5. Vérifier le deployment READY, le SHA, l’alias et un smoke test HTTP.

Production est donc publiée par `main → origin/main → Vercel Git Integration`, et non par un `vercel link` suivi d’un upload CLI dans le worktree courant.

## Staging

Procédure normale depuis `codex/teacher-grading-staging` :

1. Terminer les validations locales, créer le commit, puis vérifier `npm run verify:vercel:staging` et pousser la branche Staging.
2. Rechercher le Deployment créé **par l'intégration Git** pour le SHA exact du commit. La branche peut produire un Deployment `Preview` : la Production Branch du projet `acadea-staging` est `staging`.
3. Attendre `READY`, vérifier la source `git`, le SHA exact et le projet `acadea-staging`, puis valider ce Deployment. Ne jamais sélectionner simplement « le dernier Deployment ».
4. Vérifier qu'aucun second Deployment n'a été créé pour ce SHA. Affecter ensuite `acadea-staging.vercel.app` au Deployment Git **existant**, sans rebuild :

   ```text
   npx vercel alias set <deployment-id-or-url> acadea-staging.vercel.app --scope pacifique-gdms-projects
   ```

5. Vérifier que l'alias pointe vers cet ID, que le nombre de Deployments du SHA n'a pas augmenté, que `/version.json` sert le SHA exact, puis effectuer les smokes/E2E nécessaires.

Après un push Staging, Codex doit d'abord rechercher ce Deployment Git. S'il existe et atteint `READY`, **ne pas exécuter** `vercel deploy`, `vercel deploy --prod`, `npx vercel deploy` ni `npx vercel deploy --prod` : ces commandes créent un second Deployment/build, elles n'affectent pas simplement l'alias.

Si aucun Deployment Git correspondant n'apparaît, vérifier le push, la branche, l'intégration Git et les événements Vercel, puis attendre un délai raisonnable. En cas d'échec confirmé de l'intégration, rapporter l'incident ; le fallback CLI exige une décision explicite et n'est jamais automatique.

### Fallback CLI Staging — manuel uniquement

Uniquement sur décision explicite après échec confirmé de l'intégration Git, vérifier le projet lié avant d'utiliser la CLI. Dans le worktree Staging, `--prod` cible la production du projet **acadea-staging**, et non le projet Acadéa Production `acadea-app`. Un `vercel deploy`, avec ou sans `--prebuilt`, crée un **nouveau Deployment/build** ; il ne remplace pas la commande d'alias et ne doit jamais suivre automatiquement un Git auto-deploy réussi.

## Fallback CLI Production

Le fallback est réservé au worktree Production correctement lié à `acadea-app` :

```text
npm run verify:vercel:production
vercel pull --yes --environment=production
vercel build --prod
vercel deploy --prebuilt --prod
```

Ne lancez pas ce fallback si l’intégration Git a déjà produit un deployment READY pour le même SHA. Un `BUILD_ERROR` CLI ne doit pas être masqué par une seconde publication aveugle.

## Firebase et plan de ressources

Vercel et Firebase sont indépendants. Utilisez `npm run deployment:plan` pour obtenir un plan non destructif basé sur les fichiers modifiés :

- Functions : `firebase deploy --project acadea-staging --only functions` ou `--project acadea-production` uniquement si `functions/` a changé ;
- Firestore Rules uniquement si `firestore.rules` a changé ;
- Storage Rules uniquement si `storage.rules` a changé ;
- Indexes uniquement si `firestore.indexes.json` a changé.

Ne déployez jamais ces ressources automatiquement sur la seule base d’un déploiement Vercel.

## Checklist pré-déploiement

- [ ] `git status` propre
- [ ] branche correcte
- [ ] SHA attendu confirmé
- [ ] tests, lint et builds verts
- [ ] projet Vercel vérifié
- [ ] projet Firebase vérifié
- [ ] `npm run deployment:plan` contrôlé

## Checklist post-déploiement

- [ ] deployment `READY`
- [ ] alias correct
- [ ] SHA correct
- [ ] HTTP 200
- [ ] smoke test non destructif
- [ ] aucune erreur console critique
