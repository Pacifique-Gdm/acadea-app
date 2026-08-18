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

Depuis le worktree Staging, `--prod` signifie la production du projet **acadea-staging**, pas la Production Acadéa. La cible doit être vérifiée avant toute commande.

```text
npm run verify:vercel:staging
vercel build --prod
vercel deploy --prebuilt --prod
```

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
