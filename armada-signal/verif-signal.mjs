/* Contrôle bout en bout — `bun verif-signal.mjs`
 *
 * `bun test` couvre la salle d'attente en mémoire ; ici on vérifie ce que les
 * tests ne peuvent pas voir : un vrai serveur, de vraies sockets, deux clients
 * qui s'apparient, se signalent et se lancent. C'est aussi le seul endroit où
 * l'on exerce la bascule WebSocket, le débit et la route de santé.
 */
const PORT = Number(process.env.PORT_TEST) || 38217;
const BASE = `http://127.0.0.1:${PORT}`;
const echecs = [];
const verifier = (ok, quoi) => { console.log(`  ${ok ? '✓' : '✗'} ${quoi}`); if (!ok) echecs.push(quoi); };

const proc = Bun.spawn(['bun', 'serveur.js'], {
  env: { ...process.env, PORT: String(PORT) },
  stdout: 'pipe', stderr: 'pipe',
});

/** Un client de test : une socket, une boîte aux lettres, et l'attente d'un type. */
function client(nom) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/signal`);
  const recus = [];
  const guetteurs = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    recus.push(m);
    for (let i = guetteurs.length - 1; i >= 0; i--) {
      if (guetteurs[i].type === m.t) { guetteurs.splice(i, 1)[0].resoudre(m); }
    }
  });
  const c = {
    nom, ws, recus,
    ouvert: new Promise((res, rej) => {
      ws.addEventListener('open', res);
      ws.addEventListener('error', rej);
    }),
    envoyer: (o) => ws.send(JSON.stringify(o)),
    // Un message peut arriver avant qu'on le demande : on regarde d'abord la boîte.
    attendre(type, ms = 3000) {
      const dejaLa = recus.find((m) => m.t === type);
      if (dejaLa) { recus.splice(recus.indexOf(dejaLa), 1); return Promise.resolve(dejaLa); }
      return new Promise((resoudre, rejeter) => {
        const g = { type, resoudre };
        guetteurs.push(g);
        setTimeout(() => {
          const i = guetteurs.indexOf(g);
          if (i >= 0) { guetteurs.splice(i, 1); rejeter(new Error(`${nom} : « ${type} » jamais reçu`)); }
        }, ms);
      });
    },
    fermer: () => ws.close(),
  };
  return c;
}

async function attendreServeur() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${BASE}/sante`);
      if (r.ok) return r.json();
    } catch { /* pas encore en ligne */ }
    await Bun.sleep(50);
  }
  throw new Error('le serveur ne répond pas');
}

try {
  const sante = await attendreServeur();
  console.log('Santé :', JSON.stringify(sante));
  verifier(sante.ok === true && sante.protocole >= 1, 'GET /sante répond');

  console.log('\nFile publique');
  const a = client('A'), b = client('B');
  await Promise.all([a.ouvert, b.ouvert]);
  await a.attendre('bienvenue'); await b.attendre('bienvenue');

  a.envoyer({ t: 'bonjour', pseudo: 'Alice', version: 1 });
  b.envoyer({ t: 'bonjour', pseudo: 'Bob', version: 1 });
  await a.attendre('bienvenue'); await b.attendre('bienvenue');

  a.envoyer({ t: 'chercher', faction: 'arche' });
  const att = await a.attendre('attente');
  verifier(att.position === 1, 'le premier joueur attend en tête de file');

  b.envoyer({ t: 'chercher' });
  const [apA, apB] = await Promise.all([a.attendre('apparie'), b.attendre('apparie')]);
  verifier(apA.partie === apB.partie, 'les deux reçoivent le même identifiant de partie');
  verifier(apA.graine === apB.graine && apA.graine > 0, 'la graine est commune et non nulle');
  verifier(apA.faction === 'arche' && apB.faction === 'collective', 'les camps sont opposés');
  verifier(apA.role === 'hote' && apB.role === 'invite', 'les rôles d\'établissement sont fixés');
  verifier(apA.adversaire.pseudo === 'Bob' && apB.adversaire.pseudo === 'Alice', 'chacun sait qui il affronte');

  console.log('\nSignalement');
  a.envoyer({ t: 'signal', data: { sdp: 'offre-test' } });
  const sig = await b.attendre('signal');
  verifier(sig.data.sdp === 'offre-test', 'le signal traverse jusqu\'à l\'adversaire');
  b.envoyer({ t: 'signal', data: { sdp: 'reponse-test' } });
  verifier((await a.attendre('signal')).data.sdp === 'reponse-test', 'la réponse revient');

  a.envoyer({ t: 'pret' });
  verifier((await b.attendre('adversaire-pret')) !== null, 'le premier « prêt » prévient l\'autre');
  b.envoyer({ t: 'pret' });
  const [lA, lB] = await Promise.all([a.attendre('lancer'), b.attendre('lancer')]);
  verifier(lA.graine === lB.graine && lA.partie === apA.partie, 'les deux « lancer » portent la même partie');

  console.log('\nDépart');
  a.fermer();
  const parti = await b.attendre('adversaire-parti');
  verifier(parti.motif === 'deconnexion', 'la coupure de l\'un libère l\'autre');
  verifier(parti.parties === 0, 'la partie est dissoute côté serveur');

  console.log('\nSalon privé');
  const c = client('C'), d = client('D');
  await Promise.all([c.ouvert, d.ouvert]);
  await c.attendre('bienvenue'); await d.attendre('bienvenue');
  c.envoyer({ t: 'privee' });
  const salon = await c.attendre('salon');
  verifier(/^[A-Z2-9]{6}$/.test(salon.code), `un code lisible est tiré (${salon.code})`);
  d.envoyer({ t: 'privee', code: salon.code.toLowerCase() });
  const [pc, pd] = await Promise.all([c.attendre('apparie'), d.attendre('apparie')]);
  verifier(pc.code === salon.code && pc.partie === pd.partie, 'le code mène bien à la même partie');

  console.log('\nRefus');
  b.envoyer({ t: 'cette-commande-nexiste-pas' });
  verifier((await b.attendre('refus')).motif.includes('inconnu'), 'un message inconnu est refusé, pas ignoré');
  c.envoyer({ t: 'signal', data: 'x'.repeat(20000) });
  verifier((await c.attendre('refus')).motif.includes('volumineux'), 'un signal démesuré est refusé');

  const e = client('E');
  await e.ouvert;
  const ferme = new Promise((res) => e.ws.addEventListener('close', (ev) => res(ev)));
  for (let i = 0; i < 60; i++) e.envoyer({ t: 'ping', t0: i });
  verifier((await ferme).code === 1008, 'un client qui s\'emballe est coupé');

  for (const cl of [b, c, d]) cl.fermer();
  await Bun.sleep(100);
  const fin = await (await fetch(`${BASE}/sante`)).json();
  verifier(fin.joueurs === 0 && fin.parties === 0, 'tout est libéré après les départs');
} catch (err) {
  echecs.push(`exception : ${err.message}`);
  console.error(err);
} finally {
  proc.kill();
  await proc.exited;
}

console.log(echecs.length ? `\n${echecs.length} échec(s) :\n  ${echecs.join('\n  ')}` : '\nSignalement : tous les contrôles passent');
process.exit(echecs.length ? 1 : 0);
