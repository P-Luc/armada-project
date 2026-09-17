# ARMADA

Jeu de cartes à collectionner de combat spatial. Deux joueurs défendent leur station spatiale (20 PV) avec une flotte de vaisseaux alimentée par des générateurs d'énergie orbitale.

## Documentation

- [`PLAN.md`](PLAN.md) — plan de développement complet
- [`docs/regles.md`](docs/regles.md) — règles officielles v1 (fait foi)
- [`docs/cartes-set-initial.md`](docs/cartes-set-initial.md) — set « Première Flotte » (60 cartes)

## Démarrage

```bash
npm install
npm run dev       # interface web (IA, hot-seat ou en ligne) → http://localhost:5173
npm run server    # serveur de jeu en ligne (WebSocket, port 8787)
npm test          # tests unitaires du moteur + intégration serveur
npm run typecheck # vérification TypeScript
npm run cli       # jouer une partie en hot-seat dans le terminal
npm run sim       # équilibrage : N parties IA contre IA (npm run sim -- 500)
npm run build     # build de production (dist/)
```

**Jeu en ligne** : lancez `npm run server` puis `npm run dev`. Dans le panneau « En ligne » du lobby : pseudo + mot de passe (le compte est créé au vol à la première connexion, mot de passe haché en scrypt côté serveur), deck, puis « Partie rapide » (file d'attente) ou partie privée par code à partager. Le bandeau affiche ensuite le bilan, la collection et les boosters du compte — « Ouvrir un booster » tire 5 cartes, « Changer de compte » oublie le jeton local. Tour limité à 90 s (fin de tour forcée). En cas de déconnexion, revenez et cliquez « Partie rapide » : le jeton de session (localStorage) vous ramène dans la partie en cours. Le serveur est autoritaire : il ne transmet jamais la main ni l'ordre du deck adverses (`redactView`).

Variables d'environnement : `VITE_WS_URL` (client → serveur distant), `PORT` et `ARMADA_DB` (serveur : port et fichier SQLite, `data/armada.db` par défaut).

**Interface web** : pour chaque joueur, choisissez Humain ou IA et un deck (par défaut : vous contre l'IA). Cliquez (ou glissez) une carte pour la jouer ; cliquez un de vos vaisseaux puis sa cible pour attaquer, ou choisissez « ⛨ mettre en garde » (glisser le vaisseau sur votre station fonctionne aussi) ; les cibles légales sont surlignées en or, les cartes jouables pulsent en cyan, et le tour se termine automatiquement quand plus aucune action n'est possible. En hot-seat (2 humains), un écran de passation cache les mains entre les tours. IA contre IA = mode spectateur. `http://localhost:5173/?seed=42` rejoue exactement la même partie.

**Mode console** : tapez `aide` en jeu pour la liste des commandes ; `npm run cli -- 42` pour fixer la graine.

**Vérification navigateur** (nécessite `npm run dev` actif et Google Chrome) :
`node scripts/smoke.mjs` (parcours de chargement), `node scripts/e2e-bot.mjs` (un bot joue 10 tours par l'interface) et `node scripts/e2e-online.mjs` (deux navigateurs : comptes, appariement, coups croisés, reconnexion après rechargement, abandon, booster). Le script en ligne lance lui-même le serveur de jeu sur une base jetable — le port 8787 doit être libre.

## Structure

```
src/core/   moteur de règles pur (déterministe, sans dépendance UI)
  types.ts  modèle d'état et définitions de cartes
  cards.ts  les 60 cartes du set + jetons (données + effets)
  game.ts   actions, combat, vérifications d'état
  actions.ts actions sérialisées (client/serveur) + vues expurgées
  ai.ts     adversaire IA (gloutonne à un coup d'avance)
  decks.ts  decks de démarrage et validation de deck
src/server/ serveur de jeu autoritaire (WebSocket, matchmaking, reconnexion)
  server.ts protocole : auth/hello, file d'attente, parties privées, actions, boosters
  store.ts  persistance SQLite : comptes, jetons, collection, decks, bilan
src/cli/    interface console hot-seat
src/web/    interface web React (Vite) : local, hot-seat, IA et en ligne
scripts/    vérifications navigateur (Playwright + Chrome local)
tools/      simulateur d'équilibrage IA contre IA
tests/      tests unitaires + intégration serveur (vitest)
```
