# Liste des changements d'Acadéa

Règle : dernier chiffre = correction, chiffre du milieu = nouvelle fonctionnalité, premier chiffre = grand changement.
Chaque PR vers `main` ajoute sa section en tête avec `node scripts/release/version-bump.mjs <type> "Changement"`.

## [1.42.2] — 2026-11-28 — Correction
- F2 : part de l'ouverture des sous-rubriques toujours calculée avec le prévu à jour (Caissier, contrôle des dépenses, tableaux)

## [1.42.1] — 2026-11-28 — Correction
- Écran de connexion : légende de la photo retirée ; sur ordinateur, photo nette entière à gauche et même photo floue à l'endroit à droite (plus de miroir) ; logo sans halo

## [1.42.0] — 2026-11-28 — Fonctionnalité
- Sous-rubriques : pour toute rubrique (bouton « Ajouter sous-rubriques »), dans la Partie 2 des cas sociaux, et leurs soldes dans les tableaux 1-2-3, le PDF et la vue partagée ; bouton « Partie 2 » en double retiré ; même règle partout pour les sous-rubriques (montant fixe converti en %, paiements suivants seulement), ligne « Reste », colonnes remplies

## [1.41.0] — 2026-11-28 — Fonctionnalité
- Écran de connexion : fond flou tiré de la photo, sur ordinateur et téléphone (sans miroir)

## [1.40.2] — 2026-11-28 — Correction
- Calendrier : une section confiée à un responsable désigné n'est modifiable que par lui (vérifié aussi par la règle de sécurité) ; un compte aux sections inconnues de l'école reste en lecture seule

## [1.40.1] — 2026-11-27 — Correction
- Dashboards en lignes complètes de 3 cartes : « Visites de classe » pour le Conseiller pédagogique, 3 cartes de priorités pour le Conseiller d'orientation, 2 cartes (fiches de visite, notes de suivi) dans le Pilotage du Préfet d'études

## [1.40.0] — 2026-11-27 — Fonctionnalité
- Lot 7 : modèle commun de répartition de la Coordination (Modèles de répartition, versions publiées, serveur uniquement)

## [1.39.1] — 2026-11-27 — Correction
- Essai « Teacher documents » stabilisé : préparation à l'avance du code demandé par l'écran de connexion sur le serveur de test (aucun changement de l'application ni de ce que vérifie l'essai)

## [1.39.0] — 2026-11-27 — Fonctionnalité
- Lots 10 et 11 : Conseiller pédagogique et Conseiller d'orientation (section obligatoire, règles des conseillers)

## [1.38.0] — 2026-11-27 — Fonctionnalité
- Sous-rubriques de la répartition : pourcentage ou montant fixe, soldes, blocage des sorties, proposition dans la paie

## [1.37.3] — 2026-11-27 — Correction
- Regroupement des fichiers serveur, lot 3 (Super administrateur) : 9 fonctions sur 12, adresses inchangées

## [1.37.2] — 2026-11-27 — Correction
- Regroupement des fichiers serveur, lot 2 (coordination) : 10 fonctions sur 12, adresses inchangées

## [1.37.1] — 2026-11-27 — Correction
- Regroupement des fichiers serveur, lot 1 (enseignants) : 11 fonctions sur 12, adresses inchangées

## [1.37.0] — 2026-11-27 — Fonctionnalité
- Image de l’écran de connexion modifiable par le Super administrateur

## [1.36.0] — 2026-11-27 — Fonctionnalité
- Préfet d’études : cours et absences des enseignants, situation des paiements, validation des bulletins

## [1.35.3] — 2026-11-27 — Correction
- Règle unique des sections appliquée partout ; demandes d’indisponibilité filtrées par le serveur

## [1.35.2] — 2026-11-27 — Correction
- Seul l’administrateur modifie les sections d’un enseignant déjà créé

## [1.35.1] — 2026-11-27 — Correction
- Section obligatoire pour tout élève (serveur) ; options des Humanités rangées au Secondaire

## [1.35.0] — 2026-11-27 — Fonctionnalité
- Réglages R6 : « Responsable des réglages de la section » désigné par l'administrateur, pris en compte par le calendrier et l'horaire

## [1.34.0] — 2026-11-26 — Fonctionnalité
- Réglages R5 : horaire par section (brouillon, validation et publication par section)

## [1.33.0] — 2026-11-26 — Fonctionnalité
- Réglages R4 : calendrier scolaire par section (un compte d'une partie des sections ne modifie que les événements et le statut de ses sections)

## [1.32.0] — 2026-11-26 — Fonctionnalité
- Réglages R3 : jours de cours et heures du Directeur de discipline par section ; test schoolSearchStatus corrigé sous Windows

## [1.31.0] — 2026-11-26 — Fonctionnalité
- Réglages R2 : demandes d'indisponibilité et Historique pédagogique limités aux sections du compte d'études

## [1.30.0] — 2026-11-26 — Fonctionnalité
- Réglages R1 : qui a modifié quoi (nom, fonction, date) et « Déjà modifié par… » pour les cotes et les affectations

## [1.29.0] — 2026-11-26 — Fonctionnalité
- Préfet d'études : bouton « Discipline » (incidents et sanctions de ses sections, en lecture seule)

## [1.28.0] — 2026-11-25 — Fonctionnalité
- Préfet d'études : tableau « Pilotage de mes sections » (effectifs, présence du jour, élèves en difficulté, absences approuvées aujourd'hui)

## [1.27.3] — 2026-11-25 — Correction
- Alertes téléphone et notification « Prise en charge enregistrée » pour le personnel ; « Enfants » sans bande du haut, toujours 3e du Menu

## [1.27.2] — 2026-11-25 — Correction
- « Enfants » s'ouvre sans rechargement ; bouton « Enfants » 3e du Menu

## [1.27.1] — 2026-11-25 — Correction
- Notification de paiement envoyée aussi au membre du personnel dont l'enfant est pris en charge

## [1.27.0] — 2026-11-25 — Fonctionnalité
- Onglet « Enfants » pour le personnel : enfants à charge, frais, paiements et reçus

## [1.26.1] — 2026-11-25 — Correction
- Écran de connexion sur téléphone selon la maquette validée : photo à moitié, avantages animés sur la photo, formulaire à plat sans défilement ; ordinateur : seulement les animations de la photo

## [1.26.0] — 2026-11-25 — Fonctionnalité
- Direction des études : nouveau libellé, champ « Fonction » (Directeur des études, Préfet d'études, Directeur primaire, Directrice maternelle) affichée seule ; création et modification d'enseignants limitées aux sections du directeur, vérifiées par le serveur

## [1.25.5] — 2026-11-25 — Correction
- Écran de connexion sur téléphone : la photo redevient visible (slogan sous la photo, dégradé léger, carte qui ne la recouvre plus) ; ordinateur inchangé

## [1.25.4] — 2026-11-24 — Correction
- Écran de connexion : photo, slogan « La gestion scolaire dans ma poche » et 4 avantages (proposition B)

## [1.25.3] — 2026-11-24 — Correction
- ship-lot.sh attend que la construction soit prête chez Vercel avant les vérifications ; une preuve de source laissée par une construction coupée ne bloque plus ; met en ligne la 1.25.0 (Valves)

## [1.25.2] — 2026-11-24 — Correction
- ship-lot.sh : reprise d'une PR déjà fusionnée dont la construction a échoué, et message d'erreur de la construction écrit dans le journal ; met en ligne la 1.25.0 (Valves)

## [1.25.1] — 2026-11-24 — Correction
- Remise en ligne de la 1.25.0 (Valves : la Visibilité est respectée par les règles de sécurité) après une construction interrompue faute de ressources sur le poste

## [1.25.0] — 2026-11-24 — Fonctionnalité
- Valves : la Visibilité est respectée par les règles de sécurité ; un parent ne lit que les publications qui le concernent ; bouton « Mettre à jour le public » ; script de reprise des publications existantes

## [1.24.3] — 2026-11-24 — Correction
- Valves : photos PNG mieux compressées, publications et notifications seulement pour les familles d'enfants encore inscrits, chargement limité à l'année

## [1.24.2] — 2026-11-24 — Correction
- Remise en ligne de la 1.24.1 (Année scolaire sans rechargement) après une vérification interrompue par le réseau ; ship-lot.sh s'arrête si l'adresse de la version précédente est introuvable

## [1.24.1] — 2026-11-24 — Correction
- Formulaire Année scolaire : il s'ouvre tout de suite avec les données déjà chargées, sans tout relire à chaque ouverture

## [1.24.0] — 2026-11-24 — Fonctionnalité
- Lot F du caissier : remboursement en espèces du trop-perçu lors d'un changement de classe, pris dans « Non affecté », reçu en deux exemplaires

## [1.23.1] — 2026-11-24 — Correction
- Changement d'onglet : l'écran s'ouvre toujours tout en haut, dans tous les modules, sur téléphone et sur ordinateur

## [1.23.0] — 2026-11-24 — Fonctionnalité
- Lot E du caissier : changement de classe d'un élève qui a payé, par le caissier seulement ; paiements rattachés à la nouvelle classe et rubriques corrigées par des écritures inverses ; classe fermée aux écritures directes

## [1.22.0] — 2026-11-23 — Fonctionnalité
- Trop-perçu visible partout : fiche de l'élève, Contrôle (cartes, historique, PDF), tableau de bord de l'école et de la coordination (écran et PDF), fiche vue par la coordination ; le reste à payer ne change pas

## [1.21.1] — 2026-11-23 — Correction
- Partie 2 des cas sociaux réservée à l'Administrateur de l'école : lecture et publication refusées aux autres rôles, écran réservé

## [1.21.0] — 2026-11-23 — Fonctionnalité
- Répartition des frais : mise en route en 3 étapes (vérifier et justifier, valider le solde de départ, activer), école sans paiement activée directement, justification par motif écrit et photo, écart de caisse, dépenses supérieures aux encaissements, solde annulable, encaissements pendant la mise en route répartis à l'activation, justification de « Non affecté »
- Justifications des écritures (motif, photo) consultables plus tard, seulement par l'Administrateur de l'école (« Répartition des frais ») et par le Coordinateur et le Sous-coordinateur pour les écoles qu'ils supervisent (Menu, « Historique ») ; jamais par le Super administrateur
- Historique du Menu Administrateur : s'ouvre sur les activités d'aujourd'hui

## [1.20.3] — 2026-11-23 — Correction
- La page /version.json montre le numéro de version et la date de mise en ligne, et n'est plus gardée en mémoire par le navigateur

## [1.20.2] — 2026-11-23 — Correction
- Répartition des frais : boutons des formulaires mieux placés (« Annuler », « Appliquer à tous les frais », « Retirer la ligne ») et PDF court, un tableau par page

## [1.20.1] — 2026-11-23 — Correction
- Répartition des frais : quand la répartition est active, « Publier le nouveau frais » apparaît et fonctionne pour un frais ajouté en milieu d'année ; chaque frais à publier est repéré pour lui-même ; un seul bouton prépare puis publie toutes les classes ; bouton direct « Partie 2 — cas sociaux » dans le drawer.

## [1.20.0] — 2026-11-23 — Fonctionnalité
- Super administrateur, drawer d'une école plus léger : nombres (élèves, parents, comptes, classes) calculés par le serveur en une seule demande, historique affiché 10 lignes à la fois avec « Voir plus » (index de l'historique), au lieu de télécharger toutes les données de l'école.

## [1.19.0] — 2026-11-23 — Fonctionnalité
- Partie 2 — cas sociaux : un seul formulaire pour tous les frais (liste des frais, « Appliquer à tous les frais », frais marqués « modifié »), une seule publication avec la phrase « PUBLIER LA PARTIE DEUX » tapée à la main, « Non affecté » reçoit toujours le reste (total inférieur à 100 % permis), partie des cas sociaux dans « Ajouter une répartition » publiée en même temps, et un cas social qui avait déjà payé selon la partie 1 suit la partie 2 pour ses paiements suivants.

## [1.18.7] — 2026-11-22 — Correction
- Super administrateur, onglet Écoles : compteur « 29 écoles » sans « recherche… » bloqué, la recherche n'est plus relancée à l'ouverture d'une école, et les données d'une école déjà ouverte s'affichent tout de suite (relues seulement si l'école a changé ou avec « Actualiser »)

## [1.18.6] — 2026-11-22 — Correction
- Partie 2 des cas sociaux : bouton « Retirer la ligne » sur chaque rubrique et sur « Non affecté » ; une ligne retirée ne reçoit plus rien et la publication n'est plus refusée

## [1.18.5] — 2026-11-21 — Correction
- Notifications : sur un téléphone partagé, l'ancien compte ne reçoit plus ses notifications quand un autre compte active les siennes ; le jeton du navigateur est retiré même sans réseau (P4 lot 4)

## [1.18.4] — 2026-11-21 — Correction
- Changement de classe refusé (écran et serveur) pour un élève qui a déjà des paiements cette année, en attendant le remboursement automatique du trop-perçu ; sans paiement, le changement reste possible

## [1.18.3] — 2026-11-21 — Correction
- Aucune donnée d'un compte visible pour le suivant quand la session se termine toute seule (compte désactivé, session expirée) ou quand un autre compte se connecte dans un autre onglet (P4 lot 3)

## [1.18.2] — 2026-11-21 — Correction
- Historique : ajouts et modifications d'élèves (qui, quand, avant / après) dans le drawer « Historique » de l'administrateur, avec toutes les activités des utilisateurs de l'école, filtres utilisateur, type et période, et « Voir plus » ; bouton « Ajouter un élève » du caissier sur une seule ligne, avec l'icône de l'onglet Élèves ; bandeau de l'élève sélectionné avec le nom seul

## [1.18.1] — 2026-11-21 — Correction
- Répartition des frais : boutons « Enregistrer » et « Ajouter », champ « Nouvelle rubrique » assez large, icône « Actualiser » à droite du statut ; sans répartition configurée, ni tableaux ni « Non affecté » (écran et PDF), seulement « Aucune répartition n'est encore configurée. », suivi de « Cliquez sur « + Ajouter » pour commencer. » pour les comptes qui ont ce bouton

## [1.18.0] — 2026-11-21 — Fonctionnalité
- Caissier : fiche élève depuis « Enregistrer un paiement » (stylo, « Ajouter un élève », retour au paiement), mêmes droits que le secrétaire sur la fiche élève, historique des modifications visible par l'administrateur, et correction de « Aucun élève trouvé. »

## [1.17.1] — 2026-11-21 — Correction
- PDF : nom de l'école et titre du document à nouveau en gras ; la date de génération reste dans son cadre (reçu, dépense et tous les PDF à bandeau)

## [1.17.0] — 2026-11-21 — Fonctionnalité
- Super administrateur : les destinataires des messages se cherchent par nom, page par page, et la messagerie ne se recharge plus à chaque ouverture (lot 6)

## [1.16.8] — 2026-11-20 — Correction
- Messages d'erreur clairs en français partout (réseau, délai, session, autorisation), bouton « Réessayer » qui relance vraiment, relance automatique des chargements au retour du réseau (jamais pour l'argent)

## [1.16.7] — 2026-11-20 — Correction
- Écran de connexion : retrait du rappel « téléphone partagé » ajouté avec la 1.16.6

## [1.16.6] — 2026-11-20 — Correction
- Déconnexion : nettoyage complet de l'appareil (mémoires, devises des dépenses, copies hors ligne, notifications affichées), puis page rechargée ; les brouillons non envoyés restent
- Page de connexion : rappel pour les téléphones partagés

## [1.16.5] — 2026-11-20 — Correction
- Rapport financier PDF : tous les paiements et toutes les dépenses de la période (plus de coupure à 24 lignes), colonne Classe remplie, totaux des tableaux égaux à la synthèse

## [1.16.4] — 2026-11-20 — Correction
- Effacement d'école : une coupure réseau ne recrée plus une école vide « en cours d'effacement »
- Recette Publicité (staging) : ses écoles et comptes d'essai sont effacés au lieu d'être désactivés

## [1.16.3] — 2026-11-20 — Correction
- Déconnexion : elle se termine toujours, même sans réseau (le compte précédent ne revient plus au rechargement)
- Déconnexion : avertissement s'il reste des brouillons non envoyés (ils restent sur l'appareil, réservés au compte, et ne sont jamais supprimés)

## [1.16.2] — 2026-11-20 — Correction
- Reçu de paiement : description du paiement à la place du caissier, nom et fonction du caissier sous la signature
- PDF (tous les documents à bandeau) : le logo de secours en lettres, utilisé quand l'école n'a pas d'image de logo, reste sur une ligne dans son carré ; un sigle long comme « GSAGAPÉ » ne laisse plus un « E » déborder sous le carré

## [1.16.1] — 2026-11-20 — Correction
- Super administrateur : l'ouverture ne charge plus toutes les écoles ni toutes les années ; une école se lit à l'ouverture de son drawer, toutes les écoles seulement pour les écrans qui en ont encore besoin

## [1.16.0] — 2026-11-19 — Fonctionnalité
- Super administrateur : la recherche des écoles est faite par le serveur (liste de recherche tenue à jour automatiquement), 25 écoles par page avec « Voir plus »

## [1.15.3] — 2026-11-19 — Correction
- Présence (Directeur de Discipline) : l'onglet reste en mémoire après sa première ouverture et s'affiche tout de suite au retour ; tris des élèves beaucoup plus rapides

## [1.15.2] — 2026-11-19 — Correction
- Répartition des frais : mise à jour seulement quand quelque chose change (compteur tenu par le serveur, plus de vérification en boucle), état d'activation qui finit toujours de charger, description dans le Menu, commandes sur une ligne au téléphone, renommage par phrase tapée à la main, partage dans un drawer à part, « Préparer la nouvelle version » seulement quand c'est possible, textes justifiés, bouton Actualiser en icône, boutons moitié-moitié (répartition et archivage d'un élève)

## [1.15.1] — 2026-11-19 — Correction
- Recherche des élèves plus légère : le matricule se trouve par son début ou sa fin, l'option est filtrée après une recherche, 12 index inutiles retirés

## [1.15.0] — 2026-11-19 — Fonctionnalité
- Campagnes publicitaires dans l'en-tête : bannière « Publicité » tournante (30 s par défaut, part d'affichage), gérée par le Super administrateur, jamais sur les reçus, rapports, PDF ni écrans de paiement, statistiques groupées sans donnée personnelle

## [1.14.0] — 2026-11-19 — Fonctionnalité
- Répartition des frais : rubrique d'imputation au-dessus du solde avec les montants de la rubrique, blocage au-delà de son disponible, précision obligatoire pour la nature « Autre », texte des étapes d'activation mis à jour, boutons « Partager » et « PDF », onglets fixes, filtres adaptés au téléphone, phrases de confirmation pour partager et retirer

## [1.13.4] — 2026-11-19 — Correction
- Dashboard Coordination et Sous-coordination : les écoles exclues sont nommées avec leur année active et la façon de corriger ; aucun chiffre à 0 n'est affiché ni exporté quand aucune école n'est comptée

## [1.13.3] — 2026-11-19 — Correction
- Recettes automatiques du staging : elles effacent désormais complètement leurs écoles d'essai à la fin (écoles, documents, sous-documents, signaux, fichiers, comptes) au lieu de les désactiver ; commande de nettoyage des écoles d'essai déjà retirées (essai à blanc, effacement, vérification). Staging uniquement.

## [1.13.2] — 2026-11-19 — Correction
- Messages : le destinataire Coordinateur apparaît tout de suite et l'écran ne s'actualise plus en boucle

## [1.13.1] — 2026-11-19 — Correction
- Super administrateur : l'onglet Messages ne montre plus que « Nouveau message » ; « Messages et réponses » n'est plus que dans la cloche (lot SA-6a).

## [1.13.0] — 2026-11-18 — Fonctionnalité
- Répartition des frais : deux onglets et partage des rubriques avec le personnel
  - Onglets « Répartition annuelle » et « Partage répartition » (Administrateur seulement)
  - « Afficher » partage une rubrique avec tout le personnel (y compris celui ajouté plus tard) ou des personnes choisies, avec un espace Acadéa
  - Le personnel voit un seul drawer, en lecture seule : la ligne d'ensemble des rubriques partagées, PDF compris ; aucun élève ni autre rubrique
  - Retrait à une personne ou à tout le personnel, pour tout le drawer ou des rubriques au choix
  - « Rubriques de l'année » : plus de « Ajouter une rubrique » ni « Masquer » ; « Supprimer » seulement pour une rubrique jamais utilisée
  - Une rubrique créée par « + Nouvelle rubrique… » n'est enregistrée qu'avec la répartition

## [1.12.0] — 2026-11-18 — Fonctionnalité
- Dashboard Super administrateur : chiffres calculés par le serveur (écoles et administrateurs recomptés à chaque ouverture, élèves et parents gardés 10 minutes avec l'heure du calcul), « — » pendant le chargement au lieu de 0, écoles supprimées exclues de la carte « Écoles » (lot SA-3).

## [1.11.7] — 2026-11-18 — Correction
- Vérifications GitHub moins coûteuses : exécutions dépassées annulées, outils de test gardés

## [1.11.6] — 2026-11-18 — Correction
- Prévu du tableau 2 : chaque cas social suit la partie qu'il utilise vraiment
  - Déjà réparti selon la partie 1 : partie 1 ; selon une partie 2 : celle-ci puis les suivantes ; sans paiement réparti : la partie 2 publiée
  - Le prévu gardé est recalculé au premier paiement réparti d'un cas social (ou à un changement de partie 2)
- Note (décision du 18/11) : un arriéré d'une année passée qui n'avait pas de répartition publiée reste encaissé en « Non affecté (arriéré AAAA-AAAA) », même si le prévu suivrait la répartition de cette année si elle existait. Aucun écart aujourd'hui ; choix volontaire, pas de correction prévue.

## [1.11.5] — 2026-11-18 — Correction
- Outils de mesure du Super administrateur sur le staging : mesure par onglet, lectures Firestore minute par minute, création, effacement et vérification d'écoles fictives (lot SA-0). Aucun changement pour les utilisateurs.

## [1.11.4] — 2026-11-18 — Correction
- Répartition des frais : créer deux rubriques à la suite ne referme plus le champ de la seconde ; test e2e fiabilisé

## [1.11.3] — 2026-11-18 — Correction
- Logo de l'école rangé à part : les écrans lisent des données d'école beaucoup plus légères, le logo est lu seulement quand il s'affiche

## [1.11.2] — 2026-11-18 — Correction
- Dashboards : les vérifications (devises historiques, arriérés, actualisation) se font discrètement, sans bandeau temporaire ni saut de page ; des squelettes gris gardent la place des chiffres, jamais un chiffre provisoire.

## [1.11.1] — 2026-11-18 — Correction
- Partie 2 corrigée : les paiements suivants des cas sociaux suivent la nouvelle partie 2 (lot 27c-4)

## [1.11.0] — 2026-11-18 — Fonctionnalité
- Partie 2 de la répartition, propre aux cas sociaux (lot 27c-4)

## [1.10.0] — 2026-11-18 — Fonctionnalité
- Répartition des frais : prévu des lignes d'arriérés (ce que les élèves actifs devaient encore au début de l'année, par année passée)

## [1.9.5] — 2026-11-18 — Correction
- Dettes des années antérieures : affichage plus rapide (lectures groupées, lecture seule), gardées en mémoire par élève et recalculées seulement si un paiement d'arriéré ou la fiche change ; indicateur de chargement sur cette section seulement

## [1.9.4] — 2026-11-18 — Correction
- Contrôle (Coordination) : « Toutes les années » retiré (écran financier) ; Cas sociaux : l'année active est choisie par défaut

## [1.9.3] — 2026-11-18 — Correction
- Reçus : jamais deux fois le même numéro dans une école (compteur par école et par préfixe) ; comptes : jamais deux comptes de connexion pour la même adresse e-mail

## [1.9.2] — 2026-11-18 — Correction
- Matricules des élèves : numéro calculé sur toute l'école, toutes années confondues, avec un compteur unique par école et par préfixe ; un matricule ne peut plus être donné deux fois, même lors d'inscriptions simultanées

## [1.9.1] — 2026-11-18 — Correction
- Listes « Année scolaire » (tous les rôles) : années « (ne pas utiliser) » cachées partout sans être supprimées ; un seul premier choix « 2026-2027 (année active) », sélectionné par défaut, puis les années passées de la plus récente à la plus ancienne, puis « Toutes les années »

## [1.9.0] — 2026-11-18 — Fonctionnalité
- Ouverture d'une année scolaire : seulement le nom (dates calculées), année en avance ou passée refusée avec un message clair (bascule le 1er août, année suivante dès le 1er juillet, heure de Kinshasa), pour le Coordinateur comme pour l'Administrateur d'une école libre ; identifiant différent si l'ancien existe déjà

## [1.8.1] — 2026-11-17 — Correction
- Onglet Élèves : « Tous » en premier dans le filtre (Tous, Actifs, Archivés, Filles, Garçons), à l'école comme en Coordination et Sous-coordination

## [1.8.0] — 2026-11-17 — Fonctionnalité
- Répartition des frais : chaque arriéré encaissé va dans sa propre ligne « … (arriéré AAAA-AAAA) » avec son disponible, regroupée sous « Arriérés AAAA-AAAA » dans les trois tableaux et le PDF ; le Caissier peut y imputer une dépense ou un paiement du personnel dans la limite du disponible

## [1.7.0] — 2026-11-17 — Fonctionnalité
- Onglet Élèves : filtres « Filles » et « Garçons » (élèves actifs), nombre d'élèves pour chaque choix et signalement des fiches sans sexe renseigné

## [1.6.0] — 2026-11-17 — Fonctionnalité
- Anciens élèves : chaque paiement compte du même montant dans le prévu et dans l'encaissé (tableaux de bord Administrateur et Caissier, Coordination, Sous-coordination, rapport financier, Répartition des frais et PDF), avec la mention « dont anciens élèves »

## [1.5.0] — 2026-11-17 — Fonctionnalité
- Répartition des frais : espace clair entre les trois tableaux (écran, téléphone, PDF)
- Répartition des frais : drawer préparé dès la connexion, affiché tout de suite à chaque ouverture, mis à jour seulement quand quelque chose change réellement
- Prévu annuel gardé côté serveur : les élèves ne sont relus que s'ils ont changé (beaucoup moins de lectures)

## [1.4.0] — 2026-11-17 — Fonctionnalité
- Répartition des frais : trois tableaux avec les mêmes colonnes — élèves normalement inscrits, cas sociaux et prises en charge, ensemble (somme des deux).
- Ouverture et dépenses d'une rubrique partagées entre les tableaux 1 et 2 à proportion de leurs encaissements ; « Non affecté » dans chaque tableau ; rubrique sans montant cachée.
- Pourcentage après le nom de la rubrique (« Salaires (60 %) », ou « (40 % et 60 %) » avec le détail par frais), dans les tableaux et le PDF.
- PDF : textes justifiés, école, année et devise une seule fois en en-tête.
- Technique : l'extension de construction « @vitejs/plugin-react » est rangée parmi les outils de développement (elle ne fait pas partie de l'application en ligne) ; l'audit de sécurité des dépendances de production repasse sans alerte élevée.

## [1.3.0] — 2026-11-17 — Fonctionnalité
- Répartition des frais : catalogue des rubriques propre à chaque école et à chaque année ; choix dans une liste déroulante avec « + Nouvelle rubrique… » ; une rubrique réutilisée additionne ses montants sans doublon.
- Rubriques : renommer à tout moment ; supprimer seulement si jamais utilisée, sinon masquer (l'historique reste).
- Enregistrer une dépense et Paiement du personnel : même liste de rubriques (avec « Non affecté »), disponible affiché ; une rubrique masquée n'est plus proposée.

## [1.2.0] — 2026-11-17 — Fonctionnalité
- Répartition des frais : tâche automatique toutes les 10 minutes qui reprend tous les paiements en attente (créations, corrections et suppressions), sans dépendre d'un écran.
- Alerte (notification et badge) à l'Administrateur de l'école et au Super administrateur si un paiement reste en attente plus d'une heure.
- Contrôle chaque nuit : tout l'encaissé doit être réparti au centime près, par école, année et devise ; alerte détaillée au Super administrateur en cas d'écart.
- Garantie testée qu'un paiement n'est jamais réparti deux fois, même si plusieurs reprises se croisent.

## [1.1.1] — 2026-11-17 — Correction
- Procédure de version et de mise en production commune à tous les agents (scripts/release, CHANGELOG.md, AGENTS.md, CLAUDE.md) et contrôle GitHub version-check.

## [1.1.0] — 2026-11-17 — Fonctionnalité
- Répartition des frais : un paiement d'élève n'est plus jamais bloqué ; s'il ne peut pas être réparti tout de suite, il est mis en attente puis repris automatiquement par le serveur (juste après le paiement, avant chaque dépense ou paiement du personnel) (PR #86).
- Suppression de la pause de la répartition (PR #86).
- 11 tests de non-régression des formulaires de dépense et de paiement du personnel (PR #86).

## [1.0.0] — 2026-11-17 — Version de départ
- Numéro de version affiché sous « Déconnexion » dans le Menu de tous les rôles (PR #85).
- Base : lots 20 à 26c déjà en production (messagerie, notifications push, cas sociaux réservés à l'Administrateur, suppression des tiers, correctifs des drawers).
