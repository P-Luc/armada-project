# ARMADA — Plan de développement
*Jeu de cartes à collectionner (JCC) de combat spatial*

---

## 1. Vision du jeu

Deux joueurs s'affrontent dans une bataille orbitale. Chaque joueur défend sa **station spatiale (20 points de vie)** et tente de détruire celle de l'adversaire en déployant une **flotte de vaisseaux** alimentée par des **générateurs d'énergie orbitale**.

- **Genre** : JCC 1 contre 1 (inspiration : Magic, Hearthstone)
- **Plateforme cible (phase 1)** : jeu web (navigateur), puis mobile éventuellement
- **Boucle de jeu** : piger → poser un générateur → déployer des vaisseaux / jouer des cartes → attaquer → fin de tour

---

## 2. Règles de base (Game Design Document v0)

### 2.1 La station spatiale
- Chaque joueur commence avec une station à **20 PV**.
- La partie est perdue quand la station tombe à 0 PV.
- La station est **améliorable** par des cartes « Module de station » :
  - *Bouclier déflecteur* : +X PV ou absorption de dégâts
  - *Tourelle de défense* : peut riposter contre les attaquants
  - *Chantier orbital* : réduit le coût des vaisseaux
  - *Baie de réparation* : soigne la station ou les vaisseaux
- Limite suggérée : 3 modules actifs simultanément (à équilibrer en playtest).

### 2.2 L'énergie orbitale (ressource)
- Les **générateurs d'énergie orbitale** sont des cartes dans le deck (équivalent des terrains de Magic).
- **Un seul générateur peut être posé par tour**, par joueur.
- Les générateurs produisent de l'énergie chaque tour ; l'énergie sert à payer le coût des cartes.
- L'énergie se recharge au début de chaque tour (pas d'accumulation entre les tours — à valider en playtest).
- Variantes possibles à explorer : générateurs spécialisés (énergie de type différent par faction).

### 2.3 La flotte (types de vaisseaux)
Plusieurs classes de vaisseaux, chacune avec un rôle distinct :

| Classe | Coût | Profil | Rôle |
|---|---|---|---|
| **Chasseur** | 1–2 | Faible attaque/PV, rapide | Pression précoce, escorte |
| **Intercepteur** | 2–3 | Peut bloquer les attaques ennemies | Défense |
| **Corvette** | 3–4 | Équilibré, capacités utilitaires | Polyvalent |
| **Croiseur** | 5–6 | Forte attaque | Frappe principale |
| **Vaisseau-amiral / Capital** | 7+ | Très puissant, effets uniques | Finisher, 1 seul en jeu à la fois |
| **Vaisseau de soutien** | 2–4 | Pas d'attaque, effets (réparation, brouillage) | Support |

Mots-clés envisagés : *Furtif* (ne peut être bloqué), *Blindage X* (réduit les dégâts), *Frappe rapide*, *Escorte* (doit être détruit en premier).

### 2.4 Types de cartes
1. **Générateur d'énergie orbitale** (ressource)
2. **Vaisseau** (unité permanente, classes ci-dessus)
3. **Module de station** (amélioration permanente de la station)
4. **Tactique** (effet instantané : torpille, brouillage, repli…)
5. **Événement / Manœuvre** (effet de tour entier, optionnel pour v1)

### 2.5 Déroulement d'un tour
*(Précisé dans `docs/regles.md`, qui fait foi.)*
1. **Recharge** : l'énergie revient au total produit par les générateurs
2. **Pige** : piger 1 carte
3. **Phase d'action** : poser au plus 1 générateur, jouer des cartes et attaquer, dans n'importe quel ordre — chaque vaisseau attaque la station ennemie ou un vaisseau ennemi (qui riposte)
4. **Fin de tour** : expiration des effets « jusqu'à la fin du tour »

### 2.6 Construction de deck
- Deck de 40 cartes minimum, maximum 3 exemplaires d'une même carte.
- ~16–18 générateurs recommandés (à équilibrer).
- 2–3 factions au lancement (ex. : Fédération / Pirates / Aliens), chacune avec une identité mécanique.

---

## 3. Architecture technique proposée

```
armada/
├── packages/
│   ├── core/          # Moteur de règles pur (TypeScript, zéro dépendance UI)
│   │   ├── cards/     # Définitions des cartes (données JSON + effets)
│   │   ├── state/     # État de partie, réducteurs d'actions
│   │   └── rules/     # Validation des coups, résolution du combat
│   ├── server/        # Serveur de jeu (Node.js + WebSocket), matchmaking
│   └── client/        # Interface web (React + Canvas/PixiJS pour le plateau)
├── tools/             # Simulateur d'équilibrage, éditeur de cartes
└── docs/              # GDD, règles complètes, design des cartes
```

**Choix techniques :**
- **TypeScript partout** : le moteur de règles est partagé entre client (prévisualisation) et serveur (autorité).
- **Moteur déterministe à actions** : l'état du jeu n'évolue que par des actions validées → rejouabilité, anti-triche, tests faciles.
- **Cartes définies en données (JSON) + effets scriptés** : ajouter une carte ne demande pas de toucher au moteur.
- **Serveur autoritaire** : le client n'envoie que des intentions ; le serveur valide et diffuse.
- Alternative rapide pour le prototype : [boardgame.io](https://boardgame.io) qui fournit tours, phases et multijoueur clé en main.

---

## 4. Phases de développement

### Phase 0 — Conception (1–2 semaines)
- [x] Rédiger le Game Design Document complet (règles précises, cas limites) → `docs/regles.md`
- [x] Concevoir un set de **60 cartes** (2 factions × 25 + 10 neutres) → `docs/cartes-set-initial.md`
- [ ] **Playtests** : jouer 20+ parties (console ou web) pour valider la boucle de jeu
- [x] Figer les règles v1 (coûts, courbe d'énergie, limite de modules)

### Phase 1 — Moteur de jeu (2–4 semaines) — ✅ terminée
- [x] Modèle d'état : joueurs, station, zones (deck, main, flotte, défausse)
- [x] Système d'actions : poser générateur, jouer carte, attaquer, fin de tour
- [x] Résolution du combat et des dégâts à la station
- [x] Système d'effets de cartes (déclencheurs : à l'arrivée, au début du tour, à la destruction…)
- [x] **Tests unitaires sur chaque règle** (50 tests, `tests/`)
- [x] Mode console / CLI pour jouer une partie sans interface (`npm run cli`)

### Phase 2 — Prototype jouable local (2–3 semaines) — ✅ livrée (équilibrage en cours)
- [x] Interface web : main, plateau, station, énergie, clic + glisser-déposer (`npm run dev`)
- [x] Mode « hot seat » (2 joueurs sur le même écran, écran de passation)
- [x] Journal de partie (log des actions)
- [x] Vérification E2E navigateur (`scripts/smoke.mjs`, `scripts/e2e-bot.mjs`)
- [x] Adversaire IA (avancé depuis la phase 5) : moteur `src/core/ai.ts`, option « IA » dans le lobby
- [x] Simulateur d'équilibrage IA contre IA (`npm run sim`) → résultats dans `docs/equilibrage.md`
- [ ] Premier passage d'équilibrage : confirmer la simulation par des parties humaines

### Phase 3 — Multijoueur en ligne (3–4 semaines) — ✅ livrée
- [x] Serveur WebSocket autoritaire (`npm run server`) : actions sérialisées validées par le moteur, vues expurgées par joueur (mains/decks adverses masqués — anti-triche par construction)
- [x] Matchmaking simple (file d'attente) + parties privées par code (5 caractères)
- [x] Reconnexion en cours de partie (jeton de session) + timeout de tour (90 s, fin de tour forcée)
- [x] Comptes joueurs persistants : pseudo + mot de passe (scrypt, SQLite), jeton de session ; le `welcome` porte `enPartie` pour que le client sache qu'un `start` de reprise suit
- [x] Vérification navigateur du parcours en ligne à deux clients (`scripts/e2e-online.mjs`)

### Phase 4 — Collection et deck building (2–3 semaines)
- [x] Inventaire de cartes par joueur (SQLite : `src/server/store.ts`, collection de départ = les deux decks de démarrage)
- [x] Système d'acquisition : boosters gagnés en jouant (+1 par partie, +2 au vainqueur, 2 à l'inscription), ouverture depuis le lobby
- [x] Raretés : commune / rare / épique / légendaire (tirage 3 communes + 1 rare + 1 spéciale)
- [ ] Constructeur de decks (validation : 40 cartes, max 3 exemplaires) — le serveur sait déjà valider, sauvegarder et servir un deck nommé (`saveDeck`/`deleteDeck`, jouable en ligne), il manque l'interface de composition côté client

### Phase 5 — Polish et lancement bêta (2–4 semaines)
- [ ] Direction artistique : illustrations des cartes, plateau spatial, effets visuels (lasers, explosions)
- [ ] Sons et musique
- [ ] Tutoriel interactif + IA basique pour le mode solo
- [ ] Équilibrage final via simulations automatisées (l'outil `tools/`)
- [ ] Déploiement (hébergement, télémétrie des parties pour l'équilibrage)

---

## 5. Risques et points d'attention

| Risque | Mitigation |
|---|---|
| Équilibrage difficile (problème n°1 des JCC) | Playtests papier tôt + simulateur automatisé + télémétrie |
| Système d'effets de cartes trop rigide | Concevoir le système d'effets/déclencheurs avant d'écrire 60 cartes |
| « Mana screw » (frustration liée aux générateurs) | Prévoir mulligan + tester des variantes (ex. : générateur garanti aux 2 premiers tours) |
| Scope trop large | V1 stricte : 2 factions, 60 cartes, 1 mode de jeu |
| Triche en ligne | Serveur autoritaire dès la phase 3, jamais de logique de règles côté client seul |

---

## 6. Premier jalon concret

**Objectif immédiat (Phase 0)** : un document de règles d'une page + 20 cartes de test + 3 parties jouées sur papier. Rien ne doit être codé avant que la boucle « piger → générer de l'énergie → déployer → attaquer la station » soit amusante sur table.
