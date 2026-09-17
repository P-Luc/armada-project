import { describe, expect, test } from 'vitest';
import {
  attack,
  checkStateBased,
  decide,
  endTurn,
  playCard,
  playGenerator,
} from '../src/core/game';
import type { TargetRef } from '../src/core/types';
import { addModule, bare, give, put, stripShields } from './util';

const station = (player: 0 | 1): TargetRef => ({ kind: 'station', player });
const ship = (player: 0 | 1, uid: number): TargetRef => ({ kind: 'ship', player, uid });

describe('cartes neutres', () => {
  test('N02 Fusion instable : 2 énergies, 1 dégât à sa propre station', () => {
    const g = bare();
    playGenerator(g, give(g, 0, 'N02'));
    expect(g.players[0].energy).toBe(2);
    expect(g.players[0].stationHp).toBe(19);
  });

  test('N03 Drone d\'observation : décision scry, actions bloquées en attendant', () => {
    const g = bare();
    g.players[0].deck = ['F10', 'F01'];
    g.players[0].energy = 1;
    playCard(g, give(g, 0, 'N03'));
    expect(g.pendingDecision?.kind).toBe('scry1');
    expect(g.pendingDecision?.cardId).toBe('F10');
    expect(() => endTurn(g)).toThrow(/décision/);
    decide(g, { bottom: true });
    expect(g.players[0].deck).toEqual(['F01', 'F10']);
    expect(g.pendingDecision).toBeUndefined();
  });

  test('N04 Navette : rembourse 1 énergie', () => {
    const g = bare();
    g.players[0].energy = 3;
    playCard(g, give(g, 0, 'N04'));
    expect(g.players[0].energy).toBe(2);
  });

  test('N08 Baie de réparation : +1 PV au début du tour', () => {
    const g = bare();
    addModule(g, 0, 'N08');
    g.players[0].stationHp = 15;
    endTurn(g);
    endTurn(g);
    expect(g.players[0].stationHp).toBe(16);
  });
});

describe('Fédération Solaire', () => {
  test('F04 Technicien de coque : soigne la station ciblée', () => {
    const g = bare();
    g.players[0].stationHp = 15;
    g.players[0].energy = 2;
    playCard(g, give(g, 0, 'F04'), { targets: [station(0)] });
    expect(g.players[0].stationHp).toBe(17);
  });

  test('F08 Vaisseau-hôpital : soigne la flotte au début du tour', () => {
    const g = bare();
    put(g, 0, 'F08');
    const blesse = put(g, 0, 'F10');
    blesse.damage = 3;
    endTurn(g);
    endTurn(g);
    expect(blesse.damage).toBe(2);
  });

  test('F09 Mobilisation : 2 jetons qui ne vont jamais en défausse', () => {
    const g = bare();
    g.players[0].energy = 4;
    const discardAvant = g.players[0].discard.length;
    playCard(g, give(g, 0, 'F09'));
    expect(g.players[0].fleet).toHaveLength(2);
    g.players[0].fleet[0].damage = 9;
    checkStateBased(g);
    expect(g.players[0].fleet).toHaveLength(1);
    expect(g.players[0].discard.filter((c) => c === 'TK1')).toHaveLength(0);
    expect(g.players[0].discard.length).toBe(discardAvant + 1); // F09 seulement
  });

  test('F11 Rappel stratégique : renvoie en main, les jetons disparaissent', () => {
    const g = bare();
    const cible = put(g, 1, 'C10');
    g.players[0].energy = 4;
    const mainAvant = g.players[1].hand.length;
    playCard(g, give(g, 0, 'F11'), { targets: [ship(1, cible.uid)] });
    expect(g.players[1].fleet).toHaveLength(0);
    expect(g.players[1].hand.length).toBe(mainAvant + 1);
    const jeton = put(g, 1, 'TK1');
    playCard(g, give(g, 0, 'F11'), { targets: [ship(1, jeton.uid)] });
    expect(g.players[1].fleet).toHaveLength(0);
    expect(g.players[1].hand.length).toBe(mainAvant + 1);
  });

  test('F13 Tourelle automatisée : 1 dégât à l\'attaquant de la station', () => {
    const g = stripShields(bare());
    addModule(g, 1, 'F13');
    put(g, 0, 'C01'); // 2/1
    attack(g, g.players[0].fleet[0].uid, station(1));
    expect(g.players[1].stationHp).toBe(18);
    expect(g.players[0].fleet).toHaveLength(0); // détruit par la tourelle
  });

  test('F14 Mur de déflexion : protège pendant le tour adverse puis expire', () => {
    const g = stripShields(bare());
    g.players[0].energy = 3;
    playCard(g, give(g, 0, 'F14'));
    const e = put(g, 1, 'C10');
    endTurn(g);
    attack(g, e.uid, station(0));
    expect(g.players[0].stationHp).toBe(20);
    endTurn(g);
    endTurn(g);
    attack(g, e.uid, station(0));
    expect(g.players[0].stationHp).toBe(16);
  });

  test('F15 Plateforme de réarmement : +1 énergie au début du tour', () => {
    const g = bare();
    g.players[0].generators = ['N01', 'N01'];
    addModule(g, 0, 'F15');
    endTurn(g);
    endTurn(g);
    expect(g.players[0].energy).toBe(3);
  });

  test('F20 Protocole : +5 PV plafonnés et pioche', () => {
    const g = bare();
    g.players[0].stationHp = 18;
    g.players[0].energy = 5;
    const deckAvant = g.players[0].deck.length;
    playCard(g, give(g, 0, 'F20'));
    expect(g.players[0].stationHp).toBe(20);
    expect(g.players[0].deck.length).toBe(deckAvant - 1);
  });

  test('F21 Frappe orbitale : 2 dégâts aux vaisseaux ennemis seulement', () => {
    const g = bare();
    const allie = put(g, 0, 'F10');
    const e1 = put(g, 1, 'C16'); // 3/3
    const e2 = put(g, 1, 'C05'); // 3/1 → détruit
    g.players[0].energy = 6;
    playCard(g, give(g, 0, 'F21'));
    expect(allie.damage).toBe(0);
    expect(e1.damage).toBe(2);
    expect(g.players[1].fleet.find((s) => s.uid === e2.uid)).toBeUndefined();
  });

  test('F24 Cœur de la Fédération : station à 30/30', () => {
    const g = bare();
    g.players[0].energy = 6;
    playCard(g, give(g, 0, 'F24'));
    expect(g.players[0].stationHp).toBe(30);
    expect(g.players[0].stationMaxHp).toBe(30);
  });
});

describe('Clans de la Ceinture', () => {
  test('C03 Mine spatiale : 2 dégâts au destructeur', () => {
    const g = bare();
    const mine = put(g, 1, 'C03');
    const a = put(g, 0, 'C10');
    attack(g, a.uid, ship(1, mine.uid));
    expect(g.players[1].fleet).toHaveLength(0);
    expect(a.damage).toBe(2);
  });

  test('C04 Sabotage : détruit un module', () => {
    const g = bare();
    const uid = addModule(g, 1, 'F05');
    g.players[0].energy = 2;
    playCard(g, give(g, 0, 'C04'), {
      targets: [{ kind: 'module', player: 1, uid }],
    });
    expect(g.players[1].modules).toHaveLength(0);
    expect(g.players[1].discard).toContain('F05');
  });

  test('C06 Récupérateur : pioche seulement si un vaisseau est mort ce tour', () => {
    const g = bare();
    g.players[0].energy = 4;
    const deckAvant = g.players[0].deck.length;
    playCard(g, give(g, 0, 'C06'));
    expect(g.players[0].deck.length).toBe(deckAvant);
    const e = put(g, 1, 'C05');
    e.damage = 9;
    checkStateBased(g);
    playCard(g, give(g, 0, 'C06'));
    expect(g.players[0].deck.length).toBe(deckAvant - 1);
  });

  test('C07 Abordeur : 1 dégât à la station ennemie à l\'arrivée', () => {
    const g = stripShields(bare());
    g.players[0].energy = 3;
    playCard(g, give(g, 0, 'C07'));
    expect(g.players[1].stationHp).toBe(19);
  });

  test('C09 Raid éclair : +1 ATK jusqu\'à la fin du tour', () => {
    const g = bare();
    const s = put(g, 0, 'F01');
    g.players[0].energy = 3;
    playCard(g, give(g, 0, 'C09'));
    expect(s.tempAtk).toBe(1);
    endTurn(g);
    expect(s.tempAtk).toBe(0);
  });

  test('C11 Extorsion : 2 dégâts à la station et pioche', () => {
    const g = stripShields(bare());
    g.players[0].energy = 2;
    const deckAvant = g.players[0].deck.length;
    playCard(g, give(g, 0, 'C11'));
    expect(g.players[1].stationHp).toBe(18);
    expect(g.players[0].deck.length).toBe(deckAvant - 1);
  });

  test('C12 Brouilleur : le vaisseau ne peut pas attaquer au tour suivant', () => {
    const g = stripShields(bare());
    const e = put(g, 1, 'C10');
    g.players[0].energy = 2;
    playCard(g, give(g, 0, 'C12'), { targets: [ship(1, e.uid)] });
    endTurn(g);
    expect(() => attack(g, e.uid, station(0))).toThrow(/brouillé/);
    endTurn(g);
    endTurn(g);
    attack(g, e.uid, station(0));
    expect(g.players[0].stationHp).toBe(16);
  });

  test('C14 Baie de lancement : un drone au début du tour', () => {
    const g = bare();
    addModule(g, 0, 'C14');
    endTurn(g);
    endTurn(g);
    expect(g.players[0].fleet.filter((s) => s.defId === 'TK2')).toHaveLength(1);
  });

  test('C17 Torpilles incendiaires : carte modale', () => {
    const g = stripShields(bare());
    g.players[0].energy = 8;
    expect(() => playCard(g, give(g, 0, 'C17'))).toThrow(/mode/);
    const e = put(g, 1, 'C10'); // 4/3
    playCard(g, give(g, 0, 'C17'), { mode: 0, targets: [ship(1, e.uid)] });
    expect(g.players[1].fleet).toHaveLength(0);
    playCard(g, give(g, 0, 'C17'), { mode: 1 });
    expect(g.players[1].stationHp).toBe(18);
  });

  test('C19 Nyx : détruit un module au choix après avoir touché la station', () => {
    const g = stripShields(bare());
    const nyx = put(g, 0, 'C19');
    const uid = addModule(g, 1, 'N08');
    attack(g, nyx.uid, station(1));
    expect(g.players[1].stationHp).toBe(18);
    expect(g.pendingDecision?.kind).toBe('destroyModule');
    decide(g, { uid });
    expect(g.players[1].modules).toHaveLength(0);
  });

  test('C21 Flotte fantôme : ignore Escorte jusqu\'à la fin du tour', () => {
    const g = stripShields(bare());
    put(g, 1, 'N05'); // Escorte
    const s = put(g, 0, 'C10');
    g.players[0].energy = 6;
    playCard(g, give(g, 0, 'C21'));
    attack(g, s.uid, station(1));
    expect(g.players[1].stationHp).toBe(16);
  });

  test('C22 Bombardement : 5 dégâts directs', () => {
    const g = stripShields(bare());
    g.players[0].energy = 6;
    playCard(g, give(g, 0, 'C22'));
    expect(g.players[1].stationHp).toBe(15);
  });

  test('C24 Vessa : l\'adversaire défausse une carte au hasard', () => {
    const g = stripShields(bare());
    const vessa = put(g, 0, 'C24');
    const mainAvant = g.players[1].hand.length;
    attack(g, vessa.uid, station(1));
    expect(g.players[1].stationHp).toBe(14);
    expect(g.players[1].hand.length).toBe(mainAvant - 1);
    expect(g.players[1].discard).toHaveLength(1);
  });

  test('C25 Léviathan : 2 dégâts à tous les autres vaisseaux', () => {
    const g = bare();
    const allie = put(g, 0, 'F10');
    const e = put(g, 1, 'C05'); // 3/1 → détruit
    g.players[0].energy = 8;
    playCard(g, give(g, 0, 'C25'));
    const levi = g.players[0].fleet.find((s) => s.defId === 'C25')!;
    expect(levi.damage).toBe(0);
    expect(allie.damage).toBe(2);
    expect(g.players[1].fleet.find((s) => s.uid === e.uid)).toBeUndefined();
  });
});
