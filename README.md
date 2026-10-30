# ⛳ Ligue de golf

Petit site pour compiler les statistiques de notre ligue de golf sur simulateur (GS Pro).
Aucun serveur ni installation : juste `index.html`, `style.css`, `app.js` et `data/ligue.json`.

## Ce que le site fait

- **Parties** : date, terrain, trous joués (9 ou 18), normale, joueurs présents, formule
  (*2 balles meilleure balle* avec équipes qui changent, ou *chacun pour soi*), score, notes.
- **Statistiques personnelles** (facultatif) : putts, allées atteintes, verts en régulation, oiselets, plus long départ.
- **Classement** par saison, **fiche de chaque joueur** (moyenne vs normale, meilleure ronde,
  fiche en équipe, meilleur partenaire, historique) et **records par terrain**.

## Système de pointage

Après chaque partie, chaque joueur reçoit (valeurs modifiables dans *Réglages*) :

| | Points |
|---|---|
| Participation | 1 |
| Par **joueur adverse** battu (égalité = ½) | 1 |
| Bonus 1re place (partagé si égalité) | 2 |

Le même calcul sert pour les deux formules : en meilleure balle, battre une équipe de 2
compte pour 2 adversaires, et les deux coéquipiers reçoivent les points.

Exemples : gagner 2 contre 2 = **5 pts** chacun · gagner en solo contre 3 = **6 pts** ·
gagner en solo contre 5 = **8 pts** · dernier = **1 pt**.
Le classement est toujours recalculé à partir des parties, donc changer les réglages s'applique à tout l'historique.

## Mettre en ligne (GitHub Pages)

Dans le dépôt GitHub : *Settings → Pages → Branch* : choisir la branche et le dossier `/ (root)`.

## Accès : lecture seule ou modification

Par défaut, le site est en **lecture seule** : on voit tous les onglets et toutes les statistiques,
sans pouvoir rien changer.

Pour modifier, toucher **🔒 Lecture seule** en haut à droite et entrer le mot de passe
(par défaut : `golf2026`). Le navigateur reste en mode édition jusqu'à ce qu'on touche **🔓 Mode édition**.
Pour changer le mot de passe pour tout le monde, changer `DEFAULT_EDIT_HASH` dans `app.js` (empreinte SHA-256).

⚠️ Ce mot de passe empêche les modifications par erreur, mais ce n'est pas une vraie sécurité :
le site n'a pas de serveur. Ça empêche les modifications par erreur, pas un pirate.

## Où sont les données ?

Les parties officielles sont dans `data/ligue.json`. Après chaque soirée, envoyer la photo de la carte
GS Pro à Claude, qui ajoute la partie au fichier : tout le monde la voit en quelques minutes.

Les changements faits en mode édition restent seulement dans le navigateur où ils ont été faits.
À l'ouverture, chaque navigateur prend la version la plus récente entre la sienne et celle du site,
et garde une copie de sécurité avant de remplacer quoi que ce soit (*Réglages → Données*).

Après une modification de `app.js` ou `style.css`, augmenter le numéro `?v=` dans `index.html` pour que les navigateurs chargent la nouvelle version.

Pour tester en local : `python3 -m http.server` puis ouvrir http://localhost:8000.
