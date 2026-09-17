import { WebSocketServer, type WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
import { decide, endTurn, newGame } from '../core/game';
import { applyAction, assertActor, redactView } from '../core/actions';
import type { GameAction } from '../core/actions';
import { forcedAttack } from '../core/ai';
import { getDef } from '../core/cards';
import { DECK_RAZZIA, DECK_REMPART } from '../core/decks';
import type { GameState, PlayerId } from '../core/types';
import { Store } from './store';

/**
 * Serveur de jeu autoritaire : les clients envoient des intentions (actions
 * sérialisées), le serveur les valide via le moteur et diffuse à chaque joueur
 * une vue expurgée (mains/decks adverses masqués).
 *
 * Phase 4 : comptes persistants (pseudo + mot de passe, SQLite), collection de
 * cartes, decks sauvegardés, boosters gagnés en jouant (+1 par partie, +1 au
 * vainqueur).
 */

interface Session {
  playerId: number;
  pseudo: string;
  ws: WebSocket | null;
  room: Room | null;
  seat: PlayerId;
}

interface Room {
  state: GameState;
  players: [Session, Session];
  accents: [string, string];
  deadline: number;
  timer: ReturnType<typeof setTimeout> | null;
  settled: boolean;
}

export interface ServerHandle {
  port: number;
  close: () => void;
}

/** Couleur de faction dominante d'un deck (pour l'habillage client). */
function deckAccent(cards: string[]): string {
  let fed = 0;
  let belt = 0;
  for (const id of cards) {
    const f = getDef(id).faction;
    if (f === 'federation') fed++;
    else if (f === 'ceinture') belt++;
  }
  return belt > fed ? 'ceinture' : 'federation';
}

export function startServer(opts: {
  port: number;
  turnMs?: number;
  seed?: number;
  dbPath?: string;
  rewardMinTurns?: number;
}): ServerHandle {
  const turnMs = opts.turnMs ?? 90_000;
  const rewardMinTurns = opts.rewardMinTurns ?? 4;
  const store = new Store(opts.dbPath ?? 'data/armada.db');
  const wss = new WebSocketServer({ port: opts.port });
  const live = new Map<number, Session>(); // playerId → session
  const rooms = new Set<Room>();
  const queue: { session: Session; cards: string[] }[] = [];
  const privates = new Map<string, { session: Session; cards: string[] }>();

  const sendTo = (s: Session, msg: unknown) => {
    if (s.ws && s.ws.readyState === s.ws.OPEN) s.ws.send(JSON.stringify(msg));
  };
  const sendProfile = (s: Session) =>
    sendTo(s, { t: 'profile', ...store.profile(s.playerId) });
  const broadcast = (room: Room) => {
    for (const seat of [0, 1] as PlayerId[])
      sendTo(room.players[seat], {
        t: 'view',
        view: redactView(room.state, seat),
        deadline: room.deadline,
      });
  };

  function armTimer(room: Room) {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    if (room.state.over) return;
    room.deadline = Date.now() + turnMs;
    room.timer = setTimeout(() => forceEndTurn(room), turnMs);
  }

  /** Timeout de tour : on termine le tour du joueur, sans jouer à sa place. */
  function forceEndTurn(room: Room) {
    const s = room.state;
    if (s.over) return;
    s.log.push(`Temps écoulé pour ${room.players[s.active].pseudo} : fin de tour forcée.`);
    const d = s.pendingDecision;
    if (d) {
      try {
        if (d.kind === 'scry1') decide(s, { bottom: false });
        else decide(s, { uid: s.players[d.targetPlayer!].modules[0]?.uid });
      } catch {
        s.pendingDecision = undefined;
      }
    }
    try {
      endTurn(s);
    } catch {
      let guard = 20;
      while (guard-- > 0 && forcedAttack(s)) {
        /* attaques imposées (Vaisseau-bélier) */
      }
      try {
        endTurn(s);
      } catch {
        /* le prochain timeout réessaiera */
      }
    }
    armTimer(room);
    broadcast(room);
    if (room.state.over) settleRoom(room);
  }

  function startRoom(
    p0: { session: Session; cards: string[] },
    p1: { session: Session; cards: string[] },
  ) {
    const seed = opts.seed ?? (randomBytes(4).readUInt32BE(0) & 0x7fffffff) | 1;
    const state = newGame(p0.cards, p1.cards, seed);
    const room: Room = {
      state,
      players: [p0.session, p1.session],
      accents: [deckAccent(p0.cards), deckAccent(p1.cards)],
      deadline: 0,
      timer: null,
      settled: false,
    };
    rooms.add(room);
    p0.session.room = room;
    p0.session.seat = 0;
    p1.session.room = room;
    p1.session.seat = 1;
    armTimer(room);
    for (const seat of [0, 1] as PlayerId[]) {
      sendTo(room.players[seat], {
        t: 'start',
        seat,
        names: [p0.session.pseudo, p1.session.pseudo],
        accents: room.accents,
        view: redactView(state, seat),
        deadline: room.deadline,
      });
    }
  }

  /** Fin de partie : bilan + boosters (+1 par partie, +1 au vainqueur), puis nettoyage. */
  function settleRoom(room: Room) {
    if (!room.settled) {
      room.settled = true;
      const s = room.state;
      if (s.turnCounter >= rewardMinTurns) {
        for (const seat of [0, 1] as PlayerId[]) {
          const p = room.players[seat];
          const won = s.winner === seat;
          store.recordResult(p.playerId, won, s.winner === undefined);
          store.grantBoosters(p.playerId, won ? 2 : 1);
          sendProfile(p);
        }
      }
    }
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    rooms.delete(room);
    for (const p of room.players) if (p.room === room) p.room = null;
  }

  function dropFromLobbies(s: Session) {
    const qi = queue.findIndex((q) => q.session === s);
    if (qi >= 0) queue.splice(qi, 1);
    for (const [code, e] of privates) if (e.session === s) privates.delete(code);
  }

  /** rempart / razzia, ou un deck sauvegardé du joueur. */
  function resolveDeck(s: Session, name: unknown): string[] {
    const n = String(name ?? '');
    if (n === 'rempart') return DECK_REMPART;
    if (n === 'razzia') return DECK_RAZZIA;
    const cards = store.getDeckCards(s.playerId, n);
    if (!cards) throw new Error('Deck introuvable.');
    return cards;
  }

  wss.on('connection', (ws) => {
    let me: Session | null = null;

    /** Attache la connexion à un joueur authentifié et envoie l'état complet. */
    function bindPlayer(playerId: number, pseudo: string, token: string) {
      let s = live.get(playerId);
      if (s) {
        if (s.ws && s.ws !== ws) {
          try {
            s.ws.close();
          } catch {
            /* déjà fermé */
          }
        }
        s.ws = ws;
        s.pseudo = pseudo;
      } else {
        s = { playerId, pseudo, ws, room: null, seat: 0 };
        live.set(playerId, s);
      }
      me = s;
      // `enPartie` prévient le client qu'un `start` de reprise suit : sans lui, il
      // enchaînerait sur la demande qui a motivé la connexion (file d'attente…).
      const room = s.room;
      sendTo(s, { t: 'welcome', token, pseudo, enPartie: !!(room && !room.state.over) });
      sendProfile(s);
      if (room && !room.state.over) {
        sendTo(s, {
          t: 'start',
          resumed: true,
          seat: s.seat,
          names: room.players.map((p) => p.pseudo),
          accents: room.accents,
          view: redactView(room.state, s.seat),
          deadline: room.deadline,
        });
        sendTo(room.players[(1 - s.seat) as PlayerId], { t: 'oppConnection', connected: true });
      }
    }

    function handle(msg: { t?: string; [k: string]: unknown }) {
      switch (msg.t) {
        case 'auth': {
          const a = store.auth(String(msg.pseudo ?? ''), String(msg.password ?? ''));
          bindPlayer(a.playerId, a.pseudo, store.createToken(a.playerId));
          return;
        }
        case 'hello': {
          const resolved = store.resolveToken(String(msg.token ?? ''));
          if (!resolved) throw new Error('Session expirée — reconnectez-vous.');
          bindPlayer(resolved.playerId, resolved.pseudo, String(msg.token));
          return;
        }
      }
      if (!me) throw new Error('Connectez-vous d’abord.');
      switch (msg.t) {
        case 'queue': {
          if (me.room && !me.room.state.over) throw new Error('Partie déjà en cours.');
          const cards = resolveDeck(me, msg.deck);
          dropFromLobbies(me);
          const other = queue.shift();
          if (other && other.session.ws) startRoom(other, { session: me, cards });
          else {
            if (other) queue.unshift(other);
            queue.push({ session: me, cards });
            sendTo(me, { t: 'queued' });
          }
          break;
        }
        case 'createPrivate': {
          if (me.room && !me.room.state.over) throw new Error('Partie déjà en cours.');
          const cards = resolveDeck(me, msg.deck);
          dropFromLobbies(me);
          const code = randomBytes(4).toString('hex').toUpperCase().slice(0, 5);
          privates.set(code, { session: me, cards });
          sendTo(me, { t: 'private', code });
          break;
        }
        case 'joinPrivate': {
          if (me.room && !me.room.state.over) throw new Error('Partie déjà en cours.');
          const code = String(msg.code ?? '').trim().toUpperCase();
          const entry = privates.get(code);
          if (!entry || !entry.session.ws || entry.session === me)
            throw new Error('Code de partie introuvable.');
          const cards = resolveDeck(me, msg.deck);
          privates.delete(code);
          dropFromLobbies(me);
          startRoom(entry, { session: me, cards });
          break;
        }
        case 'action': {
          const room = me.room;
          if (!room || room.state.over) throw new Error('Aucune partie en cours.');
          const before = room.state.active;
          const action = msg.action as GameAction;
          assertActor(room.state, me.seat, action);
          applyAction(room.state, action);
          if (!room.state.over && room.state.active !== before) armTimer(room);
          broadcast(room);
          if (room.state.over) settleRoom(room);
          break;
        }
        case 'leave': {
          dropFromLobbies(me);
          const room = me.room;
          if (room && !room.state.over) {
            room.state.over = true;
            room.state.winner = (1 - me.seat) as PlayerId;
            room.state.log.push(`${me.pseudo} abandonne la partie.`);
            broadcast(room);
          }
          if (room) settleRoom(room);
          break;
        }
        case 'openBooster': {
          const cards = store.openBooster(me.playerId);
          if (!cards) throw new Error('Aucun booster à ouvrir.');
          sendTo(me, { t: 'booster', cards });
          sendProfile(me);
          break;
        }
        case 'saveDeck': {
          store.saveDeck(me.playerId, String(msg.name ?? ''), msg.cards as string[]);
          sendProfile(me);
          break;
        }
        case 'deleteDeck': {
          store.deleteDeck(me.playerId, String(msg.name ?? ''));
          sendProfile(me);
          break;
        }
        default:
          throw new Error('Message inconnu.');
      }
    }

    ws.on('message', (raw) => {
      const text = raw.toString();
      if (text.length > 50_000) return;
      let msg: { t?: string };
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      try {
        handle(msg);
      } catch (e) {
        ws.send(
          JSON.stringify({
            t: 'err',
            message: e instanceof Error ? e.message : 'Requête invalide.',
          }),
        );
      }
    });

    ws.on('close', () => {
      if (!me || me.ws !== ws) return;
      me.ws = null;
      dropFromLobbies(me);
      const room = me.room;
      if (room && !room.state.over)
        sendTo(room.players[(1 - me.seat) as PlayerId], {
          t: 'oppConnection',
          connected: false,
        });
      if (room && room.state.over) settleRoom(room);
    });
  });

  return {
    port: opts.port,
    close: () => {
      for (const room of rooms) if (room.timer) clearTimeout(room.timer);
      rooms.clear();
      for (const client of wss.clients) client.terminate();
      wss.close();
      store.close();
    },
  };
}
