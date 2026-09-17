import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { CARDS } from '../core/cards';
import { DECK_RAZZIA, DECK_REMPART, UNLIMITED, validateDeck } from '../core/decks';
import { drawBooster } from '../core/boosters';

/**
 * Persistance des joueurs : comptes (mot de passe haché scrypt), jetons de
 * session, collection de cartes, decks sauvegardés, boosters et bilan.
 */

export interface SavedDeck {
  name: string;
  cards: string[];
}

export interface Profile {
  pseudo: string;
  collection: Record<string, number>;
  decks: SavedDeck[];
  boosters: number;
  wins: number;
  losses: number;
}

const WELCOME_BOOSTERS = 2;

/** Collection de départ : le contenu des deux decks de démarrage (hors N01). */
function startingCollection(): Map<string, number> {
  const m = new Map<string, number>();
  for (const id of [...DECK_REMPART, ...DECK_RAZZIA])
    if (id !== 'N01') m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

export class Store {
  private db: Database.Database;

  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pseudo TEXT UNIQUE NOT NULL,
        pass_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        boosters INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS collection (
        player_id INTEGER NOT NULL,
        card_id TEXT NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (player_id, card_id)
      );
      CREATE TABLE IF NOT EXISTS decks (
        player_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        cards TEXT NOT NULL,
        PRIMARY KEY (player_id, name)
      );
      CREATE TABLE IF NOT EXISTS tokens (
        token TEXT PRIMARY KEY,
        player_id INTEGER NOT NULL
      );
    `);
  }

  /** Connexion, ou création du compte si le pseudo est libre. */
  auth(pseudoRaw: string, password: string): { playerId: number; pseudo: string } {
    const pseudo = pseudoRaw.trim().slice(0, 20);
    if (pseudo.length < 2) throw new Error('Pseudo trop court (2 caractères minimum).');
    if (password.length < 4)
      throw new Error('Mot de passe trop court (4 caractères minimum).');
    const row = this.db
      .prepare('SELECT id, pass_hash, salt FROM players WHERE pseudo = ?')
      .get(pseudo) as { id: number; pass_hash: string; salt: string } | undefined;
    if (row) {
      const hash = scryptSync(password, row.salt, 32).toString('hex');
      if (!timingSafeEqual(Buffer.from(hash), Buffer.from(row.pass_hash)))
        throw new Error('Mot de passe incorrect.');
      return { playerId: row.id, pseudo };
    }
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 32).toString('hex');
    const info = this.db
      .prepare('INSERT INTO players (pseudo, pass_hash, salt, boosters) VALUES (?, ?, ?, ?)')
      .run(pseudo, hash, salt, WELCOME_BOOSTERS);
    const playerId = Number(info.lastInsertRowid);
    const ins = this.db.prepare(
      'INSERT INTO collection (player_id, card_id, count) VALUES (?, ?, ?)',
    );
    for (const [id, n] of startingCollection()) ins.run(playerId, id, n);
    return { playerId, pseudo };
  }

  createToken(playerId: number): string {
    const token = randomBytes(16).toString('hex');
    this.db.prepare('INSERT INTO tokens (token, player_id) VALUES (?, ?)').run(token, playerId);
    return token;
  }

  resolveToken(token: string): { playerId: number; pseudo: string } | null {
    const row = this.db
      .prepare(
        'SELECT p.id AS id, p.pseudo AS pseudo FROM tokens t JOIN players p ON p.id = t.player_id WHERE t.token = ?',
      )
      .get(token) as { id: number; pseudo: string } | undefined;
    return row ? { playerId: row.id, pseudo: row.pseudo } : null;
  }

  profile(playerId: number): Profile {
    const p = this.db
      .prepare('SELECT pseudo, boosters, wins, losses FROM players WHERE id = ?')
      .get(playerId) as { pseudo: string; boosters: number; wins: number; losses: number };
    const collection: Record<string, number> = {};
    for (const row of this.db
      .prepare('SELECT card_id, count FROM collection WHERE player_id = ?')
      .all(playerId) as { card_id: string; count: number }[])
      collection[row.card_id] = row.count;
    const decks = (
      this.db.prepare('SELECT name, cards FROM decks WHERE player_id = ? ORDER BY name').all(playerId) as {
        name: string;
        cards: string;
      }[]
    ).map((d) => ({ name: d.name, cards: JSON.parse(d.cards) as string[] }));
    return { ...p, collection, decks };
  }

  addCards(playerId: number, ids: string[]): void {
    const up = this.db.prepare(`
      INSERT INTO collection (player_id, card_id, count) VALUES (?, ?, 1)
      ON CONFLICT (player_id, card_id) DO UPDATE SET count = count + 1
    `);
    for (const id of ids) up.run(playerId, id);
  }

  grantBoosters(playerId: number, n: number): void {
    this.db.prepare('UPDATE players SET boosters = boosters + ? WHERE id = ?').run(n, playerId);
  }

  /** Ouvre un booster : décrémente, tire 5 cartes, les ajoute à la collection. */
  openBooster(playerId: number): string[] | null {
    const r = this.db
      .prepare('UPDATE players SET boosters = boosters - 1 WHERE id = ? AND boosters > 0')
      .run(playerId);
    if (r.changes === 0) return null;
    const cards = drawBooster((n) => randomInt(n));
    this.addCards(playerId, cards);
    return cards;
  }

  recordResult(playerId: number, won: boolean, draw: boolean): void {
    if (draw) return;
    this.db
      .prepare(`UPDATE players SET ${won ? 'wins = wins + 1' : 'losses = losses + 1'} WHERE id = ?`)
      .run(playerId);
  }

  /** Sauvegarde un deck après validation (règles + possession). */
  saveDeck(playerId: number, nameRaw: string, cards: string[]): void {
    const name = nameRaw.trim().slice(0, 24);
    if (name.length < 1) throw new Error('Donnez un nom au deck.');
    if (!Array.isArray(cards) || cards.some((c) => typeof c !== 'string'))
      throw new Error('Liste de cartes invalide.');
    const errors = validateDeck(cards);
    if (errors.length > 0) throw new Error(errors[0]);
    const profile = this.profile(playerId);
    const counts = new Map<string, number>();
    for (const id of cards) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const [id, n] of counts) {
      if (UNLIMITED.has(id)) continue;
      const owned = profile.collection[id] ?? 0;
      if (n > owned)
        throw new Error(`${CARDS[id]?.name ?? id} : ${n} exemplaires dans le deck, ${owned} possédés.`);
    }
    this.db
      .prepare(`
        INSERT INTO decks (player_id, name, cards) VALUES (?, ?, ?)
        ON CONFLICT (player_id, name) DO UPDATE SET cards = excluded.cards
      `)
      .run(playerId, name, JSON.stringify(cards));
  }

  deleteDeck(playerId: number, name: string): void {
    this.db.prepare('DELETE FROM decks WHERE player_id = ? AND name = ?').run(playerId, name);
  }

  getDeckCards(playerId: number, name: string): string[] | null {
    const row = this.db
      .prepare('SELECT cards FROM decks WHERE player_id = ? AND name = ?')
      .get(playerId, name) as { cards: string } | undefined;
    return row ? (JSON.parse(row.cards) as string[]) : null;
  }

  close(): void {
    this.db.close();
  }
}
