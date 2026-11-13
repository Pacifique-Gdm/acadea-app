# PR 58 — seuils de recette fixés avant la mesure hébergée

Projet unique : `acadea-staging`. Aucun test de volume sur une école réelle.
Ces seuils ne constituent pas des résultats ; les mesures doivent être annexées
au SHA effectivement servi avant fusion et promotion.

## Rapprochement

- 3 001 encaissements synthétiques identifiés, au-delà de 200 et de 1 201.
- Au plus 100 documents sources par transaction de progression ; au plus 100
  preuves et 100 reçus liés supplémentaires, plus 16 lectures de garde.
- Chaque source est lue une seule fois par exécution complète, hors reprise
  d'une transaction avortée par Firestore. Une réponse perdue ne rajoute rien.
- Interruption après un lot puis reprise ; preuve finale de 3 001 identifiants
  distincts et du total attendu. Écriture concurrente : ancien calcul refusé.
- p95 de la réponse de progression <= 15 s, maximum <= 30 s ; réponse <= 700 Ko.
- Fin du rapprochement en moins de 10 minutes, sans relever les limites du service.

## Registre et export

- Au moins 3 001 mouvements identifiés, au-delà de l'ancien seuil de 2 000.
- Au plus 101 mouvements lus par page (100 rendus + sentinelle), au plus 83
  soldes et 16 lectures de garde ; pas de lecture intégrale par page.
- Au plus N + ceil(N / 100) documents de mouvement lus pour une consultation
  complète stable. Les lectures des gardes et soldes sont comptées séparément.
- p95 <= 15 s et maximum <= 30 s par réponse, <= 700 Ko par réponse.
- Export complet <= 120 s après réception ; égalité exacte registre/soldes,
  aucun document partiel présenté comme définitif, échec explicite si changement.

Les métriques applicatives comptent les documents demandés via le SDK (les
tentatives Firestore sont comptées). Elles ne prétendent pas remplacer la
facturation ou les métriques agrégées Google Cloud. Les octets sont ceux des
réponses HTTP JSON et les durées sont mesurées côté client.
