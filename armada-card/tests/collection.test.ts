import { describe, expect, test } from 'vitest';
import { BOOSTER_POOL, drawBooster } from '../src/core/boosters';
import { CARDS } from '../src/core/cards';
import { Store } from '../src/server/store';
import { DECK_REMPART } from '../src/core/decks';

describe('boosters', () => {
  test('le pool exclut N01, les jetons et la carte cachée', () => {
    const all = Object.values(BOOSTER_POOL).flat();
    expect(all).not.toContain('N01');
    expect(all).not.toContain('TK1');
    expect(all).not.toContain('XX');
    expect(all).toHaveLength(59); // 60 cartes − N01
  });

  test('tirage : 3 communes, 1 rare, 1 spéciale selon le jet', () => {
    // rand contrôlé : toujours l'indice 0, jet de rareté forcé.
    const make = (roll: number) => {
      let i = 0;
      return (n: number) => (++i === 5 ? Math.min(roll, n - 1) : 0);
    };
    const legendaire = drawBooster(make(5)); // jet 5 < 10 → légendaire
    expect(CARDS[legendaire[4]].rarity).toBe('legendaire');
    const epique = drawBooster(make(20)); // 10 ≤ 20 < 40 → épique
    expect(CARDS[epique[4]].rarity).toBe('epique');
    const rare = drawBooster(make(80)); // ≥ 40 → rare
    expect(CARDS[rare[4]].rarity).toBe('rare');
    for (const b of [legendaire, epique, rare]) {
      expect(b).toHaveLength(5);
      expect(b.slice(0, 3).every((id) => CARDS[id].rarity === 'commune')).toBe(true);
      expect(CARDS[b[3]].rarity).toBe('rare');
    }
  });
});

describe('comptes et collection (SQLite en mémoire)', () => {
  test('création de compte, connexion, mauvais mot de passe', () => {
    const s = new Store(':memory:');
    const a = s.auth('Alice', 'secret');
    expect(a.pseudo).toBe('Alice');
    expect(s.auth('Alice', 'secret').playerId).toBe(a.playerId);
    expect(() => s.auth('Alice', 'mauvais')).toThrow(/incorrect/);
    expect(() => s.auth('A', 'secret')).toThrow(/court/);
    expect(() => s.auth('Bob', 'x')).toThrow(/court/);
    s.close();
  });

  test('jeton de session persistant', () => {
    const s = new Store(':memory:');
    const a = s.auth('Alice', 'secret');
    const token = s.createToken(a.playerId);
    expect(s.resolveToken(token)).toEqual({ playerId: a.playerId, pseudo: 'Alice' });
    expect(s.resolveToken('inconnu')).toBeNull();
    s.close();
  });

  test('collection de départ : les deux decks de démarrage + 2 boosters', () => {
    const s = new Store(':memory:');
    const { playerId } = s.auth('Alice', 'secret');
    const p = s.profile(playerId);
    expect(p.collection.F01).toBe(3);
    expect(p.collection.C16).toBe(2);
    expect(p.collection.N06).toBe(4); // 2 dans chaque deck
    expect(p.collection.N01).toBeUndefined(); // le générateur de base est illimité
    expect(p.boosters).toBe(2);
    s.close();
  });

  test('ouvrir un booster : décrémente et enrichit la collection', () => {
    const s = new Store(':memory:');
    const { playerId } = s.auth('Alice', 'secret');
    const avant = Object.values(s.profile(playerId).collection).reduce((a, b) => a + b, 0);
    const cards = s.openBooster(playerId)!;
    expect(cards).toHaveLength(5);
    const apres = s.profile(playerId);
    expect(apres.boosters).toBe(1);
    expect(Object.values(apres.collection).reduce((a, b) => a + b, 0)).toBe(avant + 5);
    s.openBooster(playerId);
    expect(s.openBooster(playerId)).toBeNull(); // plus de boosters
    s.close();
  });

  test('sauvegarde de deck : règles et possession vérifiées', () => {
    const s = new Store(':memory:');
    const { playerId } = s.auth('Alice', 'secret');
    expect(() => s.saveDeck(playerId, 'Trop court', ['N01'])).toThrow(/minimum/);
    const tropDeCopies = [...Array(15).fill('N01'), ...Array(4).fill('N06'), ...Array(21).fill('F01')];
    expect(() => s.saveDeck(playerId, 'Triche', tropDeCopies)).toThrow(/exemplaires/);
    const pasPossede = [...Array(16).fill('N01'), ...Array(3).fill('F25'), ...Array(21).fill('N01')];
    expect(() => s.saveDeck(playerId, 'Triche', pasPossede)).toThrow(/possédés/);
    s.saveDeck(playerId, 'Mon Rempart', DECK_REMPART);
    expect(s.getDeckCards(playerId, 'Mon Rempart')).toHaveLength(40);
    expect(s.profile(playerId).decks[0].name).toBe('Mon Rempart');
    s.deleteDeck(playerId, 'Mon Rempart');
    expect(s.getDeckCards(playerId, 'Mon Rempart')).toBeNull();
    s.close();
  });

  test('bilan victoires/défaites', () => {
    const s = new Store(':memory:');
    const { playerId } = s.auth('Alice', 'secret');
    s.recordResult(playerId, true, false);
    s.recordResult(playerId, false, false);
    s.recordResult(playerId, false, true); // égalité : rien
    const p = s.profile(playerId);
    expect(p.wins).toBe(1);
    expect(p.losses).toBe(1);
    s.close();
  });
});
