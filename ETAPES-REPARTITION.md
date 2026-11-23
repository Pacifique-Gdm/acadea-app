# Étapes d'une répartition des frais (version 1.20.1 en ligne)

Lu le 23/11/2026 dans le code d'`origin/main`, au commit `107fcfa` (version 1.20.1, en ligne depuis le 23/11). Rien n'a été modifié.

Changements de la 1.20.1 par rapport à la 1.19.0 :
- un seul bouton prépare puis publie toutes les classes enregistrées ;
- « Publier le nouveau frais » fonctionne quand la répartition est active ;
- un bouton direct **« Partie 2 — cas sociaux »** est dans le drawer.

Tout se passe dans le Menu, sur le bouton **« Répartition des frais »**. En haut du drawer, l'Administrateur voit l'état (« En préparation » ou « Active ») avec **un seul bouton principal**, qui change à chaque étape. L'icône **« Actualiser »** est à droite. Le lien **« Voir les étapes d'activation »** rappelle les étapes et affiche « Avant « Activer la répartition » : … » avec ce qui manque.

## Qui a le droit de faire quoi

| Action | Qui |
|---|---|
| Voir le drawer et les tableaux | Administrateur, Caissier, Coordination, Sous-coordination ; le personnel seulement pour les rubriques qu'on lui a partagées |
| Créer, préparer, publier, partie 2 | **Administrateur de l'école** seulement |
| Vérifier le solde, justifier, préparer, approuver le solde de départ | **Administrateur de l'école** seulement (vérifié par le serveur) |
| Activer | **L'administrateur qui a approuvé** le solde, et lui seul |
| Paiements et dépenses après l'activation | Caissier et Administrateur (comme d'habitude) ; la répartition est faite par le serveur |

La Coordination ne peut faire aucune étape de préparation ni d'activation. Le bloc d'activation ne s'affiche que pour l'Administrateur, quand une seule école est choisie et que l'année est active.

---

## A. Élèves normaux (partie 1) : créer, préparer, publier

1. **Créer la répartition** : bouton **« + Ajouter »**, puis formulaire **« Ajouter une répartition »**.
   - À remplir :
     - **« Frais existant »** : un frais précis (nom · classe · montant) ;
     - **« Classes concernées »** : cocher les classes ; « Toutes les classes concernées » coche toutes les classes du même frais ;
     - une ligne par rubrique : **« Rubrique 1 »**, **« Mode »** (« Pourcentage » ou « Montant fixe ») et la valeur. Une nouvelle rubrique se crée avec **« + Nouvelle rubrique… »**, puis « Ajouter » (le nom « Non affecté » est réservé) ;
     - **« + Ajouter une ligne »** et **« Retirer la ligne »** pour ajouter ou enlever une rubrique.
   - L'**« Aperçu par classe »** montre les montants. Ce qui n'est donné à aucune rubrique va dans **« Non affecté »**. Le total ne peut pas dépasser le tarif.
   - Bouton **« Enregistrer »**. Le système enregistre un **brouillon** pour chaque classe cochée. Aucun argent ne bouge.
   - **Corriger :** oui, avec **« Reprendre le brouillon »** dans le détail d'une rubrique, ou en refaisant « + Ajouter ».
   - Pas de phrase à taper.

2. **Préparer et publier, en un seul clic** : bouton principal **« Préparer et publier les N classes »** (par exemple « Préparer et publier les 2 classes »). S'il n'y a qu'une classe, le bouton s'appelle **« Préparer et publier la répartition »**.
   - Sous le bouton, la liste des classes concernées : « 2 classes à publier : Minerval · 1re, Minerval · 2e ».
   - **À remplir :** rien. Une exception : si au moins une classe a une partie des cas sociaux différente de celle des élèves normaux, un encadré s'affiche. Il faut taper soi-même **« PUBLIER LA PARTIE DEUX »**, **une seule fois pour toutes les classes** (le copier-coller est bloqué). Le bouton reste grisé tant que la phrase n'est pas exacte.
   - **Ce que fait le système :** pour chaque classe, l'une après l'autre, il fige le brouillon en version, puis il la publie. Il refuse une classe dont le tarif, la classe ou l'option a changé depuis le brouillon. Avant l'activation, aucun argent ne bouge.
   - **Message affiché :** « 2 classes publiées. Aucun argent ne bouge avant l'activation. »
   - **Si l'opération s'arrête en route :** message « 1 classe(s) publiée(s) sur 2. … Cliquez de nouveau pour continuer : les classes déjà publiées ne sont pas refaites. » Un nouveau clic reprend là où l'opération s'était arrêtée.
   - **Corriger :** oui tant que l'école n'est pas active. On refait « + Ajouter » sur le frais et on enregistre : la classe revient dans la liste à publier. Le bouton **« Préparer une version »** existe encore dans le détail d'une rubrique, mais il ne sert plus en pratique.
   - **Tant qu'une classe enregistrée n'est pas publiée, l'étape D.1 n'apparaît pas.**

---

## D. Après la publication : du solde de départ à l'activation

**Règle générale :** toutes ces étapes reposent sur une photo des encaissements et des dépenses. **Le moindre changement efface cette photo** : un paiement, une dépense, une correction, une paie, un brouillon enregistré, une partie 2 publiée ou une justification acceptée. Il faut alors refaire la vérification (D.1), puis le solde de départ (D.3) et l'approbation (D.4). **Mieux vaut ne rien encaisser pendant ces étapes.**

### D.1 Vérifier le solde de départ
- **Où :** bouton principal **« Vérifier le solde de départ »**. Si la vérification est longue, **« Continuer la vérification »** la reprend. **« Suspendre la vérification après cette étape »** la met en pause.
- **À fournir :** rien.
- **Ce que fait le système :** il relit tous les **paiements**, **dépenses** et **autres entrées de caisse** de l'année (100 par étape), puis les répartitions publiées. Il fait trois totaux :
  - encaissements des frais scolaires ;
  - dépenses ;
  - autres entrées de caisse.

  Une écriture d'une autre monnaie que celle de l'année est ignorée.
- **Une écriture est « signalée »** quand :
  - **« Provenance serveur non justifiée »** : elle n'a pas été enregistrée par le circuit sécurisé actuel d'Acadéa (par exemple une ancienne saisie ou un import) ;
  - **« Date ou devise non justifiée »** ;
  - **« Montant non vérifiable »**.
- **Résultat affiché :** « N écritures examinées · … écriture(s) à vérifier » ou « aucune écriture signalée », puis « Vérification terminée. »
- **Corriger :** oui, on peut relancer à tout moment. Après un changement, l'écran affiche « Les écritures ont changé : vérification à actualiser. »
- **Ce qui bloque la suite :**
  - au moins une écriture signalée ;
  - **dépenses supérieures aux encaissements scolaires** : message « Origine des fonds à rapprocher : dépenses supérieures aux recettes scolaires prouvées. » (voir le point bloquant 2).

### D.2 Justifier les écritures signalées (seulement s'il y en a)
- **Où :** bouton principal **« Voir les écritures à vérifier »**. Chaque écriture signalée a un bouton **« Justifier »**. **« Voir les pièces vérifiées »** montre toutes les écritures ; « Pièces suivantes » et « Pièces précédentes » font défiler.
- **À fournir :**
  - **« Preuve autorisée »** : une preuve choisie dans la liste proposée par le serveur. Seuls deux types existent : un **reçu enregistré par le serveur** (« Reçu serveur ») ou, pour une dépense de salaire, la **paie liée** (« Paie liée ») ; **« Rechercher d'autres preuves »** en montre davantage. **On ne peut pas joindre un fichier ni une photo.**
  - **« Motif de justification »** : 10 caractères au moins, 500 au plus.
  - Bouton **« Vérifier la preuve »**. Bouton **« Fermer la justification »** pour sortir.
- **Ce que fait le système :** il contrôle que la preuve est de la même école et de la même année. Elle doit avoir le même montant, la même devise et une date valable ; pour un paiement, le même élève et le même frais. Elle ne doit pas déjà servir à une autre écriture.
  - Si tout concorde : « Justification vérifiée et conservée. Relancez le rapprochement avant toute approbation. »
  - Sinon : « Justification refusée : Pièce serveur absente, non concordante ou déjà utilisée ; ouverture bloquée. »
- **Pas de phrase à taper.**
- **Corriger :** une justification refusée peut être refaite avec une autre preuve. Une justification acceptée reste.
- **Ensuite :** cliquer **« Vérifier le solde de départ »** de nouveau. Une justification acceptée efface la vérification précédente.
- **Si aucune preuve n'existe** (« Aucune preuve liée trouvée dans les reçus examinés. Sans preuve vérifiable, l'activation reste en attente. ») : **aucun moyen de continuer depuis l'écran** (point bloquant 1).

### D.3 Préparer le solde de départ (caisse constatée et partage des fonds)
- **Où :** bouton **« Préparer le solde de départ »**, puis le cadre **« Solde de départ »** et le bouton **« Confirmer le solde de départ »**.
- **L'écran affiche :**
  - **« Fonds scolaires justifiés »** = encaissements scolaires − dépenses ;
  - **« Caisse globale justifiée »** = fonds scolaires justifiés + autres entrées de caisse.
- **À fournir :**
  - **« Caisse constatée (USD) »** (ou CDF) : elle doit être **exactement égale** à la « Caisse globale justifiée ». S'il y a un écart, le serveur refuse avec « Écart de caisse non résolu. » ;
  - **« Ouverture : [rubrique] »** pour chaque rubrique publiée, plus **« Ouverture : Non affecté — uniquement si justifié explicitement »**. Les cases laissées vides comptent pour zéro. La **somme doit être exactement égale aux « Fonds scolaires justifiés »**. Sinon : « Les montants saisis doivent expliquer exactement les fonds scolaires justifiés. Aucune affectation automatique n'est faite. » **Rien n'est partagé automatiquement** : c'est l'Administrateur qui décide du partage.
  - Champ **« Saisissez exactement « RAPPROCHER LA CAISSE » »** : taper **« RAPPROCHER LA CAISSE »**.
- **Ce que fait le système :** il enregistre une **proposition** de solde. L'écran affiche « Solde proposé — école non activée » avec le montant de chaque rubrique.
- **Corriger :** **il n'y a ni bouton « Annuler » ni bouton « Recommencer »** (point bloquant 3). La proposition ne peut être refaite que si une écriture change.
- **Ce qui bloque :** vérification non terminée, ancienne ou avec des écritures signalées ; aucune répartition publiée ; caisse différente ; somme différente ; phrase inexacte (le bouton reste grisé).

### D.4 Approuver le solde de départ
- **Où :** bouton principal **« Approuver le solde de départ »**.
- **À fournir :** taper **« APPROUVER LE RAPPROCHEMENT »** dans le même champ.
- **Qui :** n'importe quel Administrateur de l'école, **y compris celui qui a proposé**.
- **Ce que fait le système :** il marque le solde « approuvé » et retient qui a approuvé. L'école n'est **pas encore active**.
- **Corriger :** pas de bouton d'annulation. Si une écriture change, il faut tout refaire depuis D.1.
- **Ce qui bloque :** une écriture a changé depuis la proposition (« Pièces ou configurations modifiées : refaire le rapprochement. ») ; phrase inexacte.

### D.5 Activer la répartition
- **Où :** bouton principal **« Activer la répartition »**.
- **À fournir :** taper **« ACTIVER LA REPARTITION DE MON ETABLISSEMENT »**, sans accent. Sur une école de test, la phrase est « ACTIVER LA REPARTITION FICTIVE ».
- **Qui :** **seulement l'administrateur qui a approuvé** en D.4. Un autre administrateur voit : « Seul l'administrateur qui a approuvé peut confirmer l'activation. »
- **Ce que fait le système :**
  - il crée le **solde de départ** de chaque rubrique et de « Non affecté », avec les montants de D.3 ;
  - il enregistre la date et l'heure de l'activation (la « coupure ») ;
  - il passe l'école à **« Active »**.
- **Corriger :** **non, c'est définitif.** Il n'y a ni pause ni retour arrière, et la vérification est ensuite interdite (« Rapprochement interdit après activation. »). La répartition d'un frais déjà publié ne peut plus changer cette année.
- **Ce qui bloque :** solde non approuvé ; écriture changée depuis la vérification ; caisse différente de la caisse proposée ; autre administrateur que celui qui a approuvé ; phrase inexacte.

---

## E. Après l'activation

1. **Paiements.** Chaque paiement reçu **après la coupure** est réparti automatiquement selon la version publiée de son frais, sans aucun clic. Un paiement en plusieurs fois est réparti au fur et à mesure ; le total revient toujours aux parts du tarif complet. Un paiement qui ne peut pas être réparti est **quand même encaissé**. Il apparaît « encaissement(s) enregistré(s) en attente de répartition » et il est repris automatiquement à l'ouverture du drawer.
2. **Paiements d'avant la coupure.** Ils ne sont pas répartis un par un : ils sont dans le solde de départ. Pour un élève qui avait déjà payé une partie, ses paiements suivants sont répartis **comme si son compte repartait de zéro** (voir l'exemple).
3. **Dépenses.** Chaque dépense doit être imputée à **une rubrique** (ou « Non affecté », ou une ligne d'arriéré). Elle est refusée si le disponible de la rubrique ne suffit pas : « Solde disponible de la rubrique insuffisant. »
4. **Tableaux.** Les colonnes « Ouverture », « Encaissements cumulés », « Dépenses nettes cumulées » et « Solde disponible » apparaissent.
5. **Arriérés.** Une dette d'une année passée va dans ses propres lignes « … (arriéré AAAA-AAAA) ».
6. **Partie 2 des cas sociaux.** Elle peut encore être publiée ou changée (section B) ; elle vaut pour les paiements suivants.
7. **Nouveau frais.** Voir la section C : « Publier le nouveau frais ».
8. **Partage.** Le bouton **« Partager »** d'une rubrique (« Rubriques de l'année ») donne au personnel choisi une vue en lecture seule ; il faut taper « PARTAGER AVEC CE PERSONNEL ». L'onglet « Partage répartition » permet de la retirer. Renommer une rubrique demande la phrase « RENOMMER CETTE RUBRIQUE ».

---

## B. Cas sociaux (partie 2)

Un « cas social » est un élève qui a une réduction ou une prise en charge sur un frais. Sa partie 2 s'applique à **ce qu'il paie vraiment** (le tarif moins sa réduction). Le reste va dans « Non affecté ». **Sans partie 2, un cas social suit la partie 1.**

1. **Dans « Ajouter une répartition »**, le bloc **« Cas sociaux et prises en charge »** apparaît s'il y a au moins un cas social. Il reprend les mêmes rubriques et les mêmes valeurs au départ. On peut les changer, **« Retirer la ligne »** ou **« Remettre la ligne »**, ou **« Recopier la partie des élèves normaux »**. À la publication :
   - si cette partie est identique à la partie 1, aucune partie 2 n'est créée et aucune phrase n'est demandée ;
   - si elle est différente, il faut taper soi-même **« PUBLIER LA PARTIE DEUX »** au-dessus du bouton « Préparer et publier… » (le copier-coller est bloqué). Les deux parties sont publiées ensemble.
2. **Formulaire « Partie 2 — cas sociaux »** : bouton direct **« Partie 2 — cas sociaux »**, sous la barre « + Ajouter / Frais / PDF ». Il apparaît dès qu'au moins un frais est publié, pour l'Administrateur. Le même bouton existe aussi dans le détail d'une rubrique.
   - On choisit le **« Frais »** et on règle les lignes. **« Recopier la partie 1 »** remet les valeurs de la partie 1 ; **« Appliquer à tous les frais »** recopie les réglages sur les autres frais.
   - On tape **« PUBLIER LA PARTIE DEUX »**, puis on clique **« Publier la partie 2 »**. Tous les frais modifiés sont publiés ensemble ; tout passe ou rien ne passe.
   - **Corriger :** oui, à tout moment, par une nouvelle partie 2. Elle vaut pour les paiements suivants ; un paiement déjà réparti ne change jamais.
3. **Au paiement d'un cas social :**
   - premier paiement après la partie 2 : l'élève est rattaché à cette partie 2 pour l'année ;
   - élève qui avait déjà payé selon la partie 1 : ses paiements suivants complètent chaque rubrique jusqu'aux montants de la partie 2 ;
   - nouvelle partie 2 publiée en cours de route : même principe ;
   - ce qui dépasse son net suit la partie 1.

---

## C. Nouveau frais ajouté en milieu d'année (école déjà active)

1. **« + Ajouter »** : seuls les frais **pas encore répartis** sont proposés. On remplit et on enregistre comme en A.1, avec la partie des cas sociaux si besoin.
2. **Publier** : bouton principal **« Publier le nouveau frais »** (une classe) ou **« Publier les nouveaux frais (N classes) »**. La liste des classes s'affiche dessous.
   - **À remplir :** rien, sauf **« PUBLIER LA PARTIE DEUX »**, à taper une seule fois si une partie des cas sociaux diffère.
   - **Ce que fait le système :** comme en A.2, il prépare puis publie chaque classe. Un nouveau clic reprend après un arrêt.
   - **Message :** « 1 classe publiée. Seuls les paiements reçus à partir de maintenant suivent cette répartition. »
3. **Corriger :** **non**, une fois publié. Un frais déjà réparti ne peut plus changer cette année ; le serveur refuse.
4. **Effet :** la répartition ne vaut que pour les paiements **reçus après** la publication. Ceux de ce frais reçus avant restent entièrement en « Non affecté ». Pour un élève qui avait déjà payé une partie de ce frais, les paiements suivants sont répartis comme si son compte repartait de zéro.
5. **Conseil :** publier le nouveau frais **avant** les premiers paiements, pour que rien ne tombe en « Non affecté ».

---

## Points bloquants trouvés dans le code

**Corrigés en 1.20.1 :**
- le nouveau frais après l'activation : « Publier le nouveau frais » apparaît, et chaque frais à publier est repéré pour lui-même ;
- la préparation et la publication classe par classe : un seul bouton suffit désormais ;
- le formulaire « Partie 2 — cas sociaux », qui était caché : il a maintenant un bouton direct.

**Restent en 1.20.1 (prochain lot « 3 étapes ») :**

1. **Une ancienne écriture sans preuve serveur bloque l'activation pour toujours.** Un paiement, une dépense ou une autre entrée enregistrés en dehors du circuit sécurisé actuel (ancienne saisie, import) sont signalés. Ils ne peuvent être justifiés que par un reçu serveur ou une paie liée. S'il n'en existe pas, l'écran ne propose rien d'autre : pas de pièce jointe, pas de mise à l'écart, pas de décision de l'Administrateur.
2. **Dépenses supérieures aux encaissements scolaires : impasse à l'écran.**
   - La vérification se termine en « BLOQUÉE » avec 0 écriture signalée. L'écran ne propose alors que **« Vérifier à nouveau le solde »**, qui redonne le même résultat.
   - C'est le cas d'une école qui a payé des dépenses avec d'« autres entrées de caisse » : ces entrées ne comptent pas dans les fonds scolaires.
3. **Pas de bouton pour annuler ou refaire un solde proposé ou approuvé.** Une erreur dans le partage entre rubriques ne peut être corrigée qu'après un changement d'écriture, qui efface la proposition. Sinon, il faut approuver et activer avec l'erreur.
4. **« Caisse constatée » n'est pas un vrai comptage.** Elle doit être exactement égale au chiffre calculé. Si la caisse réelle est différente, l'écran ne prévoit aucun moyen de déclarer l'écart.
5. **Le moindre encaissement efface la vérification, la proposition et l'approbation.** Si le Caissier encaisse entre D.1 et D.5, il faut tout refaire. Rien n'empêche d'encaisser pendant ce temps, et rien ne prévient le Caissier.
6. **La ligne « Non affecté — uniquement si justifié explicitement »** demande une justification, mais il n'y a aucun champ pour l'écrire.
7. **Partie 1 republiée avant l'activation sans partie des cas sociaux :** l'ancienne partie 2 n'est plus utilisée. Il faut la republier.

---

## Exemple complet : une petite école, du début à l'activation

**École :** 2 classes (1re et 2e), un frais **Minerval à 120 $** dans chaque classe (donc 2 frais), année en USD.
Rubriques : **Promoteur 40 %**, **Fonctionnement 60 %**. Pour les cas sociaux : **Promoteur 20 %**, **Fonctionnement 40 %**, le reste en « Non affecté ».

**Déjà enregistré avant l'activation, par le circuit normal d'Acadéa :**

| Écriture | Montant |
|---|---|
| Paiement Élève A (1re, normal) | 120 $ |
| Paiement Élève B (1re, normal) | 60 $ |
| Paiement Élève C (2e, normal) | 40 $ |
| Paiement Élève D (2e, cas social, réduction 60 $) | 30 $ |
| Dépense (achat de craies) | 50 $ |
| Autre entrée de caisse (vente de tenues) | 20 $ |

**Étapes :**

1. **« + Ajouter »** : Frais « Minerval · 1re · 120 $ », cocher « Toutes les classes concernées » (1re et 2e). Rubriques Promoteur 40 % et Fonctionnement 60 %. Dans « Cas sociaux et prises en charge » : Promoteur 20 %, Fonctionnement 40 %. Puis **« Enregistrer »**.
2. Le drawer affiche « 2 classes à publier : Minerval · 1re, Minerval · 2e ». La partie des cas sociaux est différente : taper une seule fois **« PUBLIER LA PARTIE DEUX »**, puis cliquer **« Préparer et publier les 2 classes »**. Message : « 2 classes publiées. Aucun argent ne bouge avant l'activation. »
3. **« Vérifier le solde de départ »**. Résultat : « aucune écriture signalée. Vérification terminée. »
   - Encaissements scolaires : 120 + 60 + 40 + 30 = **250 $**.
   - Dépenses : **50 $**.
   - Autres entrées : **20 $**.
4. **« Préparer le solde de départ »**. L’écran affiche :
   - Fonds scolaires justifiés : 250 − 50 = **200 $** ;
   - Caisse globale justifiée : 200 + 20 = **220 $**.

   Saisir :
   - **Caisse constatée : 220** ;
   - **Ouverture : Promoteur 80**, **Ouverture : Fonctionnement 120**, Non affecté vide (80 + 120 = 200, exactement les fonds scolaires ; ici l'Administrateur a choisi 40 % / 60 %) ;
   - phrase **« RAPPROCHER LA CAISSE »**, puis **« Confirmer le solde de départ »**.

   Les 20 $ de la vente de tenues restent hors répartition.
5. **« Approuver le solde de départ »** avec **« APPROUVER LE RAPPROCHEMENT »**.
6. Le **même administrateur** clique **« Activer la répartition »** avec **« ACTIVER LA REPARTITION DE MON ETABLISSEMENT »**. L'école est « Active ».

**Soldes juste après l'activation :** Promoteur 80 $, Fonctionnement 120 $, Non affecté 0 $.

**Paiements après l'activation (répartis automatiquement) :**

| Paiement | Promoteur | Fonctionnement | Non affecté |
|---|---|---|---|
| Élève B paie le reste, 60 $ (compté comme ses premiers 60 $ sur 120 $) | 24 $ | 36 $ | 0 $ |
| Élève C paie 80 $ | 32 $ | 48 $ | 0 $ |
| Élève D (cas social, net 60 $) paie 30 $, partie 2 | 6 $ | 12 $ | 12 $ |
| Élève E (2e, normal, nouveau) paie 120 $ | 48 $ | 72 $ | 0 $ |
| **Total reçu après l'activation (290 $)** | **110 $** | **168 $** | **12 $** |

Calcul pour D : 30 $ sur un net de 60 $, soit la moitié des parts de la partie 2 (12 $ / 24 $ / 24 $), donc 6 $ / 12 $ / 12 $.

**Soldes à ce moment-là :** Promoteur 80 + 110 = **190 $**, Fonctionnement 120 + 168 = **288 $**, Non affecté **12 $**. Total 490 $ = 200 $ de départ + 290 $ reçus.
Une dépense de 100 $ imputée à « Fonctionnement » ferait passer son disponible à 188 $. Une dépense de 200 $ sur « Promoteur » serait refusée (disponible 190 $).

### Rappel des montants par élève (Minerval 120 $)

| Cas | Promoteur | Fonctionnement | Non affecté |
|---|---|---|---|
| Élève normal, paie 120 $ | 48 $ | 72 $ | 0 $ |
| Cas social (réduction 60 $), paie 60 $, partie 2 publiée | 12 $ | 24 $ | 24 $ |
| Même cas social sans partie 2 (la partie 1 s'applique à ses 60 $) | 24 $ | 36 $ | 0 $ |
| Cas social qui a payé 30 $ selon la partie 1, puis 30 $ après la partie 2 | 12 $ puis 0 $ = 12 $ | 18 $ puis 6 $ = 24 $ | 0 $ puis 24 $ = 24 $ |
