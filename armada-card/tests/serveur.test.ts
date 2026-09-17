import { afterEach, describe, expect, test } from 'vitest';
import WebSocket from 'ws';
import { startServer } from '../src/server/server';
import type { ServerHandle } from '../src/server/server';
import { DECK_REMPART } from '../src/core/decks';

const BASE_PORT = 18700 + (process.pid % 50);
let srv: ServerHandle | null = null;
afterEach(() => {
  srv?.close();
  srv = null;
});

/** Serveur de test : base en mémoire, jamais le fichier de production. */
function boot(opts: { port: number; turnMs?: number; seed?: number; rewardMinTurns?: number }) {
  srv = startServer({ ...opts, dbPath: ':memory:' });
  return srv;
}

class TestClient {
  ws!: WebSocket;
  private msgs: Record<string, unknown>[] = [];
  private wake: (() => void)[] = [];

  static async open(port: number): Promise<TestClient> {
    const c = new TestClient();
    c.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((res, rej) => {
      c.ws.once('open', () => res());
      c.ws.once('error', rej);
    });
    c.ws.on('message', (d) => {
      c.msgs.push(JSON.parse(d.toString()));
      c.wake.splice(0).forEach((w) => w());
    });
    return c;
  }

  send(o: unknown): void {
    this.ws.send(JSON.stringify(o));
  }

  async next(type: string, timeout = 4000): Promise<Record<string, any>> {
    const t0 = Date.now();
    for (;;) {
      const i = this.msgs.findIndex((m) => m.t === type);
      if (i >= 0) return this.msgs.splice(i, 1)[0] as Record<string, any>;
      if (Date.now() - t0 > timeout)
        throw new Error(`Timeout « ${type} » ; reçus : ${this.msgs.map((m) => m.t).join(', ')}`);
      await new Promise<void>((res) => {
        this.wake.push(res);
        setTimeout(res, 50);
      });
    }
  }

  close(): void {
    this.ws.close();
  }
}

/** Ouvre une connexion et crée (ou retrouve) le compte : `auth` → `welcome`. */
async function login(port: number, pseudo: string, password = 'secret') {
  const c = await TestClient.open(port);
  c.send({ t: 'auth', pseudo, password });
  const welcome = await c.next('welcome');
  return { c, welcome };
}

async function startMatch(port: number) {
  const { c: a, welcome: wa } = await login(port, 'Alice');
  const { c: b, welcome: wb } = await login(port, 'Bob');
  a.send({ t: 'queue', deck: 'rempart' });
  await a.next('queued');
  b.send({ t: 'queue', deck: 'razzia' });
  const sa = await a.next('start');
  const sb = await b.next('start');
  return { a, b, wa, wb, sa, sb };
}

describe('serveur de jeu', () => {
  test('comptes : pseudo créé au vol, mot de passe et jeton vérifiés', async () => {
    const port = BASE_PORT + 5;
    boot({ port, seed: 42 });

    const { c: a, welcome } = await login(port, 'Alice');
    expect(welcome.pseudo).toBe('Alice');
    expect(String(welcome.token)).toMatch(/^[0-9a-f]{32}$/);
    expect(welcome.enPartie).toBe(false);
    // Le profil suit immédiatement : collection de départ et boosters d'accueil.
    const profile = await a.next('profile');
    expect(profile.pseudo).toBe('Alice');
    expect(profile.boosters).toBe(2);
    expect(profile.collection.F01).toBe(3);
    expect(profile.decks).toEqual([]);

    // Mauvais mot de passe sur un pseudo existant : refusé.
    const imposteur = await TestClient.open(port);
    imposteur.send({ t: 'auth', pseudo: 'Alice', password: 'mauvais' });
    expect((await imposteur.next('err')).message).toMatch(/incorrect/);

    // Jeton inconnu : refusé, et rien n'est ouvert sans authentification.
    const inconnu = await TestClient.open(port);
    inconnu.send({ t: 'hello', token: 'jeton-bidon' });
    expect((await inconnu.next('err')).message).toMatch(/Session expirée/);
    inconnu.send({ t: 'queue', deck: 'rempart' });
    expect((await inconnu.next('err')).message).toMatch(/Connectez-vous/);

    a.close();
    imposteur.close();
    inconnu.close();
  });

  test('matchmaking, vues cachées, actions validées', async () => {
    const port = BASE_PORT;
    boot({ port, seed: 42 });
    const { a, b, sa, sb } = await startMatch(port);

    expect(sa.seat).toBe(0);
    expect(sb.seat).toBe(1);
    expect(sa.names).toEqual(['Alice', 'Bob']);
    expect(sa.accents).toEqual(['federation', 'ceinture']);
    // Sa main est visible, son deck et la main adverse sont masqués.
    expect(sa.view.players[0].hand.every((id: string) => id !== 'XX')).toBe(true);
    expect(sa.view.players[0].deck.every((id: string) => id === 'XX')).toBe(true);
    expect(sb.view.players[0].hand.every((id: string) => id === 'XX')).toBe(true);
    expect(sa.view.rng.seed).toBe(0);

    // Action hors tour refusée.
    b.send({ t: 'action', action: { type: 'endTurn' } });
    expect((await b.next('err')).message).toMatch(/votre tour/);

    // Alice pose un générateur : les deux clients reçoivent la vue.
    const gi = sa.view.players[0].hand.findIndex((id: string) => id.startsWith('N0'));
    expect(gi).toBeGreaterThanOrEqual(0);
    a.send({ t: 'action', action: { type: 'generator', handIndex: gi } });
    const va = await a.next('view');
    const vb = await b.next('view');
    expect(va.view.players[0].generators).toHaveLength(1);
    expect(vb.view.players[0].generators).toHaveLength(1);

    // Fin de tour : Bob devient actif.
    a.send({ t: 'action', action: { type: 'endTurn' } });
    expect((await b.next('view')).view.active).toBe(1);

    a.close();
    b.close();
  });

  test('le timeout de tour force la fin du tour', async () => {
    const port = BASE_PORT + 1;
    boot({ port, seed: 7, turnMs: 400 });
    const { a, b } = await startMatch(port);
    // Sans aucune action, le serveur doit passer la main à Bob tout seul.
    const v = await a.next('view', 3000);
    expect(v.view.active).toBe(1);
    expect(v.view.log.join(' ')).toMatch(/Temps écoulé/);
    a.close();
    b.close();
  });

  test('reconnexion avec jeton en cours de partie', async () => {
    const port = BASE_PORT + 2;
    boot({ port, seed: 42 });
    const { a, b, wa } = await startMatch(port);
    a.close();
    const off = await b.next('oppConnection');
    expect(off.connected).toBe(false);
    // Alice revient avec son jeton : elle reçoit la partie en cours.
    const a2 = await TestClient.open(port);
    a2.send({ t: 'hello', token: wa.token });
    const welcome = await a2.next('welcome');
    expect(welcome.pseudo).toBe('Alice');
    expect(welcome.enPartie).toBe(true); // le client sait qu'un `start` de reprise suit
    const resumed = await a2.next('start');
    expect(resumed.resumed).toBe(true);
    expect(resumed.seat).toBe(0);
    expect(resumed.view.players[0].hand.every((id: string) => id !== 'XX')).toBe(true);
    const on = await b.next('oppConnection');
    expect(on.connected).toBe(true);
    a2.close();
    b.close();
  });

  test('l\'abandon donne la victoire à l\'adversaire', async () => {
    const port = BASE_PORT + 3;
    boot({ port, seed: 42 });
    const { a, b } = await startMatch(port);
    a.send({ t: 'leave' });
    const v = await b.next('view');
    expect(v.view.over).toBe(true);
    expect(v.view.winner).toBe(1);
    expect(v.view.log.join(' ')).toMatch(/abandonne/);
    a.close();
    b.close();
  });

  test('partie privée par code', async () => {
    const port = BASE_PORT + 4;
    boot({ port, seed: 42 });
    const { c: a } = await login(port, 'Alice');
    a.send({ t: 'createPrivate', deck: 'rempart' });
    const { code } = await a.next('private');
    expect(String(code)).toMatch(/^[A-Z0-9]{5}$/);
    const { c: b } = await login(port, 'Bob');
    b.send({ t: 'joinPrivate', code: 'ZZZZZ', deck: 'razzia' });
    expect((await b.next('err')).message).toMatch(/introuvable/);
    b.send({ t: 'joinPrivate', code, deck: 'razzia' });
    const sa = await a.next('start');
    const sb = await b.next('start');
    expect(sa.seat).toBe(0);
    expect(sb.seat).toBe(1);
    a.close();
    b.close();
  });

  test('deck sauvegardé jouable en ligne, boosters versés en fin de partie', async () => {
    const port = BASE_PORT + 6;
    boot({ port, seed: 42, rewardMinTurns: 0 });
    const { c: a } = await login(port, 'Alice');
    await a.next('profile');

    // Deck introuvable : la file d'attente reste fermée.
    a.send({ t: 'queue', deck: 'Mon Rempart' });
    expect((await a.next('err')).message).toMatch(/Deck introuvable/);

    a.send({ t: 'saveDeck', name: 'Mon Rempart', cards: DECK_REMPART });
    expect((await a.next('profile')).decks[0].name).toBe('Mon Rempart');
    a.send({ t: 'queue', deck: 'Mon Rempart' });
    await a.next('queued');

    const { c: b } = await login(port, 'Bob');
    await b.next('profile'); // profil de connexion : consommé pour ne pas masquer celui du bilan
    b.send({ t: 'queue', deck: 'razzia' });
    await a.next('start');
    await b.next('start');

    // Bob abandonne : Alice gagne, +2 boosters pour elle, +1 pour lui.
    b.send({ t: 'leave' });
    const pa = await a.next('profile');
    expect(pa.wins).toBe(1);
    expect(pa.boosters).toBe(4); // 2 d'accueil + 2 de victoire
    const pb = await b.next('profile');
    expect(pb.losses).toBe(1);
    expect(pb.boosters).toBe(3); // 2 d'accueil + 1 de participation

    // Un booster ouvert enrichit la collection.
    a.send({ t: 'openBooster' });
    expect((await a.next('booster')).cards).toHaveLength(5);
    expect((await a.next('profile')).boosters).toBe(3);

    a.close();
    b.close();
  });
});
