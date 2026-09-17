import { describe, expect, test } from 'vitest';
import {
  applyAction,
  assertActor,
  legalAction,
  redactView,
} from '../src/core/actions';
import { bare, give, put, stripShields } from './util';

describe('actions sérialisables', () => {
  test('chaque type d\'action passe par le moteur', () => {
    const g = stripShields(bare());
    const gi = g.players[0].hand.findIndex((id) => id === 'N01');
    applyAction(g, { type: 'generator', handIndex: gi });
    expect(g.players[0].generators).toHaveLength(1);
    g.players[0].energy = 5;
    const ci = give(g, 0, 'F10');
    applyAction(g, { type: 'play', handIndex: ci });
    expect(g.players[0].fleet).toHaveLength(1);
    const ship = put(g, 0, 'C10');
    applyAction(g, { type: 'attack', uid: ship.uid, target: { kind: 'station', player: 1 } });
    expect(g.players[1].stationHp).toBe(16);
    const gardien = put(g, 0, 'F03');
    applyAction(g, { type: 'guard', uid: gardien.uid });
    expect(gardien.guarding).toBe(true);
    applyAction(g, { type: 'endTurn' });
    expect(g.active).toBe(1);
  });

  test('legalAction ne modifie jamais l\'état', () => {
    const g = bare();
    const avant = JSON.stringify(g);
    expect(legalAction(g, { type: 'endTurn' })).toBe(true);
    expect(legalAction(g, { type: 'attack', uid: 999, target: { kind: 'station', player: 1 } })).toBe(false);
    expect(JSON.stringify(g)).toBe(avant);
  });

  test('assertActor refuse les actions hors tour', () => {
    const g = bare();
    expect(() => assertActor(g, 1, { type: 'endTurn' })).toThrow(/votre tour/);
    expect(() => assertActor(g, 0, { type: 'endTurn' })).not.toThrow();
    expect(() => assertActor(g, 0, { type: 'decide', bottom: true })).toThrow(/décider/);
  });
});

describe('vues expurgées (anti-triche)', () => {
  test('cache la main et le deck adverses, préserve les compteurs', () => {
    const g = bare(7);
    const vue = redactView(g, 0);
    expect(vue.players[0].hand).toEqual(g.players[0].hand); // sa propre main
    expect(vue.players[1].hand.every((id) => id === 'XX')).toBe(true);
    expect(vue.players[1].hand).toHaveLength(g.players[1].hand.length);
    expect(vue.players[0].deck.every((id) => id === 'XX')).toBe(true); // son propre deck aussi
    expect(vue.rng.seed).toBe(0);
    expect(g.players[1].hand.every((id) => id === 'XX')).toBe(false); // l'original est intact
  });

  test('cache la carte du scry à l\'adversaire', () => {
    const g = bare();
    g.pendingDecision = { kind: 'scry1', player: 0, cardId: 'F10' };
    expect(redactView(g, 0).pendingDecision?.cardId).toBe('F10');
    expect(redactView(g, 1).pendingDecision?.cardId).toBeUndefined();
  });

  test('la vue expurgée reste utilisable pour les tests de légalité', () => {
    const g = bare();
    g.players[0].energy = 2;
    const i = give(g, 0, 'C11'); // Extorsion pioche : le deck caché ne doit pas gêner
    const vue = redactView(g, 0);
    expect(legalAction(vue, { type: 'play', handIndex: i })).toBe(true);
  });
});
