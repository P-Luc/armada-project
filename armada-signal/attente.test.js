/* Tests de la salle d'attente — `bun test`
   Tout se joue en mémoire : pas de port ouvert, pas d'attente, pas de flottement.
   Le hasard est injecté, donc les graines et les codes sont reproductibles. */
import { test, expect, describe } from 'bun:test';
import { creerSalleDAttente, normaliserCode, normaliserPseudo, AUTRE_CAMP } from './attente.js';

// hasard déterministe (mulberry32), comme le flux semé du jeu
function semeur(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const salleTest = () => creerSalleDAttente({ hasard: semeur(42), maintenant: () => 1000 });

/** Aplatit les envois en messages par destinataire, pour des assertions lisibles. */
function pour(envois, id) {
  return envois.filter((e) => e.pour.includes(id)).map((e) => e.msg);
}
const premier = (envois, id, type) => pour(envois, id).find((m) => m.t === type);

describe('normalisation', () => {
  test('le code se dicte à voix haute', () => {
    expect(normaliserCode(' ab-cd12 ')).toBe('ABCD12');
    expect(normaliserCode('abc')).toBe(null);      // trop court
    expect(normaliserCode('')).toBe(null);
    expect(normaliserCode('ABCDEFGHIJ')).toBe('ABCDEF'); // tronqué à 6
  });
  test('le pseudo ne peut être ni vide ni un pavé', () => {
    expect(normaliserPseudo('  ')).toBe('Anonyme');
    expect(normaliserPseudo(null)).toBe('Anonyme');
    expect(normaliserPseudo('a\n\nb')).toBe('a b');
    expect(normaliserPseudo('x'.repeat(100)).length).toBe(24);
  });
});

describe('file publique', () => {
  test('le premier attend, le second déclenche la partie', () => {
    const s = salleTest();
    s.connecter('A', { pseudo: 'Alice' });
    s.connecter('B', { pseudo: 'Bob' });

    const e1 = s.chercher('A', {});
    expect(premier(e1, 'A', 'attente').position).toBe(1);

    const e2 = s.chercher('B', {});
    const a = premier(e2, 'A', 'apparie');
    const b = premier(e2, 'B', 'apparie');
    expect(a.partie).toBe(b.partie);
    expect(a.graine).toBe(b.graine);       // même monde des deux côtés
    expect(a.faction).toBe(AUTRE_CAMP(b.faction)); // jamais le même camp
    expect(a.role).toBe('hote');
    expect(b.role).toBe('invite');
    expect(a.adversaire.pseudo).toBe('Bob');
    expect(s._file()).toEqual([]);
  });

  test('le premier arrivé garde son camp, le second prend l\'autre', () => {
    const s = salleTest();
    s.connecter('A'); s.connecter('B');
    s.chercher('A', { faction: 'collective' });
    const e = s.chercher('B', { faction: 'collective' }); // même souhait : pas de famine
    expect(premier(e, 'A', 'apparie').faction).toBe('collective');
    expect(premier(e, 'B', 'apparie').faction).toBe('arche');
  });

  test('le souhait du second sert quand le premier n\'en a pas', () => {
    const s = salleTest();
    s.connecter('A'); s.connecter('B');
    s.chercher('A', {});
    const e = s.chercher('B', { faction: 'collective' });
    expect(premier(e, 'B', 'apparie').faction).toBe('collective');
    expect(premier(e, 'A', 'apparie').faction).toBe('arche');
  });

  test('deux protocoles différents ne s\'apparient pas', () => {
    const s = salleTest();
    s.connecter('A', { version: 1 });
    s.connecter('B', { version: 2 });
    s.chercher('A', {});
    const e = s.chercher('B', {});
    expect(premier(e, 'A', 'apparie')).toBeUndefined();
    expect(s._file()).toEqual(['A', 'B']);
  });

  test('chercher deux fois ne duplique pas la place dans la file', () => {
    const s = salleTest();
    s.connecter('A');
    s.chercher('A', {});
    const e = s.chercher('A', { faction: 'arche' });
    expect(s._file()).toEqual(['A']);
    expect(premier(e, 'A', 'attente').position).toBe(1);
  });

  test('la file avance : chacun voit son rang bouger', () => {
    const s = salleTest();
    for (const id of ['A', 'B', 'C']) { s.connecter(id); s.chercher(id, {}); }
    // A et B se sont appariés, C est seul et remonte en tête
    const e = s.chercher('C', {});
    expect(premier(e, 'C', 'attente').position).toBe(1);

    s.connecter('D');
    s.chercher('D', {});
    const apres = s.annuler('C'); // rien à rafraîchir : la file est vide
    expect(s._file()).toEqual([]);
    expect(apres.length).toBeGreaterThanOrEqual(0);
  });

  test('annuler rend le joueur inactif', () => {
    const s = salleTest();
    s.connecter('A');
    s.chercher('A', {});
    const e = s.annuler('A');
    expect(premier(e, 'A', 'annule')).toBeDefined();
    expect(s._joueur('A').etat).toBe('inactif');
    expect(s._file()).toEqual([]);
  });

  test('un `bonjour` tardif ne fait pas perdre sa place', () => {
    const s = salleTest();
    s.connecter('A');
    s.chercher('A', {});
    s.connecter('A', { pseudo: 'Alice' }); // second bonjour
    expect(s._file()).toEqual(['A']);
    expect(s._joueur('A').etat).toBe('attente');
    expect(s._joueur('A').pseudo).toBe('Alice');
  });
});

describe('salon privé', () => {
  test('un code est tiré, l\'ami le rejoint, la partie se forme', () => {
    const s = salleTest();
    s.connecter('A', { pseudo: 'Alice' });
    s.connecter('B', { pseudo: 'Bob' });
    const e = s.rejoindrePrivee('A', null);
    const code = premier(e, 'A', 'salon').code;
    expect(code).toMatch(/^[A-Z2-9]{6}$/);

    const e2 = s.rejoindrePrivee('B', code.toLowerCase()); // la casse n'a pas à compter
    const a = premier(e2, 'A', 'apparie');
    expect(a).toBeDefined();
    expect(a.code).toBe(code);
    expect(premier(e2, 'B', 'apparie').partie).toBe(a.partie);
  });

  test('un code inconnu est refusé, pas inventé', () => {
    const s = salleTest();
    s.connecter('A');
    expect(premier(s.rejoindrePrivee('A', 'ZZZZZZ'), 'A', 'refus')).toBeDefined();
    expect(premier(s.rejoindrePrivee('A', 'xx'), 'A', 'refus').motif).toMatch(/invalide/);
  });

  test('le salon ne prend pas un troisième joueur', () => {
    const s = salleTest();
    for (const id of ['A', 'B', 'C']) s.connecter(id);
    const code = premier(s.rejoindrePrivee('A', null), 'A', 'salon').code;
    s.rejoindrePrivee('B', code);
    expect(premier(s.rejoindrePrivee('C', code), 'C', 'refus').motif).toMatch(/Aucun salon|complet/);
  });

  test('l\'hôte qui s\'en va libère le code', () => {
    const s = salleTest();
    s.connecter('A'); s.connecter('B');
    const code = premier(s.rejoindrePrivee('A', null), 'A', 'salon').code;
    s.deconnecter('A');
    expect(premier(s.rejoindrePrivee('B', code), 'B', 'refus')).toBeDefined();
  });
});

describe('mise en relation', () => {
  const appariee = () => {
    const s = salleTest();
    s.connecter('A', { pseudo: 'Alice' });
    s.connecter('B', { pseudo: 'Bob' });
    s.chercher('A', {});
    s.chercher('B', {});
    return s;
  };

  test('le signal va à l\'adversaire, jamais à son auteur', () => {
    const s = appariee();
    const e = s.signaler('A', { sdp: 'offre' });
    expect(pour(e, 'A')).toEqual([]);
    expect(premier(e, 'B', 'signal').data).toEqual({ sdp: 'offre' });
    expect(premier(e, 'B', 'signal').de).toBe('A');
  });

  test('signaler hors partie est refusé', () => {
    const s = salleTest();
    s.connecter('A');
    expect(premier(s.signaler('A', 'x'), 'A', 'refus')).toBeDefined();
  });

  test('un signal démesuré est refusé', () => {
    const s = appariee();
    const e = s.signaler('A', 'x'.repeat(20000));
    expect(premier(e, 'A', 'refus').motif).toMatch(/volumineux/);
  });

  test('deux « prêt » lancent la partie, un seul prévient l\'autre', () => {
    const s = appariee();
    const e1 = s.pret('A');
    expect(premier(e1, 'B', 'adversaire-pret')).toBeDefined();
    expect(premier(e1, 'A', 'lancer')).toBeUndefined();

    const e2 = s.pret('B');
    const l = premier(e2, 'A', 'lancer');
    expect(l).toBeDefined();
    expect(premier(e2, 'B', 'lancer').graine).toBe(l.graine);
    expect(Object.keys(l.camps).sort()).toEqual(['A', 'B']);

    expect(s.pret('A')).toEqual([]); // une partie lancée ne se relance pas
  });
});

describe('départs', () => {
  test('la déconnexion prévient l\'adversaire et dissout la partie', () => {
    const s = salleTest();
    s.connecter('A'); s.connecter('B');
    s.chercher('A', {}); s.chercher('B', {});
    const pid = s._joueur('A').partie;

    const e = s.deconnecter('A');
    expect(premier(e, 'B', 'adversaire-parti').motif).toBe('deconnexion');
    expect(s._partie(pid)).toBeUndefined();
    expect(s._joueur('B').etat).toBe('inactif');
    expect(s._joueur('B').partie).toBe(null);
  });

  test('l\'adversaire libéré peut chercher une autre partie', () => {
    const s = salleTest();
    for (const id of ['A', 'B', 'C']) s.connecter(id);
    s.chercher('A', {}); s.chercher('B', {});
    s.deconnecter('A');
    s.chercher('B', {});
    s.chercher('C', {});
    expect(s._joueur('B').etat).toBe('partie');
    expect(s._joueur('C').partie).toBe(s._joueur('B').partie);
  });

  test('quitter en cours de partie renvoie les deux au calme', () => {
    const s = salleTest();
    s.connecter('A'); s.connecter('B');
    s.chercher('A', {}); s.chercher('B', {});
    s.quitterPartie('A', 'depart');
    expect(s._joueur('A').etat).toBe('inactif');
    expect(s._joueur('B').etat).toBe('inactif');
    expect(s.etat().parties).toBe(0);
  });

  test('déconnecter un inconnu ne casse rien', () => {
    const s = salleTest();
    expect(s.deconnecter('fantome')).toEqual([]);
    expect(s.chercher('fantome', {})).toEqual([]);
    expect(s.pret('fantome')).toEqual([]);
  });

  test('chercher pendant une partie est refusé', () => {
    const s = salleTest();
    s.connecter('A'); s.connecter('B');
    s.chercher('A', {}); s.chercher('B', {});
    expect(premier(s.chercher('A', {}), 'A', 'refus')).toBeDefined();
  });
});

describe('passages d\'un mode à l\'autre', () => {
  test('quitter son salon privé pour la file publique rend le code', () => {
    const s = salleTest();
    s.connecter('A'); s.connecter('B');
    const code = premier(s.rejoindrePrivee('A', null), 'A', 'salon').code;

    const e = s.chercher('A', {}); // A change d'avis et cherche n'importe qui
    expect(premier(e, 'A', 'attente').position).toBe(1);
    expect(s._file()).toEqual(['A']);
    expect(s._joueur('A').partie).toBe(null);
    expect(s.etat().parties).toBe(0);
    expect(premier(s.rejoindrePrivee('B', code), 'B', 'refus')).toBeDefined(); // code rendu
  });

  test('annuler depuis un salon privé ferme le salon', () => {
    const s = salleTest();
    s.connecter('A'); s.connecter('B');
    const code = premier(s.rejoindrePrivee('A', null), 'A', 'salon').code;
    s.annuler('A');
    expect(s._joueur('A').etat).toBe('inactif');
    expect(s.etat().parties).toBe(0);
    expect(premier(s.rejoindrePrivee('B', code), 'B', 'refus')).toBeDefined();
  });

  test('ouvrir un second salon privé libère le premier', () => {
    const s = salleTest();
    s.connecter('A'); s.connecter('B');
    const code1 = premier(s.rejoindrePrivee('A', null), 'A', 'salon').code;
    const code2 = premier(s.rejoindrePrivee('A', null), 'A', 'salon').code;
    expect(code2).not.toBe(code1);
    expect(s.etat().parties).toBe(1);
    expect(premier(s.rejoindrePrivee('B', code1), 'B', 'refus')).toBeDefined();
    expect(premier(s.rejoindrePrivee('B', code2), 'B', 'apparie')).toBeDefined();
  });

  test('passer de la file publique au salon privé vide la file', () => {
    const s = salleTest();
    s.connecter('A');
    s.chercher('A', {});
    s.rejoindrePrivee('A', null);
    expect(s._file()).toEqual([]);
  });
});
