# État du lot « Affichage répartition et PDF »

- Branche : claude/affichage-repartition-pdf-b8b5ce, repartie du main a888ce6 (1.20.0, PR #142 fusionnée).
- PR : https://github.com/Pacifique-Gdm/acadea-app/pull/143 — version 1.20.1 (correction). Ni fusionnée ni mise en ligne.
- Contrôles locaux : tsc bon, eslint 0 erreur, 791 tests sur 791 (menu + utils). 9 nouveaux tests échouent sur l'ancien code.
- Staging (feu vert de la session mère) : branche publiée (q0a335ugb). Recette `tmp/affichage-repartition-staging.mjs` : 17 OK, sur ordinateur (1440 px) et téléphone (390 px).
  - PDF : 3 pages, un tableau par page, vérifiées à l'œil.
  - Nettoyage : 81 documents effacés, aucun reste (vérifié).
  - Alias remis sur p5dkuyui9 (dpl_E9RaJa3u…), vérifié par Vercel et par version.json.
- Captures : C:\Users\Pacifique BILOMBI\Documents\AC-sauvegardes-donnees\affichage-repartition-captures\
  - PDF : pdf-page1.png, pdf-page2.png, pdf-page3.png (+ repartition-frais.pdf)

**STAGING LIBRE**

## Correction v2 (demande de la session mère) : en-têtes du PDF coupés
- Commit 5e4edb7 poussé sur la PR #143. Pas de nouveau version-bump (la session mère le refera).
- Libellés courts, largeurs fixées, aucune coupure au milieu d'un mot. Nouveau test `src/utils/feeAllocationPdfEntetes.test.ts` (échoue sur l'ancien code). 794 tests sur 794.
- Rendu LOCAL (pas de staging) : `tmp/pdf-local.mjs`. 36 mots d'en-tête mesurés, aucun coupé (USD et CDF).
- Captures : pdf-v2-page1.png, pdf-v2-page2.png, pdf-v2-page3.png (+ pdf-v2-cdf-page1..3.png), même dossier.
