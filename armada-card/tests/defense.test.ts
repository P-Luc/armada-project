import { describe, expect, test } from 'vitest';
import { attack, endTurn, guardShip, playCard, playGenerator } from '../src/core/game';
import type { TargetRef } from '../src/core/types';
import { addModule, bare, give, put } from './util';

const station = (player: 0 | 1): TargetRef => ({ kind: 'station', player });

describe('bouclier de station', () => {
  test('le bouclier absorbe avant la coque (destruction obligatoire)', () => {
    const g = bare();
    const a1 = put(g, 0, 'C10'); // 4 ATK
    attack(g, a1.uid, station(1));
    expect(g.players[1].shield).toBe(0);
    expect(g.players[1].stationHp).toBe(20); // coque intacte
    const a2 = put(g, 0, 'C05'); // 3 ATK
    attack(g, a2.uid, station(1));
    expect(g.players[1].stationHp).toBe(17); // bouclier percé
  });

  test('les dégâts excédentaires passent sur la coque', () => {
    const g = bare();
    const a = put(g, 0, 'C23'); // 7 ATK
    attack(g, a.uid, station(1));
    expect(g.players[1].shield).toBe(0);
    expect(g.players[1].stationHp).toBe(17); // 7 - 4 PB
  });

  test('le bouclier ne se recharge pas tout seul (une fois percé, il reste percé)', () => {
    const g = bare();
    g.players[0].shield = 0;
    endTurn(g);
    endTurn(g); // début du tour de J1
    expect(g.players[0].shield).toBe(0);
  });

  test('Perce-bouclier ignore le bouclier mais pas le Blindage (Extorsion)', () => {
    const g = bare();
    g.players[0].energy = 2;
    playCard(g, give(g, 0, 'C11'));
    expect(g.players[1].shield).toBe(4); // bouclier intact
    expect(g.players[1].stationHp).toBe(18); // la coque encaisse
  });

  test('le Blindage réduit avant le bouclier', () => {
    const g = bare();
    addModule(g, 1, 'F05'); // Blindage 1
    const a = put(g, 0, 'C10'); // 4 ATK
    attack(g, a.uid, station(1));
    expect(g.players[1].shield).toBe(1); // 4 - 1 = 3 absorbés
    expect(g.players[1].stationHp).toBe(20);
  });

  test('les dégâts internes ignorent le bouclier (fusion instable)', () => {
    const g = bare();
    playGenerator(g, give(g, 0, 'N02'));
    expect(g.players[0].shield).toBe(4); // bouclier intact
    expect(g.players[0].stationHp).toBe(19); // la coque encaisse directement
  });

  test('un effet de coque est neutralisé si le bouclier absorbe tout (Nyx)', () => {
    const g = bare();
    const nyx = put(g, 0, 'C19'); // 2 ATK, furtif
    addModule(g, 1, 'N08');
    attack(g, nyx.uid, station(1));
    expect(g.players[1].shield).toBe(2);
    expect(g.players[1].stationHp).toBe(20);
    expect(g.pendingDecision).toBeUndefined(); // pas de sabotage : la coque est intacte
  });
});

describe('garde (blocage)', () => {
  test('un gardien intercepte une attaque sur la station', () => {
    const g = bare();
    const gardien = put(g, 1, 'F03'); // 2/3
    gardien.guarding = true;
    const a = put(g, 0, 'C10'); // 4/3
    attack(g, a.uid, station(1));
    // Combat redirigé : le gardien meurt (4 ≥ 3), l'attaquant subit la riposte 2.
    expect(g.players[1].fleet).toHaveLength(0);
    expect(a.damage).toBe(2);
    expect(g.players[1].shield).toBe(4); // station intouchée
    expect(g.players[1].stationHp).toBe(20);
  });

  test('la garde n\'intercepte qu\'une seule attaque', () => {
    const g = bare();
    const gardien = put(g, 1, 'F10'); // 4/6 : survit
    gardien.guarding = true;
    const a1 = put(g, 0, 'C01'); // 2/1
    const a2 = put(g, 0, 'C05'); // 3/1
    attack(g, a1.uid, station(1));
    expect(gardien.guarding).toBe(false);
    attack(g, a2.uid, station(1));
    expect(g.players[1].shield).toBe(1); // la 2e attaque passe
  });

  test('un attaquant furtif ignore la garde', () => {
    const g = bare();
    const gardien = put(g, 1, 'F03');
    gardien.guarding = true;
    const skiff = put(g, 0, 'C02'); // furtif
    attack(g, skiff.uid, station(1));
    expect(gardien.guarding).toBe(true);
    expect(g.players[1].shield).toBe(3);
  });

  test('attaquer directement un gardien ne consomme pas sa garde', () => {
    const g = bare();
    const gardien = put(g, 1, 'F10'); // 4/6
    gardien.guarding = true;
    const a = put(g, 0, 'F01'); // 2/1
    attack(g, a.uid, { kind: 'ship', player: 1, uid: gardien.uid });
    expect(gardien.guarding).toBe(true);
    expect(gardien.damage).toBe(2);
  });

  test('la garde protège aussi les autres vaisseaux', () => {
    const g = bare();
    const gardien = put(g, 1, 'F03'); // 2/3
    const protege = put(g, 1, 'C06'); // 1/2
    gardien.guarding = true;
    const a = put(g, 0, 'C10');
    attack(g, a.uid, { kind: 'ship', player: 1, uid: protege.uid });
    expect(protege.damage).toBe(0); // intercepté
    expect(g.players[1].fleet.find((s) => s.uid === gardien.uid)).toBeUndefined();
  });

  test('la garde est l\'action du tour : pas d\'attaque ensuite, expire au tour suivant', () => {
    const g = bare();
    const s = put(g, 0, 'F03');
    guardShip(g, s.uid);
    expect(s.guarding).toBe(true);
    expect(() => attack(g, s.uid, station(1))).toThrow(/déjà agi/);
    endTurn(g);
    endTurn(g); // retour à J1
    expect(s.guarding).toBe(false);
    expect(s.attacksUsed).toBe(0);
  });

  test('un vaisseau au mal de saut peut se mettre en garde dès son arrivée', () => {
    const g = bare();
    g.players[0].energy = 2;
    playCard(g, give(g, 0, 'F03'));
    const s = g.players[0].fleet[0];
    guardShip(g, s.uid); // pas d'erreur malgré le mal de saut
    expect(s.guarding).toBe(true);
  });

  test('le Vaisseau-bélier refuse la garde', () => {
    const g = bare();
    const b = put(g, 0, 'C18');
    expect(() => guardShip(g, b.uid)).toThrow(/doit attaquer/);
  });
});
