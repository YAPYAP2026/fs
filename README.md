# VR4 – Entraînements

Webapp pour composer et revoir des entraînements de Vol Relatif à 4 (pool FAI/FFP 2025).

## Lancer

```powershell
python -m http.server 8000
```

Puis ouvrir http://localhost:8000. Un serveur est nécessaire car les modules JS ne se chargent pas en `file://`.

## Utilisation

- **Entraînement** : choisir, créer, dupliquer ou supprimer depuis la barre du haut. Le nom et la date se modifient directement en haut de la page.
- **Vols** : chaque carte est une série de figures. Le vol encadré en bleu est le vol *actif*.
- **Ajouter des figures** : cliquer sur une figure dans la liste de droite (l'ajoute au vol actif) ou la glisser dans n'importe quel vol.
- **Réorganiser** : glisser les figures (dans un vol ou vers un autre), glisser la poignée ⠿ pour déplacer un vol. Boutons ← → × / ↑ ↓ en alternative (tactile).
- **Revoir** : ▶ affiche les figures une à une en plein écran (flèches du clavier, espace, swipe, Échap pour fermer).
- **Partager** : copie le lien de l'entraînement courant. L'adresse se met à jour à chaque modification ; ouvrir le lien charge l'entraînement. Les données sont aussi conservées dans le navigateur (localStorage).

## Installer comme application

L'application est installable (PWA) et fonctionne hors ligne après une première visite :
- **Android (Chrome)** : menu ⋮ → « Installer l'application » ou « Ajouter à l'écran d'accueil ».
- **iPhone (Safari)** : Partager → « Sur l'écran d'accueil ».
- **Ordinateur (Chrome/Edge)** : icône d'installation dans la barre d'adresse.

Fichiers : `manifest.webmanifest`, `sw.js` (service worker, réseau d'abord puis cache), `icons/`.

## Fichiers

- `assets/pages/` : pages extraites de `figures.pdf` (`python -I tools/extract_pages.py`).
- `js/skydiver.js` : rendu SVG d'un parachutiste (modèle unique, coloré) et des flèches de rotation.
- `js/formations.js` : données des 82 vignettes, modifiables à la main. Pour chaque parachutiste : couleur, centre `x`/`y`, cap `r` (degrés), extrémités des bras `la`/`ra` et jambes `ll`/`rl` en coordonnées locales du corps ; coudes et genoux sont calculés automatiquement.
- `tools/extract_formations.py` : a généré `js/formations.js` en mesurant les images du PDF (nécessite `python -m pip install --user Pillow numpy scipy` ; ~3 s pour les 82 vignettes). Attention : le relancer écrase les modifications faites à la main.
- `js/figures.js` : catalogue des figures.
- `tools/catalog.html` : page de contrôle de toutes les vignettes.
