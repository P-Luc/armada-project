/* Serveur de signalement d'Éveil Machine — `bun serveur.js`
 *
 * Ce qu'il fait : trouver un adversaire et mettre les deux joueurs en relation.
 * Ce qu'il ne fait pas : simuler quoi que ce soit, ni relayer la partie. Une
 * fois les deux pairs appariés, ils s'établissent un lien (le champ `signal`
 * transporte leurs offres telles quelles, sans les lire) ou rejoignent le relais
 * lockstep de `armada-rts/serve.js` avec la graine reçue ici. La frontière est
 * nette exprès : le signalement voit passer quelques messages par partie, le
 * relais en voit trente par seconde — les faire vivre dans le même processus
 * mêlerait deux régimes de charge et deux raisons de redémarrer.
 *
 * Zéro dépendance, comme le reste du projet : WebSocket natif de Bun.
 *
 *   PORT=3001 bun serveur.js
 */
import { creerSalleDAttente, VERSION_PROTOCOLE } from './attente.js';

const PORT = Number(process.env.PORT) || 3001;
// 3000 est déjà pris par le serveur de dev du jeu : les deux tournent ensemble.
const MSG_MAX = 32 * 1024;
const MSG_PAR_SECONDE = 30; // large pour un échange ICE, étroit pour une boucle folle
const INACTIF_S = 60;       // Bun ferme tout seul au-delà ; le client tient la barre avec `ping`

const salle = creerSalleDAttente();
const sockets = new Map(); // id → ws
let seq = 0;
const demarre = Date.now();

/** Traduit les envois rendus par la salle d'attente en messages réseau. */
function expedier(envois) {
  for (const { pour, msg } of envois) {
    const txt = JSON.stringify(msg);
    for (const id of pour) {
      const ws = sockets.get(id);
      if (ws && ws.readyState === 1) ws.send(txt);
    }
  }
}

const enTetes = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json; charset=utf-8' };
const json = (o, status = 200) => new Response(JSON.stringify(o, null, 2), { status, headers: enTetes });

const serveur = Bun.serve({
  port: PORT,
  maxRequestBodySize: MSG_MAX,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === '/signal') {
      // L'id est attribué ici, jamais fourni par le client : sinon n'importe qui
      // pourrait se faire passer pour l'adversaire d'une partie en cours.
      const id = `j_${(++seq).toString(36)}${Math.floor(Math.random() * 0xffffff).toString(36)}`;
      if (server.upgrade(req, { data: { id, jeton: [], pseudo: null } })) return;
      return new Response('Échec de la bascule WebSocket', { status: 400 });
    }
    if (url.pathname === '/sante') {
      return json({ ok: true, protocole: VERSION_PROTOCOLE, depuis_s: Math.round((Date.now() - demarre) / 1000), ...salle.etat() });
    }
    if (url.pathname === '/') {
      return new Response(
        `Éveil Machine — serveur de signalement\n\n` +
        `  ws://<hote>:${PORT}/signal   salle d'attente et mise en relation\n` +
        `  GET /sante                   état du service (JSON)\n\n` +
        `Protocole ${VERSION_PROTOCOLE} — voir README.md\n`,
        { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' } },
      );
    }
    return json({ ok: false, motif: 'Introuvable' }, 404);
  },
  websocket: {
    maxPayloadLength: MSG_MAX,
    idleTimeout: INACTIF_S,
    open(ws) {
      sockets.set(ws.data.id, ws);
      expedier(salle.connecter(ws.data.id, {}));
    },
    message(ws, brut) {
      // Débit : un client qui s'emballe est coupé plutôt que servi. Le compteur
      // se remet à zéro à chaque seconde entamée, sans minuterie à entretenir.
      const t = Math.floor(Date.now() / 1000);
      if (ws.data.sec !== t) { ws.data.sec = t; ws.data.n = 0; }
      if (++ws.data.n > MSG_PAR_SECONDE) {
        ws.send(JSON.stringify({ t: 'refus', motif: 'Trop de messages.' }));
        ws.close(1008, 'debit');
        return;
      }

      let m;
      try { m = JSON.parse(brut); } catch { return; }
      if (!m || typeof m.t !== 'string') return;
      const id = ws.data.id;

      switch (m.t) {
        case 'bonjour':
          // Rebaptiser le joueur ne doit pas le sortir de la file : on ne
          // reconnecte pas, on met à jour le pseudo déjà enregistré à l'ouverture.
          expedier(salle.connecter(id, { pseudo: m.pseudo, version: m.version }));
          break;
        case 'chercher': expedier(salle.chercher(id, { faction: m.faction })); break;
        case 'annuler': expedier(salle.annuler(id)); break;
        case 'privee': expedier(salle.rejoindrePrivee(id, m.code)); break;
        case 'signal': expedier(salle.signaler(id, m.data)); break;
        case 'pret': expedier(salle.pret(id)); break;
        case 'quitter': expedier(salle.quitterPartie(id, 'depart')); break;
        case 'ping': ws.send(JSON.stringify({ t: 'pong', t0: m.t0 })); break;
        default: ws.send(JSON.stringify({ t: 'refus', motif: `Message inconnu : ${m.t}` }));
      }
    },
    close(ws) {
      sockets.delete(ws.data.id);
      expedier(salle.deconnecter(ws.data.id));
    },
  },
});

console.log(`Signalement — ws://localhost:${serveur.port}/signal  ·  état : http://localhost:${serveur.port}/sante`);
