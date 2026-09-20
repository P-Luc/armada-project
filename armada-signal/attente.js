/* Salle d'attente — la logique pure, sans une seule ligne de réseau.
 *
 * Tout passe par des identifiants de joueur et chaque méthode REND la liste des
 * envois à effectuer (`{pour: [id], msg}`) au lieu d'écrire dans une socket.
 * C'est ce qui rend l'appariement testable sans ouvrir de port : `attente.test.js`
 * fait jouer des parties entières en mémoire, et `serveur.js` n'a plus qu'à
 * traduire ces envois en `ws.send`. Un bug d'appariement se reproduit alors en
 * trois lignes de test, jamais en jonglant avec deux navigateurs.
 */

// Alphabet sans O/0 ni I/1 : ces codes se dictent à voix haute.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LONGUEUR = 6;
export const VERSION_PROTOCOLE = 1;

const PSEUDO_MAX = 24;
const SIGNAL_MAX = 16 * 1024; // un SDP complet tient largement dedans

/** Normalise un code de salon privé : majuscules, alphabet restreint, longueur fixe. */
export function normaliserCode(brut) {
  const propre = String(brut || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LONGUEUR);
  return propre.length >= 4 ? propre : null;
}

/** Nettoie un pseudo : pas de retour à la ligne, pas de pavé, jamais vide. */
export function normaliserPseudo(brut) {
  const propre = String(brut == null ? '' : brut).replace(/\s+/g, ' ').trim().slice(0, PSEUDO_MAX);
  return propre || 'Anonyme';
}

export const AUTRE_CAMP = (f) => (f === 'arche' ? 'collective' : 'arche');

export function creerSalleDAttente(options = {}) {
  // Tirages injectables : les tests veulent des graines et des codes prévisibles.
  const hasard = options.hasard || Math.random;
  const maintenant = options.maintenant || (() => Date.now());

  const joueurs = new Map();  // id → joueur
  const parties = new Map();  // id de partie → partie
  const privees = new Map();  // code → id de partie en attente d'un second
  let file = [];              // ids en salle d'attente publique, du plus ancien au plus récent
  let seq = 0;

  const nouvelId = (prefixe) => `${prefixe}_${(++seq).toString(36)}${Math.floor(hasard() * 0xffffff).toString(36)}`;
  // La graine fixe le monde généré des deux côtés (cf. `startGame(faction, graine)`
  // du jeu) : c'est la seule donnée de la partie qui DOIT être identique chez les
  // deux clients, donc c'est le serveur qui la tire, jamais un des deux joueurs.
  const nouvelleGraine = () => (Math.floor(hasard() * 0x7ffffffe) | 1) >>> 0;

  function nouveauCode() {
    for (let essai = 0; essai < 50; essai++) {
      let c = '';
      for (let i = 0; i < CODE_LONGUEUR; i++) c += ALPHABET[Math.floor(hasard() * ALPHABET.length)];
      if (!privees.has(c)) return c;
    }
    return null; // 32^6 codes : on n'arrive ici que si le hasard injecté est constant
  }

  const vue = (j) => ({ id: j.id, pseudo: j.pseudo });
  const refus = (id, motif) => [{ pour: [id], msg: { t: 'refus', motif } }];

  /* Appelée à l'ouverture de la socket, puis à chaque `bonjour`. Le second appel
     ne RECRÉE pas le joueur : il se contente de baptiser celui qui existe déjà.
     Repartir d'un objet neuf le sortirait silencieusement de la file d'attente,
     ou pire, de sa partie, pour la seule raison qu'il a envoyé son pseudo tard. */
  function connecter(id, { pseudo, version } = {}) {
    const existant = joueurs.get(id);
    const j = existant || {
      id,
      etat: 'inactif', // inactif | attente | partie
      partie: null,
      faction: null,
      souhait: null,
      depuis: maintenant(),
    };
    if (pseudo !== undefined || !existant) j.pseudo = normaliserPseudo(pseudo !== undefined ? pseudo : j.pseudo);
    // La version ne change plus une fois engagé : l'appariement l'a déjà utilisée.
    if (j.etat === 'inactif') j.version = Number(version) || j.version || VERSION_PROTOCOLE;
    joueurs.set(id, j);
    return [{ pour: [id], msg: { t: 'bienvenue', id, pseudo: j.pseudo, protocole: VERSION_PROTOCOLE, ...etat() } }];
  }

  /** Entrée dans la file publique : on apparie tout de suite si quelqu'un attend. */
  function chercher(id, { faction } = {}) {
    const j = joueurs.get(id);
    if (!j) return [];
    if (j.etat === 'partie') return refus(id, 'Déjà en partie — quittez-la d\'abord.');
    // Une seconde recherche ne doit pas dupliquer l'entrée dans la file : on
    // remet simplement la préférence à jour et on garde le rang acquis.
    j.souhait = faction === 'arche' || faction === 'collective' ? faction : null;
    // Un joueur « en attente » l'est soit dans la file publique, soit dans SON
    // salon privé. Dans le second cas il faut d'abord fermer le salon : sans
    // cela il resterait rattaché à un code que son ami pourrait rejoindre alors
    // qu'il joue déjà ailleurs, et son rang dans la file vaudrait zéro.
    if (j.etat === 'attente' && j.partie) quitterPartie(id, 'depart');
    else if (j.etat === 'attente') return [{ pour: [id], msg: { t: 'attente', position: file.indexOf(id) + 1, ...etat() } }];

    const advId = file.find((autre) => {
      const a = joueurs.get(autre);
      // Deux versions de protocole différentes ne s'apparient pas : mieux vaut
      // attendre que lancer une partie qui divergera au premier tick.
      return a && a.version === j.version;
    });
    if (advId) {
      file = file.filter((x) => x !== advId);
      return apparier(joueurs.get(advId), j, null);
    }
    j.etat = 'attente';
    file.push(id);
    return [{ pour: [id], msg: { t: 'attente', position: file.length, ...etat() } }];
  }

  function annuler(id) {
    const j = joueurs.get(id);
    if (!j || j.etat !== 'attente') return [];
    // Annuler depuis un salon privé doit AUSSI rendre le code : un salon qu'on
    // a quitté et que le serveur garde ouvert est un piège pour l'ami qui arrive.
    if (j.partie) quitterPartie(id, 'depart');
    file = file.filter((x) => x !== id);
    j.etat = 'inactif';
    return [{ pour: [id], msg: { t: 'annule', ...etat() } }, ...rafraichirFile()];
  }

  /** Salon privé : le code se donne à un ami, le second arrivé déclenche la partie. */
  function rejoindrePrivee(id, codeBrut) {
    const j = joueurs.get(id);
    if (!j) return [];
    if (j.etat === 'partie') return refus(id, 'Déjà en partie — quittez-la d\'abord.');
    if (j.etat === 'attente') annuler(id); // file publique ou salon précédent : on libère

    if (codeBrut == null || codeBrut === '') {
      const code = nouveauCode();
      if (!code) return refus(id, 'Impossible de tirer un code libre.');
      const p = {
        id: nouvelId('p'), code, joueurs: [id], graine: nouvelleGraine(),
        prets: new Set(), lancee: false, creee: maintenant(),
      };
      parties.set(p.id, p);
      privees.set(code, p.id);
      j.etat = 'attente';
      j.partie = p.id;
      return [{ pour: [id], msg: { t: 'salon', code, joueurs: 1, ...etat() } }];
    }

    const code = normaliserCode(codeBrut);
    if (!code) return refus(id, 'Code invalide (4 à 6 caractères).');
    const pid = privees.get(code);
    if (!pid) return refus(id, 'Aucun salon à ce code.');
    const p = parties.get(pid);
    if (!p || p.joueurs.length >= 2) return refus(id, 'Salon complet.');
    if (p.joueurs[0] === id) return refus(id, 'Vous tenez déjà ce salon.');

    const hote = joueurs.get(p.joueurs[0]);
    if (hote.version !== j.version) return refus(id, 'Versions de protocole différentes.');
    privees.delete(code);
    hote.etat = 'inactif'; // apparier() remet les deux joueurs dans le bon état
    hote.partie = null;
    return apparier(hote, j, p);
  }

  /** Deux joueurs, une partie : camps opposés, graine commune, rôles fixés. */
  function apparier(a, b, partieExistante) {
    const p = partieExistante || {
      id: nouvelId('p'), code: null, joueurs: [], graine: nouvelleGraine(),
      prets: new Set(), lancee: false, creee: maintenant(),
    };
    p.joueurs = [a.id, b.id];
    parties.set(p.id, p);

    // Le camp est une PRÉFÉRENCE, pas une exigence : le premier arrivé obtient
    // le sien, le second prend l'autre. Exiger les deux camps rendrait la file
    // famélique — deux amateurs de l'Arche attendraient indéfiniment côte à côte.
    const camp = a.souhait || (b.souhait ? AUTRE_CAMP(b.souhait) : 'arche');
    a.faction = camp;
    b.faction = AUTRE_CAMP(camp);

    for (const j of [a, b]) {
      j.etat = 'partie';
      j.partie = p.id;
      j.souhait = null;
    }
    file = file.filter((x) => x !== a.id && x !== b.id);

    // `role` départage les deux pairs sans élire de maître de simulation : il ne
    // sert qu'à l'établissement du lien (qui émet l'offre WebRTC, qui répond).
    const envois = [
      { pour: [a.id], msg: { t: 'apparie', partie: p.id, code: p.code, graine: p.graine, faction: a.faction, role: 'hote', adversaire: vue(b) } },
      { pour: [b.id], msg: { t: 'apparie', partie: p.id, code: p.code, graine: p.graine, faction: b.faction, role: 'invite', adversaire: vue(a) } },
    ];
    return [...envois, ...rafraichirFile()];
  }

  /** Relais opaque : le serveur ne lit jamais le contenu (SDP, ICE, ce qu'on veut). */
  function signaler(id, data) {
    const j = joueurs.get(id);
    if (!j || j.etat !== 'partie') return refus(id, 'Aucune partie en cours.');
    const p = parties.get(j.partie);
    if (!p) return refus(id, 'Aucune partie en cours.');
    const brut = typeof data === 'string' ? data : JSON.stringify(data);
    if (brut === undefined || brut.length > SIGNAL_MAX) return refus(id, 'Signal trop volumineux.');
    const adv = p.joueurs.find((x) => x !== id);
    if (!adv) return refus(id, 'Adversaire absent.');
    return [{ pour: [adv], msg: { t: 'signal', de: id, data } }];
  }

  /** Les deux « prêt » reçus, la partie est lancée — le reste se joue ailleurs. */
  function pret(id) {
    const j = joueurs.get(id);
    if (!j || j.etat !== 'partie') return [];
    const p = parties.get(j.partie);
    if (!p || p.lancee) return [];
    p.prets.add(id);
    if (p.prets.size < 2) {
      const adv = p.joueurs.find((x) => x !== id);
      return adv ? [{ pour: [adv], msg: { t: 'adversaire-pret' } }] : [];
    }
    p.lancee = true;
    const camps = {};
    for (const x of p.joueurs) camps[x] = joueurs.get(x).faction;
    return [{ pour: [...p.joueurs], msg: { t: 'lancer', partie: p.id, graine: p.graine, camps } }];
  }

  /** Quitter une partie la dissout : à deux joueurs, il n'en reste pas un pour jouer. */
  function quitterPartie(id, motif) {
    const j = joueurs.get(id);
    if (!j || !j.partie) return [];
    const p = parties.get(j.partie);
    j.partie = null;
    j.faction = null;
    if (j.etat === 'partie' || j.etat === 'attente') j.etat = 'inactif';
    if (!p) return [];
    parties.delete(p.id);
    if (p.code) privees.delete(p.code);
    const restants = p.joueurs.filter((x) => x !== id);
    const envois = [];
    for (const x of restants) {
      const autre = joueurs.get(x);
      if (!autre) continue;
      autre.partie = null;
      autre.faction = null;
      autre.etat = 'inactif';
      envois.push({ pour: [x], msg: { t: 'adversaire-parti', motif: motif || 'depart', ...etat() } });
    }
    return envois;
  }

  function deconnecter(id) {
    const j = joueurs.get(id);
    if (!j) return [];
    const envois = j.partie ? quitterPartie(id, 'deconnexion') : [];
    file = file.filter((x) => x !== id);
    joueurs.delete(id);
    return [...envois, ...rafraichirFile()];
  }

  /** Chacun voit son rang bouger quand la file avance : sans cela, on attend à l'aveugle. */
  function rafraichirFile() {
    return file.map((x, i) => ({ pour: [x], msg: { t: 'attente', position: i + 1, ...etat() } }));
  }

  function etat() {
    return { joueurs: joueurs.size, attente: file.length, parties: parties.size };
  }

  return {
    connecter, deconnecter, chercher, annuler, rejoindrePrivee,
    signaler, pret, quitterPartie, etat,
    // lecture seule, pour les tests et la route de santé
    _joueur: (id) => joueurs.get(id),
    _partie: (pid) => parties.get(pid),
    _file: () => [...file],
  };
}
