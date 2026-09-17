import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { newGame } from '../core/game';
import { applyAction, legalAction } from '../core/actions';
import type { GameAction } from '../core/actions';
import { getDef } from '../core/cards';
import { aiStep } from '../core/ai';
import { DECK_RAZZIA, DECK_REMPART } from '../core/decks';
import type { GameState, PlayerId, TargetRef } from '../core/types';
import { connect } from './net';
import type { NetConnection } from './net';
import {
  CardZoom,
  EnergyPips,
  HandCard,
  Modal,
  ModulePill,
  ShipToken,
  StationPanel,
} from './pieces';

type DeckChoice = 'rempart' | 'razzia';
type Accent = 'federation' | 'ceinture';

/** Profil renvoyé par le serveur (`t: 'profile'`) : compte, collection, decks. */
interface Profil {
  pseudo: string;
  collection: Record<string, number>;
  decks: { name: string; cards: string[] }[];
  boosters: number;
  wins: number;
  losses: number;
}

const DECKS: Record<
  DeckChoice,
  { title: string; sub: string; cards: string[]; accent: Accent }
> = {
  rempart: {
    title: '« Rempart »',
    sub: 'Fédération Solaire — défense, boucliers, croiseurs lourds',
    cards: DECK_REMPART,
    accent: 'federation',
  },
  razzia: {
    title: '« Razzia »',
    sub: 'Clans de la Ceinture — agression, furtivité, dégâts directs',
    cards: DECK_RAZZIA,
    accent: 'ceinture',
  },
};

type Sel =
  | { kind: 'card'; index: number; mode?: number }
  | { kind: 'ship'; uid: number }
  | null;
type DragPayload = { t: 'card'; i: number } | { t: 'ship'; uid: number };

interface OnlineCtx {
  seat: PlayerId;
  names: [string, string];
  deadline: number | null;
  oppConnected: boolean;
  send: (a: GameAction) => void;
  error: { n: number; message: string } | null;
}

function targetKey(t: TargetRef): string {
  return t.kind === 'station' ? `st${t.player}` : `${t.kind}${t.uid}`;
}

function allTargets(g: GameState): TargetRef[] {
  const out: TargetRef[] = [];
  for (const pid of [0, 1] as PlayerId[]) {
    out.push({ kind: 'station', player: pid });
    for (const s of g.players[pid].fleet)
      out.push({ kind: 'ship', player: pid, uid: s.uid });
    for (const m of g.players[pid].modules)
      out.push({ kind: 'module', player: pid, uid: m.uid });
  }
  return out;
}

function readPayload(e: DragEvent): DragPayload | null {
  try {
    return JSON.parse(e.dataTransfer.getData('text/plain')) as DragPayload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------

interface OnlineState {
  status: 'menu' | 'queued' | 'waitCode' | 'playing';
  code?: string;
  seat: PlayerId;
  names: [string, string];
  accents: [Accent, Accent];
  view: GameState | null;
  deadline: number | null;
  oppConnected: boolean;
  error: { n: number; message: string } | null;
}

const ONLINE_IDLE: OnlineState = {
  status: 'menu',
  seat: 0,
  names: ['', ''],
  accents: ['federation', 'ceinture'],
  view: null,
  deadline: null,
  oppConnected: true,
  error: null,
};

export default function App() {
  const [choice, setChoice] = useState<{
    d0: DeckChoice;
    d1: DeckChoice;
    ai: [boolean, boolean];
  }>({ d0: 'rempart', d1: 'razzia', ai: [false, true] });
  const [game, setGame] = useState<GameState | null>(null);
  const [pseudo, setPseudo] = useState(
    () => localStorage.getItem('armada.pseudo') ?? 'Pilote',
  );
  const [password, setPassword] = useState(''); // jamais persisté : seul le jeton l'est
  const [profil, setProfil] = useState<Profil | null>(null);
  const [booster, setBooster] = useState<string[] | null>(null);
  const [onlineDeck, setOnlineDeck] = useState<string>('rempart');
  const [joinCode, setJoinCode] = useState('');
  const [netNote, setNetNote] = useState('');
  const [online, setOnline] = useState<OnlineState | null>(null);
  const netRef = useRef<NetConnection | null>(null);
  const afterWelcome = useRef<(() => void) | null>(null);
  const fermetureVoulue = useRef(false); // ne pas écraser le message d'erreur par « connexion perdue »

  function start() {
    // ?seed=42 dans l'URL rejoue exactement la même partie (débogage, tests).
    const urlSeed = Number(new URLSearchParams(window.location.search).get('seed'));
    const seed = urlSeed > 0 ? urlSeed : Math.floor(Math.random() * 0x7fffffff);
    setGame(newGame(DECKS[choice.d0].cards, DECKS[choice.d1].cards, seed));
  }

  function handleMsg(m: {
    t: string;
    [k: string]: unknown;
  }): void {
    switch (m.t) {
      case 'welcome':
        localStorage.setItem('armada.token', String(m.token));
        localStorage.setItem('armada.pseudo', String(m.pseudo));
        setPseudo(String(m.pseudo));
        setPassword('');
        // Reprise d'une partie en cours : le serveur envoie le `start` tout seul,
        // la demande qui a ouvert la connexion serait refusée.
        if (m.enPartie) setNetNote('Reprise de la partie en cours…');
        else afterWelcome.current?.();
        afterWelcome.current = null;
        break;
      case 'profile':
        setProfil({
          pseudo: String(m.pseudo),
          collection: m.collection as Record<string, number>,
          decks: m.decks as Profil['decks'],
          boosters: Number(m.boosters),
          wins: Number(m.wins),
          losses: Number(m.losses),
        });
        break;
      case 'booster':
        setBooster(m.cards as string[]);
        break;
      case 'queued':
        setOnline((o) => ({ ...(o ?? ONLINE_IDLE), status: 'queued' }));
        setNetNote('En recherche d’adversaire…');
        break;
      case 'private':
        setOnline((o) => ({
          ...(o ?? ONLINE_IDLE),
          status: 'waitCode',
          code: String(m.code),
        }));
        setNetNote('');
        break;
      case 'start': {
        setOnline({
          status: 'playing',
          seat: m.seat as PlayerId,
          names: m.names as [string, string],
          accents: m.accents as [Accent, Accent],
          view: m.view as GameState,
          deadline: (m.deadline as number) ?? null,
          oppConnected: true,
          error: null,
        });
        setNetNote('');
        break;
      }
      case 'view':
        setOnline((o) =>
          o && o.status === 'playing'
            ? { ...o, view: m.view as GameState, deadline: (m.deadline as number) ?? null }
            : o,
        );
        break;
      case 'oppConnection':
        setOnline((o) => (o ? { ...o, oppConnected: !!m.connected } : o));
        break;
      case 'err':
        // Une erreur avant le `welcome` = échec d'authentification : on repart du
        // lobby, jeton purgé, pour que la tentative suivante redemande le mot de passe.
        if (afterWelcome.current) {
          afterWelcome.current = null;
          localStorage.removeItem('armada.token');
          setProfil(null);
          fermetureVoulue.current = true;
          netRef.current?.close();
          netRef.current = null;
        }
        setOnline((o) =>
          o && o.status === 'playing'
            ? { ...o, error: { n: (o.error?.n ?? 0) + 1, message: String(m.message) } }
            : o,
        );
        setNetNote(String(m.message));
        break;
      default:
        break;
    }
  }

  function ensureNet(then: () => void) {
    if (netRef.current) {
      then();
      return;
    }
    const nom = pseudo.trim();
    // Le jeton ne vaut que pour le compte qui l'a obtenu : changer de pseudo
    // (ou saisir un mot de passe) repasse par `auth`.
    const jeton =
      password.length === 0 && nom === localStorage.getItem('armada.pseudo')
        ? localStorage.getItem('armada.token')
        : null;
    if (!jeton && (nom.length < 2 || password.length < 4)) {
      setNetNote('Pseudo (2 caractères) et mot de passe (4 caractères) requis.');
      return;
    }
    setNetNote('Connexion au serveur…');
    afterWelcome.current = () => {
      setNetNote('');
      then();
    };
    netRef.current = connect(jeton ? { token: jeton } : { pseudo: nom, password }, {
      onMsg: handleMsg,
      onClose: () => {
        netRef.current = null;
        setOnline((o) => (o && o.status === 'playing' ? o : null));
        if (fermetureVoulue.current) fermetureVoulue.current = false;
        else setNetNote('Connexion au serveur perdue.');
      },
    });
  }

  /** Oublie le compte courant sans toucher au serveur (changement de joueur). */
  function forgetAccount() {
    fermetureVoulue.current = true;
    netRef.current?.close();
    netRef.current = null;
    localStorage.removeItem('armada.token');
    setProfil(null);
    setOnline(null);
    setOnlineDeck('rempart');
    setNetNote('');
  }

  function quitOnline() {
    netRef.current?.send({ t: 'leave' });
    fermetureVoulue.current = true;
    netRef.current?.close();
    netRef.current = null;
    setOnline(null);
    setNetNote('');
  }

  // ----- Partie en ligne en cours -----
  if (online?.status === 'playing' && online.view) {
    return (
      <Table
        g={online.view}
        ai={[false, false]}
        accents={online.accents}
        onExit={quitOnline}
        online={{
          seat: online.seat,
          names: online.names,
          deadline: online.deadline,
          oppConnected: online.oppConnected,
          error: online.error,
          send: (a) => netRef.current?.send({ t: 'action', action: a }),
        }}
      />
    );
  }

  // ----- Partie locale en cours -----
  if (game) {
    return (
      <Table
        g={game}
        ai={choice.ai}
        accents={[DECKS[choice.d0].accent, DECKS[choice.d1].accent]}
        onExit={() => setGame(null)}
      />
    );
  }

  // ----- Lobby -----
  return (
    <div className="lobby">
      <h1 className="logo">ARMADA</h1>
      <p className="tagline">Combat orbital · local, hot-seat ou en ligne</p>
      <div className="lobby-grid">
        {([0, 1] as const).map((pid) => (
          <div className="lobby-side" key={pid}>
            <h3>Joueur {pid + 1}</h3>
            <div className="pick-row">
              {([false, true] as const).map((isAi) => (
                <button
                  key={String(isAi)}
                  className={`btn-ghost ${choice.ai[pid] === isAi ? 'active' : ''}`}
                  onClick={() =>
                    setChoice((c) => {
                      const ai: [boolean, boolean] = [...c.ai];
                      ai[pid] = isAi;
                      return { ...c, ai };
                    })
                  }
                >
                  {isAi ? '⚙ IA' : '☉ Humain'}
                </button>
              ))}
            </div>
            {(Object.keys(DECKS) as DeckChoice[]).map((dc) => {
              const sel = (pid === 0 ? choice.d0 : choice.d1) === dc;
              return (
                <button
                  key={dc}
                  className={`deck-pick f-${DECKS[dc].accent} ${sel ? 'selected' : ''}`}
                  onClick={() =>
                    setChoice((c) => (pid === 0 ? { ...c, d0: dc } : { ...c, d1: dc }))
                  }
                >
                  <b>{DECKS[dc].title}</b>
                  <span>{DECKS[dc].sub}</span>
                </button>
              );
            })}
          </div>
        ))}
        <div className="lobby-side online-panel">
          <h3>En ligne</h3>
          {profil ? (
            <p className="net-note">
              <b>{profil.pseudo}</b> — {profil.wins} victoire{profil.wins === 1 ? '' : 's'} /{' '}
              {profil.losses} défaite{profil.losses === 1 ? '' : 's'} ·{' '}
              {Object.values(profil.collection).reduce((a, b) => a + b, 0)} cartes
              {profil.boosters > 0 ? ` · ${profil.boosters} booster${profil.boosters === 1 ? '' : 's'}` : ''}
            </p>
          ) : (
            <>
              <input
                className="text-input"
                value={pseudo}
                maxLength={20}
                onChange={(e) => setPseudo(e.target.value)}
                placeholder="Votre pseudo"
              />
              <input
                className="text-input"
                type="password"
                value={password}
                maxLength={64}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mot de passe (compte créé au vol)"
              />
            </>
          )}
          {profil && profil.boosters > 0 && (
            <button
              className="btn-ghost"
              // `ensureNet` : la connexion est fermée au retour d'une partie.
              onClick={() => ensureNet(() => netRef.current?.send({ t: 'openBooster' }))}
            >
              Ouvrir un booster ({profil.boosters})
            </button>
          )}
          <div className="pick-row">
            {[...(Object.keys(DECKS) as DeckChoice[]), ...(profil?.decks ?? []).map((d) => d.name)].map(
              (dc) => (
                <button
                  key={dc}
                  className={`btn-ghost ${onlineDeck === dc ? 'active' : ''}`}
                  onClick={() => setOnlineDeck(dc)}
                >
                  {dc in DECKS ? DECKS[dc as DeckChoice].title : dc}
                </button>
              ),
            )}
          </div>
          {online?.status === 'queued' ? (
            <>
              <p className="net-note">En file d’attente…</p>
              <button className="btn-ghost" onClick={quitOnline}>
                Annuler
              </button>
            </>
          ) : online?.status === 'waitCode' ? (
            <>
              <p className="net-note">
                Code de la partie : <b>{online.code}</b> — en attente de l’adversaire…
              </p>
              <button className="btn-ghost" onClick={quitOnline}>
                Annuler
              </button>
            </>
          ) : (
            <>
              <button
                className="btn-primary"
                onClick={() => ensureNet(() => netRef.current?.send({ t: 'queue', deck: onlineDeck }))}
              >
                Partie rapide
              </button>
              <button
                className="btn-ghost"
                onClick={() =>
                  ensureNet(() => netRef.current?.send({ t: 'createPrivate', deck: onlineDeck }))
                }
              >
                Créer une partie privée
              </button>
              <div className="row">
                <input
                  className="text-input"
                  value={joinCode}
                  maxLength={5}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="CODE"
                />
                <button
                  className="btn-ghost"
                  onClick={() =>
                    joinCode.trim() &&
                    ensureNet(() =>
                      netRef.current?.send({ t: 'joinPrivate', code: joinCode, deck: onlineDeck }),
                    )
                  }
                >
                  Rejoindre
                </button>
              </div>
              <p className="net-note">{netNote}</p>
              {profil && (
                <button className="btn-ghost" onClick={forgetAccount}>
                  Changer de compte
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <button className="btn-primary" onClick={start}>
        Lancer la bataille locale
      </button>
      {booster && (
        <Modal title="Booster ouvert">
          <ul className="booster-list">
            {booster.map((id, i) => (
              <li key={`${id}-${i}`} className={`f-${getDef(id).faction}`}>
                <b>{getDef(id).name}</b>
                <span>{getDef(id).rarity}</span>
              </li>
            ))}
          </ul>
          <button className="btn-primary" onClick={() => setBooster(null)}>
            Ajouter à la collection
          </button>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Table(props: {
  g: GameState;
  ai: [boolean, boolean];
  accents: [Accent, Accent];
  onExit: () => void;
  online?: OnlineCtx;
}) {
  const { g, ai, accents, online } = props;
  const humans = ai.filter((x) => !x).length;
  const hotSeat = !online && humans === 2;
  const [v, setV] = useState(0);
  const [sel, setSel] = useState<Sel>(null);
  const [modeAsk, setModeAsk] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [handoff, setHandoff] = useState(hotSeat);
  const [now, setNow] = useState(() => Date.now());
  const autoEndedRef = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);

  // Point de vue : son siège en ligne, l'humain en partie humain/IA, sinon l'actif.
  const me: PlayerId = online
    ? online.seat
    : humans === 1
      ? ai[0]
        ? 1
        : 0
      : g.active;
  const en = (1 - me) as PlayerId;
  const P = g.players[me];
  const E = g.players[en];
  const aiTurn = !online && ai[g.active];
  const myTurn = g.active === me && !aiTurn;

  // Boucle de l'IA locale : une étape toutes les 650 ms.
  useEffect(() => {
    if (online || !aiTurn || g.over) return;
    const t = setTimeout(() => {
      aiStep(g);
      setV((x) => x + 1);
    }, 650);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, aiTurn, g.over, online]);

  // Erreurs renvoyées par le serveur.
  useEffect(() => {
    if (online?.error) setToast(online.error.message);
  }, [online?.error?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compte à rebours du tour (en ligne).
  useEffect(() => {
    if (!online?.deadline) return;
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [online?.deadline]);
  const remaining = online?.deadline
    ? Math.max(0, Math.ceil((online.deadline - now) / 1000))
    : null;

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  });
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSel(null);
        setModeAsk(null);
        setZoom(null);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  function act(action: GameAction): boolean {
    if (online) {
      online.send(action);
      setSel(null);
      return true;
    }
    let ok = true;
    try {
      applyAction(g, action);
    } catch (e) {
      setToast((e as Error).message);
      ok = false;
    }
    if (ok) setSel(null);
    setV((x) => x + 1);
    return ok;
  }

  const la = (a: GameAction) => legalAction(g, a);

  // Cibles légales pour la sélection en cours (surlignage).
  const valid = useMemo(() => {
    const set = new Set<string>();
    if (!sel || !myTurn || g.over || g.pendingDecision) return set;
    for (const t of allTargets(g)) {
      const ok =
        sel.kind === 'card'
          ? la({ type: 'play', handIndex: sel.index, targets: [t], mode: sel.mode })
          : la({ type: 'attack', uid: sel.uid, target: t });
      if (ok) set.add(targetKey(t));
    }
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, v, g]);

  // Cartes jouables (liseré pulsant de la main).
  const playable = useMemo(() => {
    if (!myTurn || g.over || g.pendingDecision) return P.hand.map(() => false);
    return P.hand.map((defId, i) => {
      const d = getDef(defId);
      if (d.type === 'generateur') return !P.playedGenerator;
      const modes = d.modes ? d.modes.map((_, m) => m) : [undefined];
      return modes.some((m) => {
        const spec = m === undefined ? d.targetSpec : d.modes![m].targetSpec;
        if (spec?.required)
          return allTargets(g).some((t) =>
            la({ type: 'play', handIndex: i, targets: [t], mode: m }),
          );
        return la({ type: 'play', handIndex: i, mode: m });
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, g, myTurn]);

  // Vaisseaux qui peuvent encore agir (halo).
  const canAct = useMemo(() => {
    const set = new Set<number>();
    if (!myTurn || g.over || g.pendingDecision) return set;
    for (const s of P.fleet)
      if (
        la({ type: 'guard', uid: s.uid }) ||
        allTargets(g).some(
          (t) => t.player === en && la({ type: 'attack', uid: s.uid, target: t }),
        )
      )
        set.add(s.uid);
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, g, myTurn]);

  function onEndTurn() {
    if (!myTurn) return;
    if (act({ type: 'endTurn' }) && !g.over && hotSeat) setHandoff(true);
  }

  // Plus aucune action légale → fin de tour automatique après un court délai.
  const noActions =
    myTurn &&
    !g.over &&
    !g.pendingDecision &&
    modeAsk === null &&
    playable.every((x) => !x) &&
    canAct.size === 0;
  useEffect(() => {
    if (!noActions || autoEndedRef.current === g.turnCounter) return;
    const t = setTimeout(() => {
      autoEndedRef.current = g.turnCounter;
      onEndTurn();
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noActions, v, g]);

  function playFromHand(i: number, t?: TargetRef) {
    if (!myTurn) return;
    const d = getDef(P.hand[i]);
    if (d.type === 'generateur') {
      act({ type: 'generator', handIndex: i });
      return;
    }
    if (d.modes) {
      if (t) {
        for (let m = 0; m < d.modes.length; m++) {
          if (la({ type: 'play', handIndex: i, targets: [t], mode: m })) {
            act({ type: 'play', handIndex: i, targets: [t], mode: m });
            return;
          }
        }
      }
      setModeAsk(i);
      return;
    }
    if (t) {
      act({ type: 'play', handIndex: i, targets: [t] });
      return;
    }
    if (d.targetSpec?.required) {
      setSel({ kind: 'card', index: i });
      return;
    }
    act({ type: 'play', handIndex: i });
  }

  /** Clic sur une cible potentielle ; retourne vrai si la sélection l'a consommée. */
  function clickTarget(t: TargetRef): boolean {
    if (!sel || !myTurn) return false;
    if (sel.kind === 'card')
      act({ type: 'play', handIndex: sel.index, targets: [t], mode: sel.mode });
    else act({ type: 'attack', uid: sel.uid, target: t });
    return true;
  }

  function dropOn(t?: TargetRef) {
    return (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const p = readPayload(e);
      if (!p) return;
      if (p.t === 'card') playFromHand(p.i, t);
      else if (t?.kind === 'station' && t.player === me)
        act({ type: 'guard', uid: p.uid }); // déposer son vaisseau sur sa station = garde
      else if (t) act({ type: 'attack', uid: p.uid, target: t });
    };
  }

  function dragCard(i: number) {
    return (e: DragEvent) =>
      e.dataTransfer.setData('text/plain', JSON.stringify({ t: 'card', i }));
  }
  function dragShip(uid: number) {
    return (e: DragEvent) =>
      e.dataTransfer.setData('text/plain', JSON.stringify({ t: 'ship', uid }));
  }

  function nameOf(pid: PlayerId): string {
    if (online) return online.names[pid] + (pid === me ? ' (vous)' : '');
    return `Joueur ${pid + 1}${ai[pid] ? ' · IA' : pid === me && humans === 1 ? ' (vous)' : ''}`;
  }

  const enemyStation: TargetRef = { kind: 'station', player: en };
  const myStation: TargetRef = { kind: 'station', player: me };
  const genCapacity = P.generators.reduce(
    (n, id) => n + (getDef(id).energyOutput ?? 0),
    0,
  );

  return (
    <div className="app">
      <header>
        <span className="logo">ARMADA</span>
        <span className="turn-info">
          Tour {g.turnCounter} ·{' '}
          {online ? online.names[g.active] : `Joueur ${g.active + 1}`}
          {!online && ai[g.active] ? ' (IA)' : ''}
          {remaining !== null ? ` · ⏱ ${remaining}s` : ''}
        </span>
        <button className="btn-ghost" onClick={props.onExit}>
          {online ? '✕ Abandonner' : '⟲ Nouvelle partie'}
        </button>
      </header>

      <div className="table-grid">
        <main className="board" onClick={() => setSel(null)}>
          {/* ---- Côté ennemi ---- */}
          <section className="side enemy-side" onClick={(e) => e.stopPropagation()}>
            <div className="dashboard">
              <StationPanel
                g={g}
                pid={en}
                label={nameOf(en)}
                accent={accents[en]}
                highlighted={valid.has(targetKey(enemyStation))}
                onClick={() => clickTarget(enemyStation)}
                onDropTarget={dropOn(enemyStation)}
              />
              <div className="modules">
                {E.modules.map((m) => (
                  <ModulePill
                    key={m.uid}
                    m={m}
                    highlighted={valid.has(`module${m.uid}`)}
                    onClick={() => clickTarget({ kind: 'module', player: en, uid: m.uid })}
                    onDropTarget={dropOn({ kind: 'module', player: en, uid: m.uid })}
                    onZoom={setZoom}
                  />
                ))}
              </div>
              <div className="counters">
                <span className="hand-backs">
                  {Array.from({ length: E.hand.length }, (_, i) => (
                    <i key={i} />
                  ))}
                  <em>{E.hand.length}</em>
                </span>
                <span>Deck {E.deck.length}</span>
                <span>Générateurs ×{E.generators.length}</span>
              </div>
            </div>
            <div className="fleet">
              {E.fleet.length === 0 && <span className="void">— espace vide —</span>}
              {E.fleet.map((s) => (
                <ShipToken
                  key={s.uid}
                  g={g}
                  ship={s}
                  mine={false}
                  selected={false}
                  canAct={false}
                  highlighted={valid.has(`ship${s.uid}`)}
                  onClick={() => clickTarget({ kind: 'ship', player: en, uid: s.uid })}
                  onDropTarget={dropOn({ kind: 'ship', player: en, uid: s.uid })}
                  onZoom={setZoom}
                />
              ))}
            </div>
          </section>

          <div className="midline">
            {online && !online.oppConnected && !g.over ? (
              <span className="hint warn">Adversaire déconnecté — il peut revenir…</span>
            ) : aiTurn ? (
              <span className="hint ai">⚙ L'IA joue…</span>
            ) : online && !myTurn && !g.over ? (
              <span className="hint ai">Tour de {online.names[en]}…</span>
            ) : noActions ? (
              <span className="hint">Plus d'action possible — fin de tour automatique…</span>
            ) : sel?.kind === 'ship' ? (
              <span className="hint">
                Choisissez une cible surlignée
                {la({ type: 'guard', uid: sel.uid }) && (
                  <button
                    className="btn-guard"
                    onClick={(e) => {
                      e.stopPropagation();
                      act({ type: 'guard', uid: sel.uid });
                    }}
                  >
                    ⛨ ou mettre en garde
                  </button>
                )}{' '}
                — Échap pour annuler
              </span>
            ) : sel ? (
              <span className="hint">
                Choisissez une cible surlignée — Échap pour annuler
              </span>
            ) : (
              <span className="hint dim">
                Cliquez ou glissez une carte pour la jouer · cliquez un vaisseau puis sa cible pour attaquer
              </span>
            )}
          </div>

          {/* ---- Mon côté ---- */}
          <section
            className="side my-side"
            onClick={(e) => e.stopPropagation()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={dropOn(undefined)}
          >
            <div className="fleet">
              {P.fleet.length === 0 && <span className="void">— aucun vaisseau déployé —</span>}
              {P.fleet.map((s) => (
                <ShipToken
                  key={s.uid}
                  g={g}
                  ship={s}
                  mine
                  selected={sel?.kind === 'ship' && sel.uid === s.uid}
                  canAct={canAct.has(s.uid)}
                  highlighted={valid.has(`ship${s.uid}`)}
                  onClick={() => {
                    if (clickTarget({ kind: 'ship', player: me, uid: s.uid })) return;
                    if (!myTurn) return;
                    setSel(
                      sel?.kind === 'ship' && sel.uid === s.uid
                        ? null
                        : { kind: 'ship', uid: s.uid },
                    );
                  }}
                  onDragStart={dragShip(s.uid)}
                  onZoom={setZoom}
                />
              ))}
            </div>
            <div className="dashboard">
              <StationPanel
                g={g}
                pid={me}
                label={nameOf(me)}
                accent={accents[me]}
                highlighted={valid.has(targetKey(myStation))}
                onClick={() => clickTarget(myStation)}
                onDropTarget={dropOn(myStation)}
              />
              <div className="modules">
                {P.modules.map((m) => (
                  <ModulePill
                    key={m.uid}
                    m={m}
                    highlighted={valid.has(`module${m.uid}`)}
                    onClick={() => clickTarget({ kind: 'module', player: me, uid: m.uid })}
                    onDropTarget={dropOn({ kind: 'module', player: me, uid: m.uid })}
                    onZoom={setZoom}
                  />
                ))}
              </div>
              <div className="counters">
                <EnergyPips current={P.energy} capacity={genCapacity} />
                <span>
                  Générateurs ×{P.generators.length}
                  {P.playedGenerator ? ' · posé' : ''}
                </span>
                <span>
                  Deck {P.deck.length} · Défausse {P.discard.length}
                </span>
                <button className="btn-primary" onClick={onEndTurn} disabled={!myTurn}>
                  Fin de tour
                </button>
              </div>
            </div>
            <div className="hand">
              {!online && ai[me] && (
                <span className="hand-backs big">
                  {P.hand.map((_, i) => (
                    <i key={i} />
                  ))}
                </span>
              )}
              {(online || !ai[me]) &&
                P.hand.map((defId, i) => (
                  <HandCard
                    key={`${defId}#${P.hand.slice(0, i).filter((x) => x === defId).length}`}
                    g={g}
                    pid={me}
                    defId={defId}
                    index={i}
                    count={P.hand.length}
                    playable={playable[i]}
                    selected={sel?.kind === 'card' && sel.index === i}
                    onClick={() =>
                      sel?.kind === 'card' && sel.index === i
                        ? setSel(null)
                        : playFromHand(i)
                    }
                    onDragStart={dragCard(i)}
                    onZoom={setZoom}
                  />
                ))}
            </div>
          </section>
        </main>

        <aside className="log" ref={logRef}>
          {g.log.map((l, i) => (
            <p key={i} className={l.startsWith('—') ? 'log-turn' : ''}>
              {l}
            </p>
          ))}
        </aside>
      </div>

      {/* ---- Surcouches ---- */}
      {toast && <div className="toast">{toast}</div>}

      {zoom && <CardZoom defId={zoom} onClose={() => setZoom(null)} />}

      {modeAsk !== null && P.hand[modeAsk] && (
        <Modal title={getDef(P.hand[modeAsk]).name}>
          {getDef(P.hand[modeAsk]).modes!.map((m, i) => (
            <button
              key={i}
              className="btn-option"
              onClick={() => {
                const idx = modeAsk;
                setModeAsk(null);
                if (m.targetSpec?.required) setSel({ kind: 'card', index: idx, mode: i });
                else act({ type: 'play', handIndex: idx, mode: i });
              }}
            >
              {m.hint}
            </button>
          ))}
          <button className="btn-ghost" onClick={() => setModeAsk(null)}>
            Annuler
          </button>
        </Modal>
      )}

      {g.pendingDecision?.kind === 'scry1' &&
        (online ? g.pendingDecision.player === me : !ai[g.pendingDecision.player]) && (
          <Modal title="Observation">
            <p className="modal-text">
              Première carte de votre deck :{' '}
              <b>{g.pendingDecision.cardId ? getDef(g.pendingDecision.cardId).name : '…'}</b>
            </p>
            <button className="btn-option" onClick={() => act({ type: 'decide', bottom: false })}>
              La garder au-dessus
            </button>
            <button className="btn-option" onClick={() => act({ type: 'decide', bottom: true })}>
              La mettre sous le deck
            </button>
          </Modal>
        )}

      {g.pendingDecision?.kind === 'destroyModule' &&
        (online ? g.pendingDecision.player === me : !ai[g.pendingDecision.player]) && (
          <Modal title="Sabotage — choisissez le module à détruire">
            {g.players[g.pendingDecision.targetPlayer!].modules.map((m) => (
              <button
                key={m.uid}
                className="btn-option"
                onClick={() => act({ type: 'decide', uid: m.uid })}
              >
                ⬡ {getDef(m.defId).name}
              </button>
            ))}
          </Modal>
        )}

      {handoff && !g.over && (
        <div className="overlay opaque" onClick={() => setHandoff(false)}>
          <div className="handoff">
            <p>Tour {g.turnCounter}</p>
            <h2>Joueur {me + 1}</h2>
            <p className="dim">Passez l'écran, puis cliquez pour révéler votre main.</p>
            <button className="btn-primary">Commencer le tour</button>
          </div>
        </div>
      )}

      {g.over && (
        <div className="overlay opaque">
          <div className="handoff">
            <p>Fin de la bataille</p>
            <h2>
              {g.winner === undefined
                ? 'Égalité !'
                : online
                  ? g.winner === me
                    ? 'Victoire !'
                    : `Victoire de ${online.names[g.winner]}`
                  : `Victoire du joueur ${g.winner + 1}`}
            </h2>
            <button className="btn-primary" onClick={props.onExit}>
              {online ? 'Retour au menu' : 'Nouvelle partie'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
