/* Serveur de dev + relais de coop — `bun serve.js`
 *
 * Pourquoi ce fichier : `bun index.html` ne sert QUE ce que le bundler voit
 * (index.html, style.css, game.js). Les SVG sont chargés à l'exécution par
 * une URL construite (`assets/svg/${id}.svg`), donc invisibles du bundler :
 * le serveur répondait index.html à leur place (200, mais du HTML), l'Image
 * passait en état « broken » et drawImage tuait la boucle de rendu.
 *
 * Ici, /assets/* est servi depuis le disque ; le reste garde le bundling et
 * le hot reload. `open index.html` (file://) continue de marcher sans rien.
 *
 * RELAIS DE COOP (v16.1) — /coop, WebSocket natif de Bun, donc toujours zéro
 * dépendance. Le serveur ne simule RIEN : il tient l'HORLOGE et recopie les
 * commandes. Il émet un paquet `tick` toutes les 33 ms portant les commandes
 * reçues depuis le précédent ; les deux clients simulent exactement les mêmes
 * ticks dans le même ordre, ce qui suffit à garder les deux mondes identiques
 * (lockstep). Une horloge côté serveur évite d'élire un client comme maître et
 * de traiter sa déconnexion comme un cas particulier.
 */
import index from './index.html';

const TICK_MS = 1000 / 30;
const salons = new Map(); // code → salon

function nouveauSalon(code) {
  const salon = {
    code,
    membres: new Set(),
    graine: (Math.random() * 0x7ffffffe) | 1,
    faction: 'arche',
    demarre: false,
    tick: 0,
    enAttente: [], // commandes reçues depuis le dernier paquet
    horloge: null,
    sommes: new Map(), // tick → première somme reçue, pour repérer une divergence
  };
  salons.set(code, salon);
  return salon;
}

const diffuser = (salon, msg) => {
  const txt = JSON.stringify(msg);
  for (const ws of salon.membres) ws.send(txt);
};

function demarrer(salon) {
  if (salon.demarre) return;
  salon.demarre = true;
  salon.tick = 0;
  diffuser(salon, { t: 'demarrage', graine: salon.graine, faction: salon.faction });
  salon.horloge = setInterval(() => {
    const cmds = salon.enAttente;
    salon.enAttente = [];
    salon.tick++;
    diffuser(salon, { t: 'tick', n: salon.tick, cmds });
  }, TICK_MS);
}

function fermer(salon) {
  if (salon.horloge) clearInterval(salon.horloge);
  salon.horloge = null;
  salons.delete(salon.code);
}

Bun.serve({
  port: 3000,
  development: true,
  routes: {
    '/': index,
    '/assets/*': req => {
      const chemin = decodeURIComponent(new URL(req.url).pathname);
      // Pas de remontée hors du projet, même sur un serveur local.
      if (chemin.includes('..')) {
        return new Response('Chemin refusé', { status: 403 });
      }
      return new Response(Bun.file(`.${chemin}`));
    },
  },
  fetch(req, server) {
    if (new URL(req.url).pathname === '/coop' && server.upgrade(req)) return;
    return new Response('Introuvable', { status: 404 });
  },
  websocket: {
    message(ws, brut) {
      let m;
      try { m = JSON.parse(brut); } catch { return; }
      const salon = ws.data && ws.data.salon;

      if (m.t === 'rejoindre') {
        const code = String(m.code || '').toUpperCase().slice(0, 6) || 'COOP';
        const s = salons.get(code) || nouveauSalon(code);
        if (s.demarre) { ws.send(JSON.stringify({ t: 'refus', motif: 'Partie déjà lancée.' })); return; }
        if (s.membres.size >= 2) { ws.send(JSON.stringify({ t: 'refus', motif: 'Salon complet (2 joueurs).' })); return; }
        if (s.membres.size === 0 && m.faction) s.faction = m.faction; // le premier arrivé choisit le camp
        ws.data = { salon: s };
        s.membres.add(ws);
        diffuser(s, { t: 'salon', code, joueurs: s.membres.size, faction: s.faction });
        if (s.membres.size === 2) demarrer(s); // à deux, la partie part
        return;
      }
      if (!salon) return;
      if (m.t === 'cmd') { salon.enAttente.push(m.cmd); return; }
      if (m.t === 'somme') {
        // Contrôle de synchronisation : la première somme reçue pour un tick fait
        // foi ; la seconde qui diffère signale que les mondes ont divergé.
        const attendue = salon.sommes.get(m.n);
        if (attendue === undefined) {
          salon.sommes.set(m.n, m.h);
          if (salon.sommes.size > 40) salon.sommes.delete(salon.sommes.keys().next().value);
        } else if (attendue !== m.h) {
          diffuser(salon, { t: 'desync', n: m.n });
        }
      }
    },
    close(ws) {
      const salon = ws.data && ws.data.salon;
      if (!salon) return;
      salon.membres.delete(ws);
      diffuser(salon, { t: 'salon', code: salon.code, joueurs: salon.membres.size, faction: salon.faction });
      if (salon.membres.size === 0) fermer(salon);
    },
  },
});

console.log('Éveil Machine — http://localhost:3000  ·  relais de coop sur ws://localhost:3000/coop');
