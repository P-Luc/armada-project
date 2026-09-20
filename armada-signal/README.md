# armada-signal — signalement et salle d'attente

Serveur Bun autonome, **zéro dépendance**, qui répond à une seule question :
**avec qui je joue, et comment je le joins ?** Il tient la salle d'attente,
apparie deux joueurs, leur donne une graine commune, puis relaie leurs messages
d'établissement de lien sans jamais les lire.

```bash
bun serveur.js          # ws://localhost:3001/signal  ·  http://localhost:3001/sante
PORT=8080 bun serveur.js

bun test                # 27 tests de la salle d'attente, en mémoire
bun verif-signal.mjs    # contrôle bout en bout : vrai serveur, vraies sockets
```

## Ce qu'il ne fait pas

**Il ne simule rien et ne relaie pas la partie.** Le lockstep reste au relais de
`armada-rts/serve.js` (`/coop`, un paquet `tick` toutes les 33 ms). Ici, quelques
messages par partie ; là-bas, trente par seconde. Les garder séparés, c'est
pouvoir redémarrer le signalement sans couper une partie en cours, et
inversement.

Une fois appariés, les deux clients ont le choix : établir un lien direct
(le champ `signal` transporte leurs offres WebRTC telles quelles) ou rejoindre
le relais avec la graine reçue ici.

**Note sur le moteur** : `game.js` suppose encore **un seul camp jouable**
(`metal`/`energy` globales, `mother` singleton du camp `player`). Ce serveur
apparie donc deux joueurs que le jeu ne sait pas encore opposer — il prépare le
1v1, il ne le rend pas jouable à lui seul. La coopération à deux sur le même
camp, elle, ne demande rien de plus que le relais existant.

## Protocole (version 1)

WebSocket sur `/signal`, messages JSON, champ `t` pour le type — mêmes
conventions que le relais de coop.

### Du client vers le serveur

| Message | Effet |
| --- | --- |
| `{t:'bonjour', pseudo, version}` | Se nomme. Facultatif : sans lui, on est `Anonyme`. Un `bonjour` tardif ne fait perdre ni sa place dans la file ni sa partie. |
| `{t:'chercher', faction}` | Entre dans la salle d'attente. `faction` (`arche` \| `collective`) est une **préférence**. |
| `{t:'annuler'}` | Quitte la file. |
| `{t:'privee'}` | Ouvre un salon privé et reçoit un code à transmettre. |
| `{t:'privee', code}` | Rejoint le salon de ce code (casse et tirets ignorés). |
| `{t:'signal', data}` | Relayé tel quel à l'adversaire. Le serveur ne lit pas `data` (16 Ko max). |
| `{t:'pret'}` | Annonce qu'on est prêt. Les deux « prêt » déclenchent `lancer`. |
| `{t:'quitter'}` | Quitte la partie, qui est dissoute. |
| `{t:'ping', t0}` | Renvoyé en `pong` avec le même `t0` — de quoi mesurer la latence. |

### Du serveur vers le client

| Message | Quand |
| --- | --- |
| `{t:'bienvenue', id, pseudo, protocole, joueurs, attente, parties}` | À l'ouverture, et après chaque `bonjour`. |
| `{t:'attente', position, …}` | En file. Renvoyé à tous quand la file avance : on n'attend jamais à l'aveugle. |
| `{t:'annule'}` | Sortie de file confirmée. |
| `{t:'salon', code, joueurs}` | Salon privé ouvert, en attente de l'ami. |
| `{t:'apparie', partie, code, graine, faction, role, adversaire}` | Adversaire trouvé. |
| `{t:'signal', de, data}` | Un signal de l'adversaire. |
| `{t:'adversaire-pret'}` | L'autre a annoncé être prêt. |
| `{t:'lancer', partie, graine, camps}` | Les deux sont prêts : la partie commence. |
| `{t:'adversaire-parti', motif}` | `depart` ou `deconnexion`. La partie est dissoute. |
| `{t:'refus', motif}` | Demande rejetée (code inconnu, salon complet, signal démesuré…). |
| `{t:'pong', t0}` | Réponse au `ping`. |

### Routes HTTP

- `GET /sante` → `{ok, protocole, depuis_s, joueurs, attente, parties}` (CORS ouvert).
- `GET /` → un résumé en texte brut.

## Trois décisions qui se voient dans le code

**Le camp est une préférence, jamais une exigence.** Le premier arrivé obtient
le sien, le second prend l'autre. Exiger les deux camps rendrait la file
famélique : deux amateurs de l'Arche attendraient indéfiniment côte à côte.

**La graine est tirée par le serveur.** C'est la seule donnée qui *doit* être
identique chez les deux clients (`startGame(faction, graine)` fixe tout le monde
généré). La laisser à un joueur, c'est laisser un joueur choisir la carte.

**L'identifiant vient de la bascule WebSocket, jamais du client.** Sans cela,
n'importe qui pourrait se déclarer adversaire d'une partie en cours et y injecter
ses signaux.

## Architecture

`attente.js` tient toute la logique **sans une ligne de réseau** : chaque méthode
rend la liste des envois à effectuer (`{pour: [id], msg}`) au lieu d'écrire dans
une socket. `serveur.js` ne fait que traduire ces envois en `ws.send`, plus le
débit, les limites de taille et les routes. C'est ce qui permet à `bun test` de
jouer des parties entières en mémoire : un bug d'appariement se reproduit en
trois lignes de test, jamais en jonglant avec deux navigateurs.

Garde-fous côté transport : 32 Ko par message, 30 messages par seconde et par
connexion (au-delà, fermeture en 1008), et coupure des sockets inactives après
60 s — un `ping` régulier suffit à tenir la connexion ouverte.
