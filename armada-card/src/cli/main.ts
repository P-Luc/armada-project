import * as readline from 'node:readline';
import { stdin, stdout } from 'node:process';
import {
  attack,
  decide,
  effAtk,
  effHp,
  endTurn,
  getCost,
  guardShip,
  isJammed,
  isSick,
  isStealthed,
  newGame,
  playCard,
  playGenerator,
  stationArmor,
} from '../core/game';
import { getDef } from '../core/cards';
import { DECK_RAZZIA, DECK_REMPART } from '../core/decks';
import type { GameState, PlayerId, ShipInstance, TargetRef } from '../core/types';

function shipLine(g: GameState, s: ShipInstance): string {
  const d = getDef(s.defId);
  const tags: string[] = [];
  if (d.escorte) tags.push('Escorte');
  if (isStealthed(s)) tags.push('Furtif');
  if (s.tempFurtif) tags.push('furtif (tour)');
  if ((d.armor ?? 0) > 0) tags.push(`Blindage ${d.armor}`);
  if (s.guarding) tags.push('en garde');
  if (isJammed(g, s)) tags.push('brouillé');
  if (isSick(g, s)) tags.push('mal de saut');
  else if (s.attacksUsed > 0) tags.push('a attaqué');
  const pv = effHp(g, s) - s.damage;
  return `  [v${s.uid}] ${d.name} ${effAtk(g, s)}/${pv}${tags.length ? ' — ' + tags.join(', ') : ''}`;
}

function render(g: GameState): void {
  const me = g.active;
  const op = (1 - me) as PlayerId;
  const o = g.players[op];
  const p = g.players[me];
  console.log('');
  console.log(`========== Tour ${g.turnCounter} — au joueur ${me + 1} de jouer ==========`);
  const oArmor = stationArmor(g, op);
  console.log(`ADVERSAIRE (J${op + 1}) — Station ${o.stationHp}/${o.stationMaxHp} PV — Bouclier ${o.shield}/${o.shieldMax}${oArmor ? ` [Blindage ${oArmor}]` : ''} — Main : ${o.hand.length} — Deck : ${o.deck.length} — Générateurs : ${o.generators.length}`);
  for (const m of o.modules) console.log(`  [m${m.uid}] ${getDef(m.defId).name}`);
  for (const s of o.fleet) console.log(shipLine(g, s));
  const pArmor = stationArmor(g, me);
  console.log(`VOUS (J${me + 1}) — Station ${p.stationHp}/${p.stationMaxHp} PV — Bouclier ${p.shield}/${p.shieldMax}${pArmor ? ` [Blindage ${pArmor}]` : ''} — Énergie : ${p.energy} — Deck : ${p.deck.length} — Générateurs : ${p.generators.length}${p.playedGenerator ? ' (posé ce tour)' : ''}`);
  for (const m of p.modules) console.log(`  [m${m.uid}] ${getDef(m.defId).name}`);
  for (const s of p.fleet) console.log(shipLine(g, s));
  console.log('Main :');
  p.hand.forEach((id, i) => {
    const d = getDef(id);
    const cost = d.type === 'generateur' ? 'gén.' : `${getCost(g, me, id)}⚡`;
    const stats = d.type === 'vaisseau' ? ` ${d.atk}/${d.hp}` : '';
    console.log(`  (${i}) [${cost}] ${d.name}${stats}${d.text ? ' — ' + d.text : ''}`);
  });
}

/** `station` = station ennemie, `ms` = ma station, `v<uid>`, `m<uid>`. */
function parseTarget(g: GameState, tok: string, me: PlayerId): TargetRef {
  if (tok === 'station') return { kind: 'station', player: (1 - me) as PlayerId };
  if (tok === 'ms') return { kind: 'station', player: me };
  let m = /^v(\d+)$/.exec(tok);
  if (m) {
    const uid = Number(m[1]);
    for (const pid of [0, 1] as PlayerId[])
      if (g.players[pid].fleet.some((s) => s.uid === uid))
        return { kind: 'ship', player: pid, uid };
    throw new Error(`Aucun vaisseau v${uid}.`);
  }
  m = /^m(\d+)$/.exec(tok);
  if (m) {
    const uid = Number(m[1]);
    for (const pid of [0, 1] as PlayerId[])
      if (g.players[pid].modules.some((x) => x.uid === uid))
        return { kind: 'module', player: pid, uid };
    throw new Error(`Aucun module m${uid}.`);
  }
  throw new Error(`Cible incomprise : ${tok}`);
}

const AIDE = `Commandes :
  gen <n>            poser le générateur en main, position n
  jouer <n> [cible] [mode]
                     jouer la carte n. Cible : station | ms | v<uid> | m<uid>
                     Carte modale : ajouter le numéro de mode (0, 1, ...)
  att <uid> <cible>  attaquer avec v<uid> : station ou v<uid>
  garde <uid>        mettre v<uid> en garde (il interceptera la prochaine attaque)
  fin                terminer le tour
  etat               réafficher le plateau
  aide               cette aide
  quitter            abandonner`;

/** File de lignes : fiable aussi bien en interactif qu'avec une entrée en pipe. */
function makePrompter(rl: readline.Interface) {
  const lines: string[] = [];
  const waiters: ((l: string | undefined) => void)[] = [];
  let closed = false;
  rl.on('line', (l) => {
    const w = waiters.shift();
    if (w) w(l);
    else lines.push(l);
  });
  rl.on('close', () => {
    closed = true;
    for (const w of waiters.splice(0)) w(undefined);
  });
  return (prompt: string): Promise<string | undefined> => {
    stdout.write(prompt);
    if (lines.length > 0) return Promise.resolve(lines.shift());
    if (closed) return Promise.resolve(undefined);
    return new Promise((resolve) => waiters.push(resolve));
  };
}

async function main(): Promise<void> {
  const rl = readline.createInterface({ input: stdin, output: stdout, terminal: false });
  const ask = makePrompter(rl);
  const seed = Number(process.argv[2]) || (process.pid * 7919) % 2147483647;
  const g = newGame(DECK_REMPART, DECK_RAZZIA, seed);
  console.log('ARMADA — prototype console (graine ' + seed + ')');
  console.log('J1 : Fédération « Rempart »  /  J2 : Ceinture « Razzia »');
  console.log(AIDE);
  let lastLog = 0;
  let lastTurn = 0;

  while (true) {
    for (; lastLog < g.log.length; lastLog++) console.log('  · ' + g.log[lastLog]);
    if (g.over) break;

    if (g.pendingDecision) {
      const d = g.pendingDecision;
      try {
        if (d.kind === 'scry1') {
          const ans = await ask(
            `J${d.player + 1}, première carte du deck : ${getDef(d.cardId!).name}. La garder au-dessus ? (garder/dessous) `,
          );
          if (ans === undefined) break;
          decide(g, { bottom: ans.trim().toLowerCase().startsWith('d') });
        } else {
          const mods = g.players[d.targetPlayer!].modules
            .map((m) => `m${m.uid} ${getDef(m.defId).name}`)
            .join(', ');
          const ans = await ask(`J${d.player + 1}, module à détruire (${mods}) : `);
          if (ans === undefined) break;
          const m = /^m?(\d+)$/.exec(ans.trim());
          if (!m) throw new Error('Réponse incomprise.');
          decide(g, { uid: Number(m[1]) });
        }
      } catch (e) {
        console.log('  ! ' + (e as Error).message);
      }
      continue;
    }

    if (g.turnCounter !== lastTurn) {
      render(g);
      lastTurn = g.turnCounter;
    }
    const raw = await ask(`J${g.active + 1}> `);
    if (raw === undefined) break;
    const line = raw.trim();
    if (!line) continue;
    const [cmd, ...args] = line.split(/\s+/);
    try {
      switch (cmd) {
        case 'gen':
          playGenerator(g, Number(args[0]));
          break;
        case 'jouer': {
          const n = Number(args[0]);
          const targets: TargetRef[] = [];
          let mode: number | undefined;
          for (const tok of args.slice(1)) {
            if (/^\d+$/.test(tok)) mode = Number(tok);
            else targets.push(parseTarget(g, tok, g.active));
          }
          playCard(g, n, { targets, mode });
          break;
        }
        case 'att':
          attack(g, Number(args[0]), parseTarget(g, args[1] ?? '', g.active));
          break;
        case 'garde':
          guardShip(g, Number(args[0]));
          break;
        case 'fin':
          endTurn(g);
          break;
        case 'etat':
          render(g);
          break;
        case 'aide':
          console.log(AIDE);
          break;
        case 'quitter':
          rl.close();
          return;
        default:
          console.log('Commande inconnue. Tapez « aide ».');
      }
    } catch (e) {
      console.log('  ! ' + (e as Error).message);
    }
  }
  console.log(
    g.winner === undefined
      ? 'Égalité !'
      : `Victoire du joueur ${g.winner + 1} !`,
  );
  rl.close();
}

main();
