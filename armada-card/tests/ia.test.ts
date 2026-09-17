import { describe, expect, test } from 'vitest';
import { aiStep, aiTakeTurn } from '../src/core/ai';
import { newGame } from '../src/core/game';
import { DECK_RAZZIA, DECK_REMPART } from '../src/core/decks';
import { bare, put, stripShields } from './util';

describe('IA', () => {
  test("pose un générateur puis termine son tour", () => {
    const g = bare();
    aiStep(g);
    expect(g.players[0].generators).toHaveLength(1);
    aiTakeTurn(g);
    expect(g.active).toBe(1);
  });

  test('prend les attaques létales sur la station', () => {
    const g = stripShields(bare());
    g.players[1].stationHp = 3;
    put(g, 0, 'C10'); // 4/3, prêt à attaquer
    aiTakeTurn(g);
    expect(g.over).toBe(true);
    expect(g.winner).toBe(0);
  });

  test('évite les échanges perdants', () => {
    const g = bare();
    put(g, 0, 'F01'); // 2/1
    put(g, 1, 'F23'); // Citadelle 4/10, Escorte, Blindage 1 : suicide sans gain
    aiTakeTurn(g);
    // Le cadet ne s'est pas sacrifié inutilement contre la citadelle.
    expect(g.players[0].fleet).toHaveLength(1);
  });

  test('une partie IA contre IA se termine', () => {
    const g = newGame(DECK_REMPART, DECK_RAZZIA, 7);
    let steps = 6000;
    while (!g.over && steps-- > 0 && g.turnCounter < 120) aiStep(g);
    expect(g.over).toBe(true);
  });
});
