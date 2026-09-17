# ARMADA — Règles officielles v1.1

Ce document est la référence des règles. En cas de divergence avec `PLAN.md` §2, **ce document fait foi**.

---

## 1. But du jeu

Réduire à 0 les points de vie (PV) de la **station spatiale** adverse. Chaque joueur commence avec une station à **20 PV**, protégée par un **bouclier de 4 points (PB)**.

## 2. Matériel et zones

Chaque joueur possède :

| Zone | Contenu | Visible ? |
|---|---|---|
| **Deck** | 40 cartes minimum, face cachée | Non |
| **Main** | Cartes pigées (maximum 8) | Propriétaire seulement |
| **Générateurs** | Générateurs d'énergie orbitale en jeu | Oui |
| **Flotte** | Vaisseaux en jeu (**maximum 7**) | Oui |
| **Modules** | Modules attachés à la station | Oui |
| **Défausse** | Cartes détruites / jouées | Oui |

## 3. Mise en place

1. Chaque joueur mélange son deck.
2. Le **joueur 1** pige 5 cartes ; le **joueur 2** pige 6 cartes (compensation pour jouer en second).
3. Le joueur 1 commence.

## 4. Déroulement d'un tour

1. **Recharge** : l'énergie du joueur actif devient égale à la somme produite par ses générateurs. L'énergie non dépensée au tour précédent est **perdue** (pas d'accumulation). Les gardes du joueur actif expirent. Le bouclier ne se recharge **pas** tout seul (seuls des effets de cartes pourront le restaurer).
2. **Pige** : le joueur actif pige 1 carte (chaque joueur, à chacun de ses tours, premier tour compris).
3. **Effets de début de tour** : modules puis vaisseaux, dans l'ordre où ils ont été posés.
4. **Phase d'action** : dans n'importe quel ordre, le joueur actif peut :
   - poser **au plus un générateur** (gratuit) ;
   - jouer des cartes en payant leur coût en énergie ;
   - avec chacun de ses vaisseaux (**une action par vaisseau par tour**) : **attaquer** ou se mettre **en garde**.
5. **Fin de tour** : les effets « jusqu'à la fin du tour » expirent, puis l'adversaire devient le joueur actif.

> Il n'y a **pas d'actions pendant le tour adverse** (pas de système de réaction en v1).

## 5. L'énergie orbitale

- Les générateurs sont des cartes du deck, posés gratuitement, **un seul par tour**.
- Chaque générateur produit son énergie **immédiatement** quand il est posé, puis à chaque recharge.
- Limite de 3 exemplaires par carte, **sauf** le Générateur d'énergie orbitale de base (N01), illimité.

## 6. Les vaisseaux

- Un vaisseau a une **attaque (ATK)** et des **points de vie (PV)**. Les dégâts s'accumulent ; un vaisseau dont les dégâts atteignent ses PV est détruit.
- **Mal de saut** : un vaisseau ne peut pas attaquer le tour où il arrive en jeu (sauf *Frappe rapide*).
- Un vaisseau attaque **une fois par tour**, au choix : la **station ennemie** ou un **vaisseau ennemi**.
- Les dégâts ne se soignent pas automatiquement en fin de tour (contrairement à Magic).

## 7. Le combat

1. L'attaquant déclare un vaisseau attaquant et sa cible (station ennemie ou vaisseau ennemi).
2. **Interception** : si le défenseur a des vaisseaux **en garde** et que l'attaquant n'est pas Furtif, le **premier vaisseau mis en garde** intercepte l'attaque (sauf si la cible est déjà un gardien) : le combat se résout contre lui et sa garde prend fin.
3. **Contre la station** : les dégâts sont d'abord réduits par le **Blindage** de la station, puis absorbés par son **bouclier** ; seul le reste entame la coque (PV). **Le bouclier doit donc être détruit avant la coque.** La station ne riposte pas (sauf effets comme la Tourelle automatisée).
4. **Contre un vaisseau** : les deux vaisseaux s'infligent **simultanément** leur ATK l'un à l'autre (riposte). Les deux peuvent être détruits.

### 7 bis. La garde (blocage)

- Au lieu d'attaquer, un vaisseau peut se mettre **en garde** ; c'est son action du tour (il ne peut pas aussi attaquer). Un vaisseau arrivé ce tour **peut** se mettre en garde (le mal de saut n'empêche que l'attaque) ; un vaisseau brouillé ne le peut pas.
- La garde dure jusqu'au début de votre prochain tour et intercepte **une seule attaque**.
- Les effets de station (Nyx, Vessa…) ne se déclenchent que si des dégâts atteignent **la coque** : un bouclier qui absorbe tout les neutralise.
- Le Vaisseau-bélier (« doit attaquer ») ne peut pas se mettre en garde.

## 8. Mots-clés

- **Frappe rapide** : peut attaquer dès le tour où il arrive en jeu.
- **Escorte** : tant que le défenseur contrôle au moins un vaisseau Escorte, les attaques ennemies doivent cibler un vaisseau Escorte.
- **Furtif** : tant qu'il n'a pas attaqué, ce vaisseau ne peut être ni attaqué ni ciblé par les cartes adverses. Ses attaques **ignorent Escorte et la Garde**. Il est révélé dès qu'il attaque.
- **Garde** : action défensive d'un vaisseau (voir §7 bis).
- **Perce-bouclier** : ces dégâts ignorent le bouclier de la station (mais pas son Blindage).
- **Blindage X** : chaque source de dégâts qui touche cette carte (ou cette station) est réduite de X. Les Blindages s'additionnent.
- **À l'arrivée** : effet déclenché quand la carte entre en jeu.
- **À la destruction** : effet déclenché quand la carte est détruite.

## 9. Les modules de station

- Un module est posé en payant son coût et reste en jeu.
- Les modules n'ont pas de PV : ils ne peuvent être détruits que par des effets (ex. : *Sabotage*).
- Pas de limite de modules en v1 (à réévaluer en playtest).

## 10. Limites et usure

- **Main maximum 8 cartes** : toute carte pigée en excès est défaussée directement (« brûlée »).
- **Flotte maximum 7 vaisseaux** : impossible de jouer un vaisseau à flotte pleine ; les jetons en excès ne sont pas créés.
- **Usure** : piger d'un deck vide inflige des dégâts à votre station : 1 la première fois, puis 2, 3, etc. (cumulatif). L'usure ignore le Blindage **et le bouclier** (dégâts internes).

## 11. Cas particuliers

- **Coût minimum** : les réductions de coût ne descendent jamais un coût sous 1.
- Les **jetons** (Chasseur 1/1, Drone 1/1) disparaissent définitivement quand ils quittent le jeu (jamais en défausse ni en main).
- Les dégâts qu'une de vos propres cartes inflige à votre station (ex. : Générateur à fusion instable) sont **internes** : ils ignorent le Blindage **et le bouclier**.
- Si les deux stations atteignent 0 PV simultanément, la partie est une **égalité**.
- Une carte exigeant une cible ne peut pas être jouée sans cible valide.
- Les bonus d'aura (ex. : Commandant Aris Vega) disparaissent avec leur source : un vaisseau dont les dégâts atteignent alors ses PV est détruit immédiatement.

## 12. Construction de deck

- 40 cartes minimum.
- Maximum 3 exemplaires d'une même carte (sauf N01, illimité).
- Cartes d'au plus une faction + les neutres (règle de faction recommandée, non bloquante en v1).
- Repère : ~16 générateurs pour 40 cartes.

## 13. Décisions v1 (changelog par rapport à PLAN.md §2)

| Sujet | Décision v1 | Raison |
|---|---|---|
| Modèle de combat | Ciblage direct + riposte (style Hearthstone), **pas de bloqueurs** | Plus simple à implémenter et à apprendre ; Escorte/Furtif couvrent les rôles défensifs |
| Accumulation d'énergie | Non — recharge complète chaque tour | Lisibilité, évite les tours explosifs |
| Limite de modules | Aucune (au lieu de 3) | *Sabotage* sert de contre ; à réévaluer |
| Mulligan | Absent en v1 | Compensation par la pioche +1 du joueur 2 ; à ajouter en v1.1 si frustration |
| Avantage du joueur 2 | +1 carte de main de départ, c'est tout — chacun pige dès son premier tour | Une seule compensation suffit ; cumuler main +1 et pige sautée donnait +2 cartes à J2 |
| **v1.1 — Bouclier de station** | 4 PB de base, absorbés avant la coque, **sans recharge automatique** | « Destruction de bouclier obligatoire ». La recharge de 1 PB/tour a été testée puis retirée : elle taxait l'agression de ~1 dégât/tour et faisait monter la Fédération à 71 % de victoires en simulation |
| **v1.1 — Perce-bouclier** | Extorsion, Torpilles incendiaires (mode station) et Bombardement ignorent le bouclier | Préserve l'identité « dégâts directs » de la Ceinture tout en laissant le bouclier contrer le grignotage |
| **v1.1 — Garde (blocage)** | Blocage **pré-déclaré** pendant son propre tour, interception automatique | Une phase de blocage réactive exigerait des décisions pendant le tour adverse (rework moteur/IA/futur en-ligne) ; la garde offre le même choix attaque/défense dans le modèle existant |
| Deck vide | Usure cumulative (1, 2, 3…) | Donne une horloge aux decks défensifs |
