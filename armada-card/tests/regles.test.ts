import { describe, expect, test } from 'vitest';
import {
  attack,
  checkStateBased,
  drawCard,
  effAtk,
  endTurn,
  getCost,
  playCard,
  playGenerator,
} from '../src/core/game';
import { DECK_RAZZIA, DECK_REMPART, validateDeck } from '../src/core/decks';
import type { TargetRef } from '../src/core/types';
import { addModule, bare, give, put, stripShields } from './util';

const station = (player: 0 | 1): TargetRef => ({ kind: 'station', player });

describe('mise en place', () => {
  test('mains de départ, stations, joueur actif', () => {
    const g = bare();
    // J1 : 5 cartes de départ + la pige de son premier tour ; J2 : 6, pigera à son tour.
    expect(g.players[0].hand).toHaveLength(6);
    expect(g.players[1].hand).toHaveLength(6);
    expect(g.players[0].stationHp).toBe(20);
    expect(g.players[1].stationHp).toBe(20);
    expect(g.active).toBe(0);
    expect(g.turnCounter).toBe(1);
    expect(g.players[0].energy).toBe(0);
  });

  test('les decks de démarrage sont valides (40 cartes)', () => {
    expect(DECK_REMPART).toHaveLength(40);
    expect(DECK_RAZZIA).toHaveLength(40);
    expect(validateDeck(DECK_REMPART)).toHaveLength(0);
    expect(validateDeck(DECK_RAZZIA)).toHaveLength(0);
  });
});

describe('énergie et générateurs', () => {
  test('un seul générateur par tour, énergie immédiate', () => {
    const g = bare();
    playGenerator(g, 0);
    expect(g.players[0].energy).toBe(1);
    expect(g.players[0].generators).toHaveLength(1);
    expect(() => playGenerator(g, 0)).toThrow(/seul générateur/);
  });

  test("l'énergie se recharge au début du tour sans s'accumuler", () => {
    const g = bare();
    playGenerator(g, 0);
    endTurn(g);
    endTurn(g);
    expect(g.players[0].energy).toBe(1);
  });

  test('jouer une carte exige assez d\'énergie', () => {
    const g = bare();
    const i = give(g, 0, 'F10');
    expect(() => playCard(g, i)).toThrow(/insuffisante/);
    g.players[0].energy = 5;
    playCard(g, i);
    expect(g.players[0].energy).toBe(0);
    expect(g.players[0].fleet).toHaveLength(1);
  });
});

describe('attaques', () => {
  test('mal de saut : pas d\'attaque le tour d\'arrivée, sauf Frappe rapide', () => {
    const g = stripShields(bare());
    g.players[0].energy = 2;
    playCard(g, give(g, 0, 'F01'));
    const lent = g.players[0].fleet[0];
    expect(() => attack(g, lent.uid, station(1))).toThrow(/arriv/);
    playCard(g, give(g, 0, 'C01'));
    const rapide = g.players[0].fleet[1];
    attack(g, rapide.uid, station(1));
    expect(g.players[1].stationHp).toBe(18);
  });

  test('une seule attaque par vaisseau par tour', () => {
    const g = stripShields(bare());
    const s = put(g, 0, 'C10');
    attack(g, s.uid, station(1));
    expect(g.players[1].stationHp).toBe(16);
    expect(() => attack(g, s.uid, station(1))).toThrow(/déjà agi/);
  });

  test('combat de vaisseaux : riposte simultanée', () => {
    const g = bare();
    const a = put(g, 0, 'F10'); // 4/6
    const d = put(g, 1, 'C10'); // 4/3
    attack(g, a.uid, { kind: 'ship', player: 1, uid: d.uid });
    expect(g.players[1].fleet).toHaveLength(0);
    expect(g.players[1].discard).toContain('C10');
    expect(a.damage).toBe(4);
  });

  test('un vaisseau sans attaque ne peut pas attaquer', () => {
    const g = bare();
    const s = put(g, 0, 'N05');
    expect(() => attack(g, s.uid, station(1))).toThrow(/pas d'attaque/);
  });

  test('victoire quand la station tombe à 0', () => {
    const g = stripShields(bare());
    g.players[1].stationHp = 3;
    const a = put(g, 0, 'C10');
    attack(g, a.uid, station(1));
    expect(g.over).toBe(true);
    expect(g.winner).toBe(0);
    expect(() => endTurn(g)).toThrow(/terminée/);
  });
});

describe('mots-clés', () => {
  test('Escorte : les attaques doivent la cibler', () => {
    const g = bare();
    const a = put(g, 0, 'C10');
    const escorte = put(g, 1, 'N05');
    const autre = put(g, 1, 'C05');
    expect(() => attack(g, a.uid, station(1))).toThrow(/Escorte/);
    expect(() =>
      attack(g, a.uid, { kind: 'ship', player: 1, uid: autre.uid }),
    ).toThrow(/Escorte/);
    attack(g, a.uid, { kind: 'ship', player: 1, uid: escorte.uid });
    expect(g.players[1].fleet.find((s) => s.uid === escorte.uid)).toBeUndefined();
  });

  test('Furtif ignore Escorte et est révélé en attaquant', () => {
    const g = stripShields(bare());
    const skiff = put(g, 0, 'C02');
    put(g, 1, 'N05');
    attack(g, skiff.uid, station(1));
    expect(g.players[1].stationHp).toBe(19);
    expect(skiff.stealthBroken).toBe(true);
  });

  test('Furtif non révélé : ni attaquable ni ciblable par l\'adversaire', () => {
    const g = bare();
    const cache = put(g, 1, 'C16');
    const a = put(g, 0, 'C10');
    expect(() =>
      attack(g, a.uid, { kind: 'ship', player: 1, uid: cache.uid }),
    ).toThrow(/furtive/);
    g.players[0].energy = 4;
    const i = give(g, 0, 'N06');
    expect(() =>
      playCard(g, i, { targets: [{ kind: 'ship', player: 1, uid: cache.uid }] }),
    ).toThrow(/Cible invalide/);
    cache.stealthBroken = true;
    playCard(g, i, { targets: [{ kind: 'ship', player: 1, uid: cache.uid }] });
    expect(cache.damage).toBe(3);
  });

  test('Blindage réduit chaque source de dégâts', () => {
    const g = bare();
    const aegis = put(g, 0, 'F18'); // Blindage 1
    g.players[0].energy = 5;
    playCard(g, give(g, 0, 'N06'), {
      targets: [{ kind: 'ship', player: 0, uid: aegis.uid }],
    });
    expect(aegis.damage).toBe(2); // 3 - 1
    playCard(g, give(g, 0, 'N07')); // champ d'astéroïdes : 1 dégât
    expect(aegis.damage).toBe(2); // 1 - 1 = 0
  });

  test('Blindage de station (Bouclier déflecteur)', () => {
    const g = stripShields(bare());
    addModule(g, 1, 'F05');
    const a = put(g, 0, 'C10'); // 4 ATK
    attack(g, a.uid, station(1));
    expect(g.players[1].stationHp).toBe(17);
  });

  test('Vaisseau-bélier : impossible de finir le tour sans attaquer', () => {
    const g = bare();
    const b = put(g, 0, 'C18');
    expect(() => endTurn(g)).toThrow(/doit attaquer/);
    attack(g, b.uid, station(1));
    endTurn(g);
    expect(g.active).toBe(1);
  });
});

describe('limites', () => {
  test('flotte limitée à 7 vaisseaux, jetons en excès perdus', () => {
    const g = bare();
    for (let k = 0; k < 7; k++) put(g, 0, 'F01');
    g.players[0].energy = 9;
    const i = give(g, 0, 'F01');
    expect(() => playCard(g, i)).toThrow(/Flotte pleine/);
    g.players[0].fleet.pop();
    g.players[0].hand.splice(i, 1);
    playCard(g, give(g, 0, 'C13')); // 3 drones, 1 seul rentre
    expect(g.players[0].fleet).toHaveLength(7);
  });

  test('main limitée à 8 : la carte pigée en excès brûle', () => {
    const g = bare();
    while (g.players[0].hand.length < 8) give(g, 0, 'N01');
    drawCard(g, 0);
    expect(g.players[0].hand).toHaveLength(8);
    expect(g.players[0].discard).toHaveLength(1);
  });

  test('usure : piger d\'un deck vide blesse la station (cumulatif)', () => {
    const g = bare();
    g.players[0].deck = [];
    drawCard(g, 0);
    expect(g.players[0].stationHp).toBe(19);
    drawCard(g, 0);
    expect(g.players[0].stationHp).toBe(17);
  });
});

describe('réductions de coût', () => {
  test('Chantier orbital, Tally et Marché noir (minimum 1)', () => {
    const g = bare();
    addModule(g, 0, 'F16');
    expect(getCost(g, 0, 'F01')).toBe(1); // minimum 1
    expect(getCost(g, 0, 'F10')).toBe(4);
    addModule(g, 0, 'F16');
    expect(getCost(g, 0, 'F10')).toBe(3);
    put(g, 0, 'F19');
    expect(getCost(g, 0, 'F05')).toBe(1);
    addModule(g, 0, 'C20');
    expect(getCost(g, 0, 'C22')).toBe(5);
  });
});

describe('auras', () => {
  test('Aris Vega donne +0/+1 ; sa mort peut détruire les blessés', () => {
    const g = bare();
    const vega = put(g, 0, 'F17');
    const cadet = put(g, 0, 'F01'); // 2/1 → 2/2
    cadet.damage = 1;
    checkStateBased(g);
    expect(g.players[0].fleet).toHaveLength(2);
    vega.damage = 5;
    checkStateBased(g);
    expect(g.players[0].fleet).toHaveLength(0);
  });

  test('Mordok donne +1/+0 aux autres Chasseurs seulement', () => {
    const g = bare();
    put(g, 0, 'C15');
    const chasseur = put(g, 0, 'C02');
    const croiseur = put(g, 0, 'C10');
    expect(effAtk(g, chasseur)).toBe(2);
    expect(effAtk(g, croiseur)).toBe(4);
  });
});
