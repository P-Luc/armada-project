# Équilibrage — premier passage (simulation IA)

**Méthode** : 200 parties IA contre IA (`npm run sim -- 200`), decks de démarrage
Rempart (Fédération) contre Razzia (Ceinture), positions alternées, graines 1000–1199.
L'IA est gloutonne à un coup d'avance (`src/core/ai.ts`) — biais connu : elle joue
« tempo » et sous-estime les plans à long terme, ce qui avantage les stratégies agressives.

## Résultats (2026-06-09, règles v1.0)

| Mesure | Valeur |
|---|---|
| Victoires Rempart | 46,5 % |
| Victoires Razzia | 53,5 % |
| Victoires joueur 1 | 57,5 % |
| Victoires joueur 2 | 42,5 % |
| Parties nulles / non finies | 0 % |
| Durée moyenne | 14,3 tours de joueur (~7 rounds) |

## Lecture

1. **Razzia légèrement favorite (+7 pts)** — cohérent avec le risque identifié dès la
   conception (dégâts directs de la Ceinture). L'écart reste dans la zone acceptable
   pour un duel asymétrique ; à confirmer avec des parties humaines avant de toucher
   aux cartes. Premières cibles si l'écart se confirme : Extorsion (C11),
   Bombardement de la Ceinture (C22).
2. **Avantage au joueur 1 marqué (57,5 % contre 42,5 %)** — malgré la carte
   supplémentaire du joueur 2. Le tempo du premier coup pèse plus que la
   compensation en cartes, au moins pour une IA orientée tempo. Piste si les
   parties humaines confirment : remplacer la carte bonus par une « réserve
   d'énergie » à usage unique (équivalent de la pièce de Hearthstone), qui
   compense en tempo plutôt qu'en ressources.
3. **Parties courtes (~7 rounds)** — la boucle de jeu tourne vite ; aucun blocage
   ni partie infinie sur 200 parties.

## Itération v1.1 — mécaniques de défense (2026-06-09)

Ajout du **bouclier de station** (4 PB, destruction obligatoire avant la coque) et de
la **garde** (blocage pré-déclaré). Réglage par simulations successives de 200 parties :

| Configuration | Rempart | Razzia | J1 | Durée moy. |
|---|---|---|---|---|
| v1.0 (référence) | 46,5 % | 53,5 % | 57,5 % | 14,3 tours |
| Bouclier 4 PB + recharge 1/tour + garde | **71,0 %** | 29,0 % | 48,0 % | 33,8 tours |
| + Perce-bouclier (C11, C17, C22) | 72,5 % | 27,5 % | 48,5 % | 34,5 tours |
| − recharge automatique du bouclier | 65,0 % | 35,0 % | 48,0 % | 28,7 tours |
| + deck Razzia : 2× C05 → 2× C16 (Furtif) | **52,0 %** | **48,0 %** | 43,0 % | 26,3 tours |

**Configuration retenue** : bouclier 4 PB sans recharge, Perce-bouclier sur les
3 tactiques de dégâts directs, Écumeurs furtifs dans le deck Razzia.

**Leçons**
1. La recharge de bouclier (1 PB/tour) taxait l'agression de ~1 dégât par tour : à
   elle seule, elle faisait passer la Fédération de 46 % à 71 % de victoires.
2. Le contre principal de la garde est le **Furtif** : sans lui dans son deck, la
   Razzia n'avait aucun moyen de percer une défense en garde.
3. La prime au premier joueur de v1.0 (57,5 %) a disparu avec les mécaniques de
   défense (43 % — légère prime au joueur 2 désormais, à surveiller).
4. Les parties durent ~13 rounds par joueur (contre 7 en v1.0) : la défense a créé
   le mid-game qui manquait.

## À refaire après chaque changement de règles ou de cartes

```bash
npm run sim -- 500
```
