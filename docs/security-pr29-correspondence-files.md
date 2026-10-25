# PR #29 — pièces jointes des courriers et ordre de livraison

## Motif de l'API

L'autorisation d'une pièce jointe dépend simultanément du profil utilisateur courant,
du statut courant de l'école et du courrier courant. Les règles Cloud Storage ne
peuvent consulter que deux documents Firestore par requête. La fonction callable
`secretaryCorrespondenceFile` vérifie les trois documents côté serveur avec Firebase
Auth ; les règles Storage refusent tout accès direct au chemin des courriers.

La fonction n'accepte que `upload`, `download` et `purge`. Elle valide les claims et
le profil actuel du Secrétaire, l'école non suspendue et l'appartenance du courrier.
Les courriers archivés restent lisibles mais ne peuvent plus être modifiés. Un
téléversement utilise un nom aléatoire et la précondition Storage
`ifGenerationMatch: 0`, puis met à jour le courrier dans une transaction Firestore
qui relit les trois sources. Si la transaction échoue, le nouvel objet est retiré.
La taille maximale reste 10 Mo et les types autorisés sont inchangés.

Les règles Firestore conservent l'accès d'un Parent historique sans claim
`parentId` en utilisant l'identifiant présent dans son profil `users/{uid}`
actif. Si le claim existe, il doit toujours correspondre au profil ; un Parent
ne peut pas modifier lui-même ce champ protégé.

## Compatibilité des anciens documents et URL

Les anciennes pièces jointes conservent leur `attachment.path`. Le nouveau bouton
de consultation demande leur contenu à la fonction, même lorsqu'un ancien
`attachment.url` est encore présent. Aucune migration de documents n'est requise
pour cette lecture. Les nouvelles pièces n'enregistrent plus d'URL à jeton.

**Limite distincte :** une ancienne URL Firebase contenant déjà un jeton de
téléchargement peut rester utilisable hors de l'application malgré les nouvelles
règles Storage. Avant de déclarer la confidentialité des anciens liens entièrement
assurée en Production, inventorier les objets de correspondance et leurs jetons,
préparer un dry-run ciblé, puis retirer ou renouveler ces jetons avec une autorisation
Production distincte. Ne pas modifier les objets ni leurs métadonnées Production
dans la PR #29. Les liens externes déjà partagés cesseront alors de fonctionner ;
la consultation dans Acadéa continuera par `attachment.path`.

## Bascule Staging puis Production

1. Sauvegarder les rulesets actifs, l'alias applicatif et la version de la fonction.
2. Déployer la nouvelle fonction sur le projet ciblé ; l'ancienne interface reste
   fonctionnelle tant que les règles Storage historiques restent actives.
3. Déployer l'interface candidate configurée pour ce même projet ; vérifier sa
   connexion et la lecture d'une pièce historique avec un compte fictif.
4. Publier les règles candidates Firestore/Storage ; vérifier les versions actives.
5. Tester S1–S4, les accès légitimes, les refus, le transfert, l'archivage et les
   parcours Horaires. Ne pas promouvoir Production avant la recette.

Sur Staging, les règles historiques peuvent être restaurées si l'alias applicatif
sert encore l'ancienne interface. La recette S1–S4 de cette PR a été menée sur
des comptes et documents fictifs, puis les règles Staging sauvegardées ont été
remises à l'identique pour préserver cet alias ancien ; la fonction candidate
reste déployée mais n'est pas utilisée par lui.

En Production, après publication des règles restrictives, ne pas restaurer
automatiquement les anciennes règles car cela rouvrirait S1–S4. Suspendre au
besoin le parcours affecté et corriger vers l'avant avec une version compatible.
La fusion et toute modification Production requièrent l'autorisation finale du
propriétaire.
