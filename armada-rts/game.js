'use strict';
/* ============================================================
   ÉVEIL MACHINE — L'ARCHE
   RTS nomade inspiré d'AI War : un vaisseau-mère unique qui
   s'améliore par modules, escorté de drones. Métal miné sur
   les astéroïdes (épuisables), énergie captée dans les champs
   de radiation des pulsars. Deux architectures s'affrontent :
   le Core central (un QG et ses stations) et le Collectif
   (des cellules qui se divisent et se reconfigurent).
   ============================================================ */

const GAME_VERSION = 'v16.0'; // suit le Journal des décisions (vault Obsidian)
const WORLD = { w: 6400, h: 4200 };
const TAU = Math.PI * 2;

/* ===== Deux flux d'aléa (v16, multijoueur) =====
   `alea`/`rand` : aléa de SIMULATION, semé. En réseau, les deux clients
   déroulent la même suite au même tick — c'est ce qui garde les deux mondes
   identiques (lockstep). N'y puiser que ce qui change l'état du monde.
   `aleaVis`/`randVis` : aléa COSMÉTIQUE (étincelles, étoiles, sons), jamais
   synchronisé. Y puiser tout ce qui ne fait que se voir ou s'entendre — sinon
   une fenêtre plus petite, un son coupé ou du brouillard suffiraient à décaler
   le flux de simulation d'un client et à désynchroniser la partie. */
let graine = 1, etatAlea = 1, tick = 0;
function semer(g) { graine = (g >>> 0) || 1; etatAlea = graine; tick = 0; }
function alea() { // mulberry32 : 32 bits, entier, donc identique sur tout moteur JS
  etatAlea = (etatAlea + 0x6D2B79F5) | 0;
  let t = Math.imul(etatAlea ^ (etatAlea >>> 15), 1 | etatAlea);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rand = (a, b) => a + alea() * (b - a);
const randVis = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
// v15.6 : un coût mono-ressource s'affiche seul — « 60⚡ », jamais « 0◆ 60⚡ »
const coutTxt = (c) => (c.m ? c.m + '◆' : '') + (c.m && c.e ? ' ' : '') + (c.e ? c.e + '⚡' : '') || 'gratuit';
let idSeq = 1;

const COL = {
  p: '#5ce8c9', pDark: '#0c2a25',
  a: '#ff4254', aDark: '#2a0a0e',
  h: '#c77dff', hDark: '#221030', // v13 : le Collectif (faction décentralisée)
  amber: '#ffb454', e: '#8dffa8', ast: '#54617a'
};
const sideCol = (side) => side === 'player' ? COL.p : side === 'hive' ? COL.h : COL.a;

/* ===== assets SVG & préchargement ===== */
const UNIT_SCALES = {
  mother: 1.15,
  aimother: 1.1,
  cdrone: 5.2,
  corvette: 4.5,
  lanceur: 4.0,
  vhangar: 3.8,
  cargo: 3.4,
  cminer: 7.2,
  miner: 5.0,
  probe: 5.5,
  capsule: 6.0,
  drone: 5.2,
  raider: 4.5,
  dread: 2.8,
  h_essaim: 5.0,
  h_bastion: 3.5,
  h_recolteur: 5.5,
  h_epine: 4.0,
  h_traqueur: 5.5,
  h_entrepot: 3.2,
  h_synapse: 4.5,
  h_couveuse: 3.0,
  h_matrice: 2.9,
  h_colosse: 2.6,
  h_dard: 3.0,
  h_nuee: 4.8,
  sentinelle: 2.2,
  collectsat: 2.2,
  spatiale: 1.2,
  aiturret: 2.2,
  gate: 1.2
};

const SVG_IMAGES = {};
let assetsLoaded = 0;
const totalAssets = Object.keys(UNIT_SCALES).length;

// Désactiver temporairement les boutons de démarrage le temps du chargement
// v15.13 : la version chargée s'affiche dans le bandeau — sans ça, une page
// servie depuis le cache est indétectable à l'œil et on cherche des bugs fantômes
const elVer = document.getElementById('hud-version');
if (elVer) elVer.textContent = GAME_VERSION;

const btnStart = document.getElementById('btn-start');
const btnStartHive = document.getElementById('btn-start-hive');
if (btnStart) {
  btnStart.disabled = true;
  btnStart.style.opacity = '0.5';
  btnStart.style.cursor = 'not-allowed';
  btnStart.innerHTML = 'CHARGEMENT...';
}
if (btnStartHive) {
  btnStartHive.disabled = true;
  btnStartHive.style.opacity = '0.5';
  btnStartHive.style.cursor = 'not-allowed';
  btnStartHive.innerHTML = 'CHARGEMENT...';
}

function enableStartButtons() {
  if (btnStart) {
    btnStart.disabled = false;
    btnStart.style.opacity = '1';
    btnStart.style.cursor = 'pointer';
    btnStart.innerHTML = 'RÉVEILLER<br>LE CORE CENTRAL';
  }
  if (btnStartHive) {
    btnStartHive.disabled = false;
    btnStartHive.style.opacity = '1';
    btnStartHive.style.cursor = 'pointer';
    btnStartHive.innerHTML = 'ÉVEILLER<br>LE COLLECTIF';
  }
}

/* v15.7 — les assets récupérés de l'ancienne IA sont peints en rouge (#ff4254).
   Depuis que le JOUEUR construit ces unités et ces stations, il faut une variante
   à ses couleurs : on la pré-rend UNE fois dans un canvas hors écran (rouge ≈ 353°
   → cyan ≈ 168°). Un filtre appliqué à chaque frame coûterait bien plus cher. */
const RED_ART = ['gate', 'aiturret', 'drone', 'raider', 'dread'];
const SVG_TEINTES = {};
function teinterAsset(id, img) {
  const w = img.naturalWidth || 120, h = img.naturalHeight || 120;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.filter = 'hue-rotate(175deg)';
  g.drawImage(img, 0, 0, w, h);
  SVG_TEINTES[id] = c;
}

Object.keys(UNIT_SCALES).forEach(id => {
  const img = new Image();
  img.src = `assets/svg/${id}.svg`;
  img.onload = () => {
    if (RED_ART.includes(id)) { try { teinterAsset(id, img); } catch (e) { /* variante optionnelle */ } }
    assetsLoaded++;
    if (assetsLoaded === totalAssets) {
      enableStartButtons();
    }
  };
  img.onerror = () => {
    console.error(`Erreur de chargement de l'asset SVG : assets/svg/${id}.svg`);
    assetsLoaded++;
    if (assetsLoaded === totalAssets) {
      enableStartButtons();
    }
  };
  SVG_IMAGES[id] = img;
});

/* L'objet Image existe même quand le chargement a échoué : le tester avec
   `if (img)` ne dit rien. Seule une image DÉCODÉE peut passer à drawImage,
   sinon le navigateur lève InvalidStateError et tue la boucle de rendu.
   Retourne null quand l'asset manque : les tracés vectoriels de repli
   prennent alors le relais et la partie reste jouable. */
function svgPret(id, side) {
  const img = SVG_IMAGES[id];
  if (!(img && img.complete && img.naturalWidth > 0)) return null;
  // v15.7 : variante aux couleurs du joueur pour les assets récupérés
  if (side === 'player' && SVG_TEINTES[id]) return SVG_TEINTES[id];
  return img;
}

/* ===== définitions ===== */
const SHIPS = {
  cdrone: { nom: 'Drone de combat', hp: 55, dmg: 5, vsS: 1, range: 150, cd: 0.5, speed: 210, r: 6, ss: 560 },
  miner:  { nom: 'Drone minier', hp: 45, speed: 175, r: 6 },
  capsule: { nom: 'Capsule d\'énergie', hp: 35, speed: 120, r: 5 },
  probe:   { nom: 'Sonde de déploiement', hp: 40, speed: 150, r: 5 },
  // produits par la Station Spatiale
  cargo:    { nom: 'Cargo minier', hp: 260, speed: 70, r: 14 },
  cminer:   { nom: 'Drone de collecte', hp: 30, speed: 185, r: 4 },
  corvette: { nom: 'Corvette', hp: 220, dmg: 14, vsS: 1, range: 110, cd: 0.35, speed: 175, r: 9, ss: 600 },
  lanceur:  { nom: 'Lanceur', hp: 120, dmg: 30, vsS: 2, range: 420, cd: 2.2, speed: 90, r: 10, ss: 520 },
  vhangar:  { nom: 'Vaisseau-hangar', hp: 300, speed: 60, r: 12 },
  // v13/v14 — formes de le Collectif : chaque entité peut muter (cf. MUTATIONS).
  // L'Essaim est la cellule-souche : seul à pouvoir se diviser, hub des mutations.
  h_essaim:    { nom: 'Essaim', hp: 50, dmg: 4, vsS: 1, range: 120, cd: 0.45, speed: 200, r: 6, ss: 540 },
  h_bastion:   { nom: 'Bastion', hp: 420, dmg: 12, vsS: 1.2, range: 260, cd: 0.7, speed: 0, r: 12, ss: 640 },
  h_recolteur: { nom: 'Récolteur', hp: 80, speed: 120, r: 7 },
  h_epine:     { nom: 'Épine', hp: 90, dmg: 26, vsS: 1.8, range: 380, cd: 2.0, speed: 80, r: 9, ss: 520 },
  h_traqueur:  { nom: 'Traqueur', hp: 40, dmg: 3, vsS: 1, range: 100, cd: 0.5, speed: 260, r: 5, ss: 560 },
  h_entrepot:  { nom: 'Entrepôt', hp: 550, speed: 0, r: 13 },
  h_synapse:   { nom: 'Synapse', hp: 180, speed: 0, r: 10 },
  // v15.8 — le palier supérieur du Collectif. Une seule voie y mène : la FUSION
  // de deux formes de tier 2 (sauf la Couveuse, simple évolution). C'est ce qui
  // donne son sens au graphe : on ne « débloque » rien, on sacrifie deux corps
  // pour en obtenir un seul, plus grand.
  h_couveuse:  { nom: 'Couveuse', hp: 620, speed: 0, r: 14 },
  h_matrice:   { nom: 'Matrice', hp: 700, speed: 0, r: 15 },
  h_colosse:   { nom: 'Colosse', hp: 720, dmg: 26, vsS: 1.3, range: 210, cd: 0.8, speed: 60, r: 16, ss: 620 },
  h_dard:      { nom: 'Dard', hp: 120, dmg: 46, vsS: 2.4, range: 540, cd: 3.0, speed: 55, r: 11, ss: 540 },
  h_nuee:      { nom: 'Nuée', hp: 75, dmg: 6, vsS: 1, range: 130, cd: 0.28, speed: 300, r: 6, ss: 580 },
  // v15.7 — l'ancienne flotte de « la Machine » rejoint le Core central : c'est
  // le même camp, donc le MÊME arsenal des deux côtés. Le joueur les construit
  // au chantier naval, l'IA les déploie depuis son QG et ses relais.
  drone:  { nom: 'Drone lourd', hp: 60, dmg: 5, vsS: 1.6, range: 140, cd: 0.55, speed: 150, r: 7, ss: 520 },
  raider: { nom: 'Pillard', hp: 140, dmg: 11, vsS: 2.2, range: 165, cd: 1.1, speed: 112, r: 9, ss: 460 },
  dread:  { nom: 'Éradicateur', hp: 560, dmg: 22, vsS: 1.5, range: 260, cd: 1.35, speed: 58, r: 15, ss: 640 },
};
const STRUCTS = {
  sentinelle: { nom: 'Station Sentinelle', hp: 550, r: 13, dmg: 11, range: 280, cd: 0.6, ss: 700 },
  collectsat: { nom: 'Station Collectrice', hp: 300, r: 13, rate: 5 },
  spatiale:   { nom: 'Station Spatiale', hp: 2500, r: 28, dmg: 14, range: 320, cd: 0.8, ss: 700 },
  // v15.7 : les deux structures de l'ex-Machine deviennent des bâtiments du Core
  // central, constructibles par les deux camps. Le Relais garde son anneau de
  // distorsion (il matérialise sa garnison) ; la Batterie devient l'artillerie
  // statique de la faction — longue portée, cadence lente, ravageuse sur coque.
  gate:       { nom: 'Station Relais', hp: 1500, r: 30, prog: 12 },
  aiturret:   { nom: 'Batterie', hp: 680, r: 13, dmg: 26, vsS: 1.8, range: 470, cd: 2.4, ss: 700, prog: 2 },
};
// stations secondaires du Core central : le QG ne suffit pas, il faut TOUT abattre
const SECOND_KINDS = ['spatiale', 'gate'];
// v15.6 — RÈGLE D'ANTI-BLOCAGE : tout ce qui récolte une ressource se paie
// UNIQUEMENT dans l'autre. Le métal achète les capteurs d'énergie, l'énergie
// achète les foreuses : à zéro d'une ressource, l'autre suffit toujours à
// relancer la machine. (Conversion implicite du jeu : 1 ⚡ ≈ 2,5 ◆.)
const MODULES = {
  hangar:     { nom: 'Baie de drones', max: 3, cost: [{ m: 120, e: 40 }, { m: 260, e: 90 }, { m: 480, e: 160 }] },
  forage:     { nom: 'Foreuse', max: 3, cost: [{ m: 0, e: 60 }, { m: 0, e: 150 }, { m: 0, e: 280 }] },
  collecteur: { nom: 'Collecteur', max: 3, cost: [{ m: 90, e: 0 }, { m: 300, e: 0 }, { m: 630, e: 0 }] },
  canon:      { nom: 'Canon spinal', max: 3, cost: [{ m: 150, e: 60 }, { m: 300, e: 130 }, { m: 520, e: 220 }] },
  bouclier:   { nom: 'Bouclier', max: 3, cost: [{ m: 140, e: 80 }, { m: 280, e: 160 }, { m: 500, e: 260 }] },
  propulsion: { nom: 'Propulsion', max: 3, cost: [{ m: 110, e: 50 }, { m: 240, e: 110 }, { m: 420, e: 190 }] },
};
const MOD_KEYS = Object.keys(MODULES);
const SATS = {
  sentinelle: { m: 180, e: 40 },
  collectsat: { m: 210, e: 0 },  // capte l'énergie : se paie tout en métal (v15.6)
  aiturret:   { m: 300, e: 110 }, // Batterie : artillerie statique (v15.7)
  gate:       { m: 430, e: 160 }, // Station Relais : garnison entretenue (v15.7)
  spatiale:   { m: 400, e: 150 },
};
const BUILD_TIMES = { sentinelle: 10, collectsat: 8, aiturret: 12, gate: 16, spatiale: 18 };
// Station Relais : garnison gratuite mais liée au relais (les deux camps)
const RELAIS_GARDE = 4;    // effectif entretenu
const RELAIS_DELAI = 20;   // secondes entre deux matérialisations
// Station Spatiale : améliorations (vers niv 2 puis 3) et reconstruction de l'Arche
const SPATIALE_UP = [{ m: 450, e: 180 }, { m: 700, e: 300 }];
const REBUILD_COST = { m: 900, e: 350 };
// chantier naval de la Station Spatiale (débloqué par niveau)
const PROD = {
  cargo:    { m: 0, e: 160,  t: 16, lvl: 1 },   // mine le métal : se paie tout en énergie (v15.6)
  corvette: { m: 130, e: 45,  t: 10, lvl: 1 },
  drone:    { m: 95,  e: 30,  t: 8,  lvl: 1 },  // v15.7 : l'arsenal récupéré de l'ex-Machine
  lanceur:  { m: 210, e: 90,  t: 14, lvl: 2 },
  raider:   { m: 190, e: 75,  t: 12, lvl: 2 },
  dread:    { m: 480, e: 220, t: 26, lvl: 3, max: 3 },
  vhangar:  { m: 260, e: 120, t: 20, lvl: 3, max: 2 },
};
// v15.2 — la file de production s'améliore : chaque niveau de chantier ajoute
// une LIGNE construite en parallèle, allonge la file et accélère la cadence.
// Le chantier ne peut jamais dépasser le niveau de la station : les deux
// améliorations s'appellent l'une l'autre.
const YARD = [
  { lines: 1, cap: 5,  spd: 1 },
  { lines: 2, cap: 8,  spd: 1.2 },
  { lines: 3, cap: 12, spd: 1.45 },
];
const YARD_UP = [{ m: 300, e: 120, t: 12 }, { m: 520, e: 220, t: 16 }];
// v15.7 : drone/raider/dread sont désormais des unités du Core central — donc
// commandables quand c'est le joueur qui les possède (côté IA, `updateEnemy`
// prime de toute façon : le dispatch teste `side === 'ai'` en premier).
// v15.12 — UNE seule convention pour Maj, partout : série de cinq. Chantier
// naval, mutations, divisions, fusions — même touche, même quantité.
const SERIE_MAJ = 5;
const COMBAT_KINDS = ['cdrone', 'corvette', 'lanceur', 'drone', 'raider', 'dread',
  'h_essaim', 'h_bastion', 'h_epine', 'h_traqueur', 'h_colosse', 'h_dard', 'h_nuee'];
// v15.5 — les ceintures sont vivantes : les astéroïdes dérivent, leurs veines se
// régénèrent, et deux rochers qui se percutent explosent en vague de dégâts.
// v15.14 : des rochers plus gros et plus lents — ils deviennent du TERRAIN,
// pas des mobiles. La dérive tombe à un tiers : on a le temps de composer avec.
const AST_DRIFT = [3, 9];    // vitesse de dérive (min, max)
const AST_TAILLE = [30, 54]; // rayon courant
const AST_RECIF = [58, 82];  // récifs isolés : les gros obstacles de la carte
// tout vaisseau qui traverse un rocher est freiné — c'est ce qui fait d'une
// ceinture un obstacle et non un décor. Aucun blocage : le jeu n'a pas de
// recherche de chemin, une unité bloquée resterait coincée.
const AST_DRAG = 0.55;
const AST_REGEN = 0.9;       // ◆/s regagnés par astéroïde (plafond : stock initial)
// seuil d'intérêt : sous ce stock, on cherche une meilleure veine ailleurs plutôt
// que de camper sur un filon qui ne fait que se régénérer goutte à goutte
const AST_WORTH = 60;
// seuil de fatalité : sous cette vitesse relative, deux rochers se bousculent et
// repartent ; au-dessus, le choc les pulvérise. Sans ce seuil, une ceinture —
// où tout dérive au même cap, donc à vitesse relative quasi nulle — s'auto-
// détruirait au premier frôlement. v15.14 : la dérive ayant été divisée par
// trois, le seuil suit (un choc frontal plafonne désormais à 18).
const AST_SMASH = 13;
const AST_BOOM_R = 3.1;      // rayon de la vague = (r1 + r2) × ce facteur
const AST_BOOM_DMG = 3.4;    // dégâts au centre = (r1 + r2) × ce facteur
const AST_RESPAWN = 30;      // délai (s) avant qu'un rocher neuf entre dans le secteur
const CARGO_FULL = 150;     // soute du Cargo minier
const VHANGAR_CAP = 6;      // chasseurs supplémentaires par hangar arrimé
const CDRONE_COST = { m: 25, e: 5 };
const MINER_COST = { m: 0, e: 8 };  // le drone minier rapporte du métal : payé en énergie (v15.6)
const CARGO = 25;
const CAPSULE_CHARGE = 25; // énergie embarquée par capsule

// v12 — faction centralisée : chaque unité/structure est liée à un core.
// Cores du Core central : le QG (l'Arche ou le Core adverse) et ses stations
// secondaires (Spatiale, Relais). Core mort → re-liaison au core vivant le plus
// proche s'il est à portée, sinon l'entité est orpheline et dégradée.
const LINK_RANGE = 1600;   // portée de re-liaison après la perte du core
const ORPHAN_MALUS = 0.5;  // orphelin : vitesse et cadence de tir ×0,5
const LINK_EXEMPT = ['capsule', 'probe', 'cminer']; // logistique éphémère : jamais liée

// v13 — le Collectif : graphe de mutation (qui peut devenir quoi).
// t = durée de la mutation, pendant laquelle l'entité est INERTE ET VULNÉRABLE
// (le langage du jeu : tout passe par des fenêtres exposées). `cost` arrivera
// avec l'économie propre de la faction (v14).
// v15.8 : le graphe n'est plus une étoile autour de l'Essaim — les formes de
// tier 2 se reconfigurent LATÉRALEMENT (un Bastion devient Épine sans repasser
// par la cellule-souche), et toute forme sait redescendre vers l'Essaim.
const MUTATIONS = {
  h_essaim:    { vers: ['h_bastion', 'h_recolteur', 'h_epine', 'h_traqueur', 'h_entrepot', 'h_synapse', 'h_couveuse'], t: 6 },
  h_bastion:   { vers: ['h_essaim', 'h_epine'], t: 8 },
  h_recolteur: { vers: ['h_essaim', 'h_bastion', 'h_traqueur'], t: 5 },
  h_epine:     { vers: ['h_essaim', 'h_bastion'], t: 6 },
  h_traqueur:  { vers: ['h_essaim', 'h_recolteur'], t: 4 },
  h_entrepot:  { vers: ['h_essaim', 'h_couveuse'], t: 8 },
  h_synapse:   { vers: ['h_essaim', 'h_entrepot'], t: 5 },
  // le palier supérieur peut toujours se dissoudre en cellule-souche
  h_couveuse:  { vers: ['h_essaim', 'h_entrepot'], t: 9 },
  h_matrice:   { vers: ['h_essaim'], t: 10 },
  h_colosse:   { vers: ['h_essaim'], t: 10 },
  h_dard:      { vers: ['h_essaim'], t: 8 },
  h_nuee:      { vers: ['h_essaim'], t: 5 },
};
// v15.8 — FUSION : deux corps de tier 2 en donnent un seul, de tier 3. La forme
// à fusionner doit être à moins de FUSION_RANGE ; les deux entités deviennent
// inertes, le second se dissout dans le premier, qui se reconfigure.
const FUSIONS = {
  h_colosse: { de: ['h_bastion', 'h_bastion'],   t: 12, cost: { m: 140, e: 70 } },
  h_dard:    { de: ['h_epine', 'h_epine'],       t: 10, cost: { m: 160, e: 90 } },
  h_nuee:    { de: ['h_traqueur', 'h_traqueur'], t: 6,  cost: { m: 50, e: 30 } },
  h_matrice: { de: ['h_synapse', 'h_entrepot'],  t: 14, cost: { m: 120, e: 80 } },
};
const FUSION_RANGE = 400;
const COUVEUSE_DELAI = 22;   // secondes entre deux Essaims pondus
const COUVEUSE_MAX = 4;      // couvain vivant entretenu par Couveuse
const MATRICE_SOIN = 2;      // PV/s rendus aux formes proches
const MATRICE_RAYON = 280;
const HIVE_STATIC = ['h_bastion', 'h_entrepot', 'h_synapse', 'h_couveuse', 'h_matrice']; // bâtiments : ne se font pas pousser
const HIVE_PASSIVE = ['h_entrepot', 'h_synapse', 'h_couveuse', 'h_matrice']; // bâtiments sans arme : pas de comportement de combat
const HIVE_BUILDINGS = ['h_couveuse', 'h_matrice']; // …mais ceux-là ont une activité propre
const HIVE_LEASH = 520;    // laisse de combat autour du nid (Collective sauvage)
const AI_NESTS = [{ x: 5600, y: 700 }, { x: 4900, y: 1500 }, { x: 5300, y: 2400 }]; // nids de le Collectif adverse (NE)

// v14 — le Collectif JOUABLE : coûts payés seulement par le joueur
// (la poche sauvage mute gratuitement). Croissance par DIVISION : toute
// entité peut se scinder et produire un Essaim, forme de base à re-muter.
const HIVE_COSTS = {
  h_essaim: { m: 0, e: 0 },        // régresser vers l'Essaim est gratuit
  h_bastion: { m: 60, e: 25 },
  // v15.6 : le Récolteur récolte LES DEUX ressources — la règle d'anti-blocage
  // ne peut pencher d'aucun côté, alors il ne coûte rien. Le Collectif ne paie
  // pas sa récolte, elle paie sa croissance (la division).
  h_recolteur: { m: 0, e: 0 },
  h_epine: { m: 90, e: 40 },
  h_traqueur: { m: 25, e: 10 },
  h_entrepot: { m: 50, e: 15 },
  h_synapse: { m: 45, e: 30 },
  // v15.8 : la Couveuse s'obtient par évolution, les autres par fusion (leur
  // coût vit dans FUSIONS mais on le réplique ici pour l'affichage du panneau)
  h_couveuse: { m: 110, e: 60 },
  h_matrice: { m: 120, e: 80 },
  h_colosse: { m: 140, e: 70 },
  h_dard: { m: 160, e: 90 },
  h_nuee: { m: 50, e: 30 },
};
const DIVIDE_COST = { m: 50, e: 10 };
const DIVIDE_TIME = 6;
// v14.2 — la récolte du Collectif est ACTIVE : le Récolteur remplit sa
// cargaison (métal sur astéroïde, énergie dans un champ de radiation) puis
// la PORTE à un Entrepôt. Pas d'Entrepôt vivant = pas de revenu.
const RECOLT_RATE = 3.5;  // ◆/s forés (consomme le stock)
const RECOLT_RAD = 4;     // ⚡/s × intensité captés dans le champ
const RECOLT_CAP = 30;    // cargaison avant livraison

/* ===== état ===== */
let state = 'intro';     // intro | playing | won | lost
let faction = 'arche';   // v14 : faction jouée — 'arche' (centralisée) | 'collective' (décentralisée)
let foe = 'collective';  // v15 : l'IA joue la faction NON choisie
let paused = false;
let gameT = 0;
let metal = 300, energy = 80;
let metalMined = 0, mRateSample = { t: 0, mined: 0, rate: 0 };
let kills = 0, losses = 0, capsLost = 0;
// v15.1 : la jauge d'hostilité/virulence escaladante est retirée — l'IA tourne à
// une intensité FIXE (ex-`aiProg`). Plus de vagues, plus de barre, plus d'escalade.
const aiProg = 45;

const mods = { hangar: 1, forage: 1, collecteur: 1, canon: 0, bouclier: 0, propulsion: 0 };

let ships = [], structs = [], shots = [], fxs = [], parts = [], asteroids = [], pulsars = [];
let mother = null, aimother = null;
let focusTgt = null;
let follow = false;

const mouse = { x: 0, y: 0, wx: 0, wy: 0 };
const keys = {};
let sel = [];          // unités sélectionnées (drones, mineurs, l'Arche)
let dragStart = null;  // boîte de sélection en cours
let placing = null;    // station en cours de placement ('sentinelle' | 'collectsat')
let moveOrder = null;  // station armée pour relocalisation (attend le clic de destination)
let aMode = false;     // v14.4 : mode attaque (A) — le prochain clic gauche donne l'ordre
const groups = {};     // groupes de contrôle 1-9
let lastClick = { t: 0, kind: null };   // détection du double-clic
let lastGroup = { t: 0, key: null };    // double-rappel = centrer la caméra

/* ===== canvas & caméra ===== */
const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
const mmCv = document.getElementById('minimap');
const mmCtx = mmCv.getContext('2d');
let vw = 0, vh = 0, dpr = 1;
const cam = { x: 760, y: 3460, z: 0.7 };

let stars = [];
function genStars() {
  stars = [];
  for (const [f, n, smax] of [[0.12, 150, 1.1], [0.3, 95, 1.6], [0.6, 55, 2.2]]) {
    for (let i = 0; i < n; i++) {
      // aléa cosmétique obligatoire : le champ d'étoiles dépend de la fenêtre
      stars.push({ x: Math.random() * vw, y: Math.random() * vh, f, s: randVis(0.4, smax), tw: Math.random() * TAU });
    }
  }
}
function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  vw = innerWidth; vh = innerHeight;
  cv.width = vw * dpr; cv.height = vh * dpr;
  cv.style.width = vw + 'px'; cv.style.height = vh + 'px';
  genStars();
}
addEventListener('resize', resize);
resize();

const s2w = (sx, sy) => ({ x: (sx - vw / 2) / cam.z + cam.x, y: (sy - vh / 2) / cam.z + cam.y });
const w2s = (x, y) => ({ x: (x - cam.x) * cam.z + vw / 2, y: (y - cam.y) * cam.z + vh / 2 });

/* ===== sons (WebAudio) ===== */
let actx = null, sndOn = true, lastFireSnd = 0;
function audioInit() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } }
}
function tone(f, dur, type, vol, t0) {
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.value = f;
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(actx.destination);
  o.start(t0); o.stop(t0 + dur);
}
function noiseBurst(dur, vol, t0) {
  const n = Math.floor(actx.sampleRate * dur);
  const buf = actx.createBuffer(1, n, actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = actx.createBufferSource(); src.buffer = buf;
  const g = actx.createGain(); g.gain.value = vol;
  src.connect(g); g.connect(actx.destination); src.start(t0);
}
function sfx(type) {
  if (!sndOn || !actx) return;
  const t = actx.currentTime;
  switch (type) {
    case 'fire':
      if (t - lastFireSnd < 0.07) return;
      lastFireSnd = t;
      tone(randVis(650, 880), 0.05, 'square', 0.018, t); break;
    case 'cannon': tone(180, 0.18, 'sawtooth', 0.06, t); tone(90, 0.25, 'square', 0.05, t); break;
    case 'boom': noiseBurst(0.22, 0.1, t); break;
    case 'bigboom': noiseBurst(0.6, 0.2, t); tone(58, 0.5, 'sawtooth', 0.1, t); break;
    case 'alarm':
      for (let i = 0; i < 3; i++) { tone(440, 0.16, 'square', 0.05, t + i * 0.42); tone(312, 0.16, 'square', 0.05, t + i * 0.42 + 0.2); }
      break;
    case 'done': tone(520, 0.07, 'sine', 0.05, t); tone(780, 0.09, 'sine', 0.05, t + 0.08); break;
    case 'place': tone(300, 0.08, 'triangle', 0.06, t); tone(440, 0.1, 'triangle', 0.05, t + 0.07); break;
    case 'deposit': tone(620, 0.04, 'sine', 0.03, t); tone(920, 0.05, 'sine', 0.025, t + 0.04); break;
    case 'click': tone(900, 0.03, 'square', 0.025, t); break;
    case 'nope': tone(160, 0.12, 'square', 0.05, t); break;
    case 'taunt': tone(98, 0.9, 'sawtooth', 0.06, t); tone(102, 0.9, 'sawtooth', 0.06, t); break;
  }
}

/* ===== fabrique d'entités ===== */
function addStruct(kind, side, x, y) {
  const d = STRUCTS[kind];
  const st = { id: idSeq++, kind, side, x, y, hp: d.hp, maxHp: d.hp, r: d.r, cool: rand(0, 0.5), flash: 0, rot: rand(0, TAU), aim: 0 };
  if (kind === 'gate') st.guardT = rand(0, 10);
  // Station Spatiale : niveaux (station + chantier), file de production, ralliement
  if (kind === 'spatiale') { st.lvl = 1; st.yard = 1; st.queue = []; st.rally = null; }
  if (linksToCore(st)) st.core = nearestCore(st).core; // v12 : lié à son core de production
  structs.push(st);
  return st;
}
function addShip(kind, side, x, y, order) {
  const d = SHIPS[kind];
  const s = { id: idSeq++, kind, side, x, y, hp: d.hp, maxHp: d.hp, r: d.r, cool: rand(0, 0.4), flash: 0, ang: rand(0, TAU), order: order || { type: 'idle' }, tgt: null, scanT: rand(0, 0.3), orbit: rand(0, TAU) };
  if (kind === 'miner') { s.task = 'seek'; s.ast = null; s.mineT = 0; s.cargo = 0; }
  if (kind === 'h_recolteur') { s.task = 'seek'; s.ast = null; }
  if (linksToCore(s)) s.core = nearestCore(s).core; // v12 : lié à son core de production
  ships.push(s);
  return s;
}
// v15.5 : un astéroïde DÉRIVE — cap et vitesse propres, rotation animée. `dead`
// permet de le retirer proprement après une collision (les mineurs qui le
// visaient retombent sur le test `stock <= 0` et repartent en quête).
function addAsteroid(x, y, r, stock, vx, vy) {
  const verts = [];
  for (let i = 0; i < 9; i++) verts.push(r * rand(0.72, 1.18));
  const a = rand(0, TAU), sp = rand(AST_DRIFT[0], AST_DRIFT[1]);
  asteroids.push({
    id: idSeq++, x, y, r, verts, rot: rand(0, TAU), spin: rand(-0.25, 0.25), stock, maxStock: stock,
    vx: vx === undefined ? Math.cos(a) * sp : vx,
    vy: vy === undefined ? Math.sin(a) * sp : vy,
    dead: false,
  });
}
function addPulsar(x, y, r, power) {
  pulsars.push({ x, y, r, power, ph: rand(0, TAU) });
}

/* ===== monde initial ===== */
function initWorld() {
  // v14 : la faction centralisée joue l'Arche ; le Collectif n'a pas de core du tout
  mother = faction === 'arche' ? {
    id: idSeq++, kind: 'mother', side: 'player', x: 760, y: 3460, r: 38,
    hp: 3200, maxHp: 3200, shield: 0, shieldMax: 0,
    ang: -0.6, dest: null, flash: 0, shieldFlash: 0,
    cool: 0, hangarT: 2, forgeT: 2, dead: false
  } : null;

  // pulsars — champs de radiation (énergie)
  addPulsar(1150, 3350, 700, 0.8);   // faible, couvre la zone de départ
  addPulsar(2950, 2300, 650, 1.0);   // contesté
  addPulsar(4650, 3450, 600, 1.0);   // contesté
  addPulsar(5250, 1150, 700, 1.2);   // riche, en plein territoire du Core adverse

  // ceintures d'astéroïdes (stock épuisable)
  // v15.14 : neuf ceintures au lieu de cinq — le secteur avait de vastes vides
  // où rien ne freinait ni ne cachait quoi que ce soit.
  const belts = [
    { x: 850, y: 3650, n: 6, stock: 700, guard: 0 },   // départ
    { x: 2400, y: 2750, n: 7, stock: 1100, guard: 2 },
    { x: 1850, y: 1300, n: 6, stock: 1100, guard: 3 },
    { x: 4300, y: 2950, n: 8, stock: 1400, guard: 3 },
    { x: 5000, y: 2050, n: 6, stock: 1400, guard: 4 },
    { x: 3300, y: 3700, n: 7, stock: 1200, guard: 2 },  // couloir sud
    { x: 1250, y: 2150, n: 5, stock: 900,  guard: 1 },  // flanc ouest
    { x: 5650, y: 3450, n: 6, stock: 1500, guard: 3 },  // sud-est, riche et gardé
    { x: 3750, y: 850,  n: 5, stock: 1300, guard: 2 },  // approche nord
  ];
  for (const b of belts) {
    // v15.5 : une ceinture dérive comme un COURANT — cap commun, jitter léger.
    // Sans cela, des rochers voisins aux caps opposés se percutent en quelques
    // secondes et la ceinture s'auto-détruit avant la première minute.
    const cap = rand(0, TAU), vit = rand(AST_DRIFT[0], AST_DRIFT[1]);
    for (let i = 0; i < b.n; i++) {
      const r = rand(AST_TAILLE[0], AST_TAILLE[1]);
      let x = 0, y = 0;
      // placement sans chevauchement : deux rochers collés exploseraient à t=0.
      // Les ceintures se sont élargies avec la taille des rochers, sinon les
      // essais échouent tous et on repose des blocs les uns sur les autres.
      for (let essai = 0; essai < 24; essai++) {
        const a = rand(0, TAU), dd = rand(140, 520);
        x = b.x + Math.cos(a) * dd; y = b.y + Math.sin(a) * dd;
        if (!asteroids.some(o => dist(o.x, o.y, x, y) < o.r + r + 50)) break;
      }
      const h = cap + rand(-0.12, 0.12), v = vit * rand(0.92, 1.08);
      // le stock suit la masse : un gros rocher vaut le détour
      addAsteroid(x, y, r, b.stock * rand(0.8, 1.2) * (0.6 + r / 60), Math.cos(h) * v, Math.sin(h) * v);
    }
    for (let i = 0; i < b.guard; i++) {
      // gardes de ceinture selon la faction adverse
      const k = foe === 'collective' ? (i === 0 && b.guard > 2 ? 'h_bastion' : 'h_essaim')
                                     : (i === 0 && b.guard > 2 ? 'raider' : 'drone');
      addShip(k, 'ai', b.x + rand(-90, 90), b.y + rand(-90, 90), { type: 'guard', x: b.x, y: b.y, leash: 620 });
    }
  }
  // v15.14 : récifs isolés — de gros obstacles hors ceinture, presque immobiles.
  // Ils donnent du relief aux traversées : on les contourne ou on ralentit.
  const recifs = [[2950, 1900], [4750, 1250], [2200, 3900], [4950, 3900], [1500, 850], [3450, 2500]];
  for (const [rx, ry] of recifs) {
    const r = rand(AST_RECIF[0], AST_RECIF[1]);
    const x = rx + rand(-180, 180), y = ry + rand(-180, 180);
    if (asteroids.some(o => dist(o.x, o.y, x, y) < o.r + r + 60)) continue;
    const a = rand(0, TAU), v = rand(1, 3); // à peine dérivants
    addAsteroid(x, y, r, rand(1600, 2400), Math.cos(a) * v, Math.sin(a) * v);
  }

  // v15.5 : population de référence — le secteur se repeuple après les collisions
  astTarget = asteroids.length;
  astRespawnT = AST_RESPAWN;

  if (foe === 'arche') {
    // v15.7 — L'IA joue le CORE CENTRAL : un QG et ses stations secondaires
    // (deux Relais, une Spatiale). Toutes doivent tomber pour gagner.
    const relais = [[2650, 1750], [4900, 1150]];
    for (const [gx, gy] of relais) {
      const g = addStruct('gate', 'ai', gx, gy);
      addStruct('aiturret', 'ai', gx + rand(-130, 130), gy + 110);
      for (let i = 0; i < RELAIS_GARDE; i++) {
        const s = addShip('drone', 'ai', gx + rand(-90, 90), gy + rand(-90, 90), { type: 'guard', x: gx, y: gy, leash: 650 });
        s.gateId = g.id;
      }
      const rd = addShip('raider', 'ai', gx + rand(-60, 60), gy - 80, { type: 'guard', x: gx, y: gy, leash: 650 });
      rd.gateId = g.id;
    }
    // la station secondaire lourde : chantier et batterie, comme celle du joueur
    const sp = addStruct('spatiale', 'ai', 4150, 2650);
    sp.lvl = 2;
    addStruct('aiturret', 'ai', sp.x + rand(-140, 140), sp.y + 130);
    addStruct('sentinelle', 'ai', sp.x - 120, sp.y - 110);
    for (let i = 0; i < 3; i++) {
      addShip('drone', 'ai', sp.x + rand(-90, 90), sp.y + rand(-90, 90), { type: 'guard', x: sp.x, y: sp.y, leash: 620 });
    }
    aimother = {
      id: idSeq++, kind: 'aimother', side: 'ai', x: 5750, y: 650, r: 50,
      hp: 6500, maxHp: 6500, ang: rand(0, TAU), dest: null,
      flash: 0, cool: rand(0, 1), hangarT: 6, rage: false, dead: false
    };
    for (let i = 0; i < 2; i++) addShip('dread', 'ai', aimother.x + rand(-160, 160), aimother.y + rand(120, 240), { type: 'escort' });
    for (let i = 0; i < 6; i++) addShip('drone', 'ai', aimother.x + rand(-200, 200), aimother.y + rand(-100, 260), { type: 'escort' });
  } else {
    // L'IA joue la faction DÉCENTRALISÉE — le Collectif : des nids qui croissent et essaiment
    aimother = null;
    for (const nest of AI_NESTS) {
      const ent = addShip('h_entrepot', 'ai', nest.x, nest.y); ent.home = nest;
      const sy = addShip('h_synapse', 'ai', nest.x + 60, nest.y - 40); sy.home = nest;
      for (let i = 0; i < 4; i++) { const e = addShip('h_essaim', 'ai', nest.x + rand(-80, 80), nest.y + rand(-80, 80), { type: 'guard', x: nest.x, y: nest.y, leash: 700 }); e.home = nest; }
      const b = addShip('h_bastion', 'ai', nest.x + rand(-50, 50), nest.y + 70, { type: 'guard', x: nest.x, y: nest.y, leash: 700 }); b.home = nest;
    }
  }

  // forces de départ selon la faction jouée
  if (faction === 'arche') {
    for (let i = 0; i < 3; i++) addShip('cdrone', 'player', mother.x + rand(-60, 60), mother.y + rand(-60, 60));
    for (let i = 0; i < 2; i++) addShip('miner', 'player', mother.x + rand(-60, 60), mother.y + rand(-60, 60));
    sel = [mother];
  } else {
    // le Collectif du joueur : un essaim de départ au sud-ouest, aucun core
    const start = { x: 880, y: 3400 };
    const mine = [];
    const sp = (kind, n) => { for (let i = 0; i < n; i++) mine.push(addShip(kind, 'player', start.x + rand(-90, 90), start.y + rand(-90, 90))); };
    sp('h_essaim', 5);
    sp('h_bastion', 1);
    sp('h_recolteur', 3);
    sp('h_entrepot', 1); // sans Entrepôt, les Récolteurs n'ont nulle part où livrer
    sel = mine.filter(u => u.kind === 'h_essaim');
  }

  initFog();
  computeVision();
  fogAcc = 1;
  updateFog(1);

  if (faction === 'arche') {
    log('L\'Arche s\'éveille. L\'ennemi ne l\'a pas encore remarquée.', 'good');
    log('Approchez une ceinture : vos mineurs forent seuls.', '');
    log('Le pulsar voisin alimente votre collecteur en énergie.', '');
  } else {
    log('Le Collectif s\'éveille. Chaque entité est un core : aucune tête à couper.', 'good');
    log('Vos Récolteurs forent et livrent à l\'Entrepôt ; divisez et mutez selon la menace.', '');
  }
  // objectif selon la faction adverse incarnée par l'IA
  if (foe === 'arche') log('Objectif : abattre le CORE CENTRAL adverse — son QG au nord-est ET toutes ses stations secondaires.', 'warn');
  else log('Objectif : ÉRADIQUER le Collectif adverse — ses nids essaiment au nord-est.', 'warn');
}

/* ===== aides ===== */
const cdrones = () => ships.filter(s => s.kind === 'cdrone');
const miners = () => ships.filter(s => s.kind === 'miner');
const spatiale = () => structs.find(s => s.kind === 'spatiale' && s.side === 'player' && !s.dead) || null;
const spatialeExists = () => !!spatiale() || ships.some(s => s.kind === 'probe' && !s.dead && s.carry === 'spatiale');
// base de repli : le QG, sinon la plus grosse station secondaire encore debout
// (v15.7 : un Relais suffit à tenir la logistique quand tout le reste est tombé)
function homeBase() {
  if (mother && !mother.dead) return mother;
  const st = spatiale();
  if (st) return st;
  return structs.find(s => s.side === 'player' && !s.dead && s.kind === 'gate') || null;
}
// v15 : l'IA est-elle encore en vie ? (QG, station ou n'importe quelle entité 'ai')
function aiAlive() {
  if (aimother && !aimother.dead) return true;
  if (ships.some(s => s.side === 'ai' && !s.dead)) return true;
  if (structs.some(s => s.side === 'ai' && !s.dead)) return true;
  return false;
}
// v14 : ce que l'IA traque — la base, ou (Collectif joué, aucun core)
// le centre de gravité des forces du joueur
function playerAnchor() {
  const b = homeBase();
  if (b) return b;
  let n = 0, x = 0, y = 0;
  for (const s of ships) if (s.side === 'player' && !s.dead) { n++; x += s.x; y += s.y; }
  return n ? { x: x / n, y: y / n, r: 0 } : null;
}
/* ===== v12 : le lien au core (faction centralisée) ===== */
const isCore = (e) => e.kind === 'mother' || e.kind === 'aimother' || e.kind === 'spatiale' || e.kind === 'gate';
// le Collectif est décentralisé : chaque entité est son propre mini-core, hors système
// de lien — par FORME (toute entité de MUTATIONS), quel que soit le camp qui la joue
const linksToCore = (e) => e.side !== 'hive' && !MUTATIONS[e.kind] && !isCore(e) && !LINK_EXEMPT.includes(e.kind);
const linkMul = (e) => e.orphan ? ORPHAN_MALUS : 1;
// v15.7 : les deux camps du Core central obéissent à la même règle — le QG et
// TOUTES les stations secondaires (Spatiale, Relais) sont des cores.
function coresOf(side) {
  const list = [];
  const qg = side === 'player' ? mother : aimother;
  if (qg && !qg.dead) list.push(qg);
  for (const s of structs) if (s.side === side && !s.dead && SECOND_KINDS.includes(s.kind)) list.push(s);
  return list;
}
// le Core central de ce camp tient-il encore debout ? (QG ou station secondaire)
const coreStanding = (side) => coresOf(side).length > 0;
function nearestCore(e) {
  let best = null, bd = Infinity;
  for (const c of coresOf(e.side)) {
    const d = dist(e.x, e.y, c.x, c.y);
    if (d < bd) { bd = d; best = c; }
  }
  return { core: best, d: bd };
}
// le lien tient à n'importe quelle distance tant que le core vit ;
// seule la re-liaison après orphelinage exige un core à portée (throttlé)
function updateLink(e, dt) {
  if (!linksToCore(e)) return;
  e.linkT = (e.linkT || 0) - dt;
  if (e.linkT > 0) return;
  e.linkT = rand(0.4, 0.7);
  if (e.core && !e.core.dead) { e.orphan = false; return; }
  const { core, d } = nearestCore(e);
  if (core && d <= LINK_RANGE) { e.core = core; e.orphan = false; }
  else { e.core = null; e.orphan = true; }
}
const cdroneCap = () => 3 * mods.hangar
  + VHANGAR_CAP * ships.reduce((a, s) => a + (s.kind === 'vhangar' && s.docked && !s.dead ? 1 : 0), 0);
const minerCap = () => 2 * mods.forage;
const modLevels = () => MOD_KEYS.reduce((a, k) => a + mods[k], 0);
// l'Arche est une base mobile : lente, et plus lente encore quand ses baies fabriquent
const motherProducing = () =>
  (mother && !!mother.buildQ) ||
  (cdrones().length < cdroneCap() && metal >= CDRONE_COST.m && energy >= CDRONE_COST.e) ||
  (miners().length < minerCap() && metal >= MINER_COST.m && energy >= MINER_COST.e);
const motherSpeed = () => (38 + 10 * mods.propulsion) * (motherProducing() ? 0.55 : 1);

// v15.14 — freinage dans la roche : tout ce qui traverse un astéroïde avance à
// AST_DRAG de sa vitesse. Pas de blocage (aucune recherche de chemin dans le
// jeu : une unité bloquée resterait plantée), mais une ceinture coûte enfin du
// temps à traverser — c'est ce qui en fait du terrain.
function dragAst(e) {
  for (const a of asteroids) {
    // rejet rapide avant le coûteux hypot : on en balaie ~60 par entité et par frame
    if (Math.abs(a.x - e.x) > a.r || Math.abs(a.y - e.y) > a.r) continue;
    if (dist(a.x, a.y, e.x, e.y) < a.r) return AST_DRAG;
  }
  return 1;
}

function intensityAt(x, y) {
  let v = 0;
  for (const p of pulsars) {
    const d = dist(x, y, p.x, p.y);
    if (d < p.r) v = Math.max(v, p.power * (1 - d / p.r));
  }
  return v;
}
// revenu direct : seul le module embarqué alimente l'Arche en continu.
// Les stations collectrices expédient leur récolte par capsules (interceptables).
function energyRate() {
  if (!mother || mother.dead) return 0;
  return 6 * mods.collecteur * intensityAt(mother.x, mother.y);
}

function nearestEnemy(e, range) {
  let best = null, bd = Infinity;
  const test = (s) => {
    if (s.side === e.side || s.dead) return;
    const d = dist(e.x, e.y, s.x, s.y) - (s.r || 0);
    if (d < range && d < bd) { bd = d; best = s; }
  };
  for (const s of ships) test(s);
  for (const s of structs) test(s);
  if (mother && !mother.dead) test(mother);
  if (aimother && !aimother.dead) test(aimother);
  return best;
}
function entityAt(wx, wy) {
  const tol = 10 / cam.z;
  let best = null, bd = Infinity;
  const test = (e) => {
    if (e.dead || e.docked) return; // drone rangé dans l'Arche : non ciblable
    // on ne peut pas cibler ce que le brouillard cache
    if (e.side !== 'player' && !isVisible(e.x, e.y, e.r)) return;
    const d = dist(wx, wy, e.x, e.y) - e.r;
    if (d < tol && d < bd) { bd = d; best = e; }
  };
  for (const s of ships) test(s);
  for (const s of structs) test(s);
  if (mother && !mother.dead) test(mother);
  if (aimother && !aimother.dead) test(aimother);
  return best;
}

/* ===== brouillard de guerre ===== */
const FOG_SCALE = 10;
const fogExp = document.createElement('canvas'); // mémoire d'exploration (persistante)
const fogVis = document.createElement('canvas'); // visibilité actuelle (recalculée)
fogExp.width = fogVis.width = Math.ceil(WORLD.w / FOG_SCALE);
fogExp.height = fogVis.height = Math.ceil(WORLD.h / FOG_SCALE);
const feCtx = fogExp.getContext('2d');
const fvCtx = fogVis.getContext('2d');
const visionSrcs = [];

function visionRadius(e) {
  if (e.kind === 'mother') return 780;
  if (e.kind === 'cdrone') return 380;
  if (e.kind === 'miner') return 300;
  if (e.kind === 'capsule') return 140; // cargo discret
  if (e.kind === 'probe') return 240;
  if (e.kind === 'spatiale') return 560;
  if (e.kind === 'cargo') return 340;
  if (e.kind === 'cminer') return 180;
  if (e.kind === 'corvette') return 380;
  if (e.kind === 'lanceur') return 460; // observateur d'artillerie
  if (e.kind === 'vhangar') return 280;
  if (e.kind === 'h_essaim') return 360;
  if (e.kind === 'h_bastion') return 440;
  if (e.kind === 'h_recolteur') return 300;
  if (e.kind === 'h_epine') return 420;
  if (e.kind === 'h_traqueur') return 520; // l'éclaireur du Collectif
  if (e.kind === 'h_entrepot') return 300;
  if (e.kind === 'h_synapse') return 700;  // le capteur : presque la vision du QG
  if (e.kind === 'h_matrice') return 760;  // v15.8 : la Matrice absorbe la Synapse, elle voit plus loin
  if (e.kind === 'h_couveuse') return 340;
  if (e.kind === 'h_colosse') return 420;
  if (e.kind === 'h_dard') return 500;     // observateur de son propre tir (540)
  if (e.kind === 'h_nuee') return 420;
  // v15.7 : structures récupérées — le Relais est un nœud logistique qui voit
  // loin, la Batterie est son propre observateur d'artillerie
  if (e.kind === 'gate') return 520;
  if (e.kind === 'aiturret') return 500;
  if (e.kind === 'drone') return 320;
  if (e.kind === 'raider') return 340;
  if (e.kind === 'dread') return 420;
  return 420; // stations
}
function computeVision() {
  visionSrcs.length = 0;
  if (mother && !mother.dead) visionSrcs.push({ x: mother.x, y: mother.y, r: visionRadius(mother) });
  for (const s of ships) if (s.side === 'player' && !s.dead) visionSrcs.push({ x: s.x, y: s.y, r: visionRadius(s) });
  for (const st of structs) if (st.side === 'player' && !st.dead) visionSrcs.push({ x: st.x, y: st.y, r: visionRadius(st) });
}
function isVisible(x, y, r = 0) {
  for (const v of visionSrcs) {
    const dx = x - v.x, dy = y - v.y, rr = v.r + r;
    if (dx * dx + dy * dy < rr * rr) return true;
  }
  return false;
}
function initFog() {
  feCtx.globalCompositeOperation = 'source-over';
  feCtx.fillStyle = '#000';
  feCtx.fillRect(0, 0, fogExp.width, fogExp.height);
}
let fogAcc = 1;
function updateFog(dt) {
  fogAcc += dt;
  if (fogAcc < 0.08) return;
  fogAcc = 0;
  fvCtx.globalCompositeOperation = 'source-over';
  fvCtx.fillStyle = '#000';
  fvCtx.fillRect(0, 0, fogVis.width, fogVis.height);
  fvCtx.globalCompositeOperation = 'destination-out';
  feCtx.globalCompositeOperation = 'destination-out';
  for (const v of visionSrcs) {
    const x = v.x / FOG_SCALE, y = v.y / FOG_SCALE, r = v.r / FOG_SCALE;
    for (const c of [fvCtx, feCtx]) {
      const g = c.createRadialGradient(x, y, r * 0.62, x, y, r);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    }
  }
  // les structures statiques adverses restent mémorisées une fois repérées
  for (const st of structs) {
    if (st.side === 'ai' && !st.seen && isVisible(st.x, st.y, st.r + 30)) st.seen = true;
  }
}

/* ===== messages glitchés de l'ennemi ===== */
function showTaunt(txt) {
  const el = document.getElementById('taunt');
  if (!el) return;
  el.textContent = txt;
  el.classList.remove('hidden');
  void el.offsetWidth;
  sfx('taunt');
  clearTimeout(showTaunt._t);
  showTaunt._t = setTimeout(() => el.classList.add('hidden'), 4100);
}

/* ===== représailles (réaction à la perte d'une Station Relais) ===== */
function retaliate() {
  const relais = structs.filter(s => s.kind === 'gate' && s.side === 'ai' && !s.dead);
  if (!relais.length || !homeBase()) return;
  const g = relais[Math.floor(alea() * relais.length)];
  const n = 3 + Math.floor(aiProg / 12);
  for (let i = 0; i < n; i++) {
    addShip('drone', 'ai', g.x + rand(-80, 80), g.y + rand(-80, 80), { type: 'hunt' });
  }
  log('REPRÉSAILLES : ' + n + ' drones lourds en chasse.', 'bad');
}

/* ===== dégâts & morts ===== */
function damage(e, amt) {
  if (e.dead) return;
  if (e === mother && mother.shield > 0) {
    mother.shieldFlash = 0.3;
    if (mother.shield >= amt) { mother.shield -= amt; return; }
    amt -= mother.shield; mother.shield = 0;
  }
  e.hp -= amt; e.flash = 0.12;
  if (e.hp <= 0) { e.dead = true; onDeath(e); }
}
function onDeath(e) {
  const isS = !!STRUCTS[e.kind] || e.kind === 'mother';
  boom(e.x, e.y, e.r * (isS ? 2.4 : 1.7), sideCol(e.side));
  sfx(isS || e.r > 12 ? 'bigboom' : 'boom');
  if (e.side === 'hive') { kills++; if (focusTgt === e) focusTgt = null; return; }
  if (e.side === 'ai') {
    kills++;
    // v15 : Collectif adverse — aucun core, victoire à l'éradication de la dernière entité
    if (foe === 'collective') { if (!aiAlive()) { win(); return; } }
    else {
      // v15.7 : le Core central ne tombe qu'avec son QG ET toutes ses stations
      // secondaires — abattre le QG seul ne suffit plus.
      if (e.kind === 'aimother' || SECOND_KINDS.includes(e.kind)) {
        if (!coreStanding('ai')) { win(); return; }
        const reste = coresOf('ai').length;
        log(entName(e) + ' détruit — il reste ' + reste + (reste > 1 ? ' cores ennemis.' : ' core ennemi.'), 'good');
        if (e.kind === 'gate') retaliate();
        return;
      }
    }
  } else {
    if (e.kind === 'mother') {
      // une station secondaire maintient le signal : la partie continue
      if (coreStanding('player')) {
        log('L\'ARCHE EST DÉTRUITE. Vos stations maintiennent le signal.', 'bad');
        sfx('alarm');
      } else lose();
      return;
    }
    if (SECOND_KINDS.includes(e.kind)) {
      if (!coreStanding('player')) { lose(); return; }
      log(STRUCTS[e.kind].nom + ' détruite.', 'bad');
    }
    else if (e.kind === 'probe') log('Sonde interceptée — ' + (STRUCTS[e.carry] ? STRUCTS[e.carry].nom : 'station') + ' perdue.', 'bad');
    else if (e.kind === 'capsule') { capsLost++; log('Capsule d\'énergie interceptée (−' + e.charge + '⚡).', 'bad'); }
    else if (STRUCTS[e.kind]) log(STRUCTS[e.kind].nom + ' perdue.', 'bad');
    else losses++;
    // v14 : le Collectif n'a pas de core — elle meurt quand sa dernière entité meurt
    if (faction === 'collective' && !ships.some(x => x.side === 'player' && !x.dead)) { lose(); return; }
  }
  if (focusTgt === e) focusTgt = null;
}

/* ===== mise à jour : structures ===== */
function updateStruct(st, dt) {
  st.flash = Math.max(0, st.flash - dt);
  st.rot += dt * (st.kind === 'gate' ? 0.9 : 0.3);
  const d = STRUCTS[st.kind];

  // chantier : la station est inerte tant qu'elle n'est pas terminée.
  // La coque monte progressivement, mais les dégâts subis persistent.
  if (st.build) {
    st.build.t += dt;
    st.hp = Math.min(st.maxHp, st.hp + st.maxHp * 0.65 * dt / st.build.total);
    if (st.build.t >= st.build.total) {
      st.build = null;
      log(d.nom + ' opérationnelle.', 'good');
      sfx('done');
    }
    return;
  }

  // relocalisation : repli → transit → déploiement (station inerte pendant tout le cycle)
  if (st.mob) {
    const mb = st.mob;
    if (mb.phase === 'pack') {
      mb.t += dt;
      if (mb.t >= mb.total) mb.phase = 'move';
    } else if (mb.phase === 'move') {
      const sp = mobSpec(st).sp;
      const dd = dist(st.x, st.y, mb.dest.x, mb.dest.y);
      if (dd < 8) { mb.phase = 'unpack'; mb.t = 0; mb.total = mobSpec(st).t; }
      else {
        const a = Math.atan2(mb.dest.y - st.y, mb.dest.x - st.x);
        st.x += Math.cos(a) * sp * dt;
        st.y += Math.sin(a) * sp * dt;
        if (Math.random() < 0.3) {
          parts.push({ x: st.x - Math.cos(a) * (st.r + 4), y: st.y - Math.sin(a) * (st.r + 4),
            vx: -Math.cos(a) * 30, vy: -Math.sin(a) * 30, life: randVis(0.2, 0.5), color: COL.p });
        }
      }
    } else { // unpack
      mb.t += dt;
      if (mb.t >= mb.total) {
        st.mob = null;
        deployFx(st.x, st.y, st.kind === 'spatiale');
        log(d.nom + ' redéployée.', 'good');
        sfx('place');
      }
    }
    return;
  }

  // Station Spatiale : amélioration et reconstruction de l'Arche (reste active pendant)
  if (st.kind === 'spatiale') {
    if (st.up) {
      st.up.t += dt;
      if (st.up.t >= st.up.total) {
        st.up = null;
        st.lvl++;
        st.maxHp += 1200; st.hp += 1200;
        log('Station Spatiale → niveau ' + st.lvl + '.', 'good');
        sfx('done');
      }
    }
    if (st.rebuild) {
      st.rebuild.t += dt;
      if (st.rebuild.t >= st.rebuild.total) {
        st.rebuild = null;
        respawnMother(st);
      }
    }
    // v15.2 : extension du chantier naval (lignes de production supplémentaires)
    if (st.yardUp) {
      st.yardUp.t += dt;
      if (st.yardUp.t >= st.yardUp.total) {
        st.yardUp = null;
        st.yard = yardLvl(st) + 1;
        const sp = yardSpec(st);
        log('Chantier naval → niveau ' + st.yard + ' : ' + sp.lines + ' lignes, file ' + sp.cap + '.', 'good');
        sfx('done');
      }
    }
    // chantier naval : file de production — les `lines` premières commandes
    // avancent EN PARALLÈLE, à la cadence du niveau de chantier
    if (st.queue && st.queue.length) {
      const spec = yardSpec(st);
      const n = Math.min(spec.lines, st.queue.length);
      const finis = [];
      for (let i = 0; i < n; i++) {
        const q = st.queue[i];
        q.t += dt * spec.spd;
        if (q.t >= q.total) finis.push(q);
      }
      for (const q of finis) {
        st.queue.splice(st.queue.indexOf(q), 1);
        launchStationShip(st, q.kind);
      }
    }
  }

  if (d.dmg) {
    st.cool -= dt;
    if (st.cool <= 0) {
      const t = nearestEnemy(st, d.range);
      if (t) {
        st.aim = Math.atan2(t.y - st.y, t.x - st.x);
        // la Station Spatiale frappe plus fort à chaque niveau
        fireShot(st, t, st.kind === 'spatiale' ? { ...d, dmg: d.dmg * (st.lvl || 1) } : d);
        st.cool = d.cd / linkMul(st);
      }
    }
  }
  // la collectrice accumule sa récolte puis l'expédie en capsule vers l'Arche
  if (st.kind === 'collectsat' && st.side === 'player') {
    st.buf = (st.buf || 0) + STRUCTS.collectsat.rate * intensityAt(st.x, st.y) * linkMul(st) * dt;
    if (st.buf >= CAPSULE_CHARGE && homeBase()) {
      st.buf -= CAPSULE_CHARGE;
      const c = addShip('capsule', 'player', st.x + rand(-10, 10), st.y + st.r + 10);
      c.charge = CAPSULE_CHARGE;
    }
  }
  // v15.7 — Station Relais : l'anneau de distorsion matérialise et entretient une
  // garnison gratuite, pour les DEUX camps. Les gardes restent liés au relais.
  if (st.kind === 'gate') {
    st.guardT += dt;
    if (st.guardT > RELAIS_DELAI) {
      st.guardT = 0;
      const guards = ships.reduce((a, s) => a + (s.gateId === st.id && !s.dead ? 1 : 0), 0);
      if (guards < RELAIS_GARDE) {
        const g = addShip('drone', st.side, st.x + rand(-70, 70), st.y + rand(-70, 70),
          { type: 'guard', x: st.x, y: st.y, leash: 650 });
        g.gateId = st.id;
        spark(g.x, g.y, sideCol(st.side));
      }
    }
  }
}

/* ===== mise à jour : vaisseaux ennemis ===== */
function updateEnemy(s, dt) {
  const d = SHIPS[s.kind];
  s.cool -= dt; s.flash = Math.max(0, s.flash - dt); s.scanT -= dt;
  const o = s.order;
  let tgt = null;

  // raid : cible assignée (station du joueur), poursuivie sans laisse
  if (o.type === 'attack') {
    if (o.target && !o.target.dead) tgt = o.target;
    else s.order = { type: 'hunt' };
  }
  if (!tgt) {
    if (s.tgt && s.tgt.dead) s.tgt = null;
    if (!s.tgt && s.scanT <= 0) {
      s.scanT = rand(0.15, 0.35);
      s.tgt = nearestEnemy(s, 300);
    }
    tgt = s.tgt;
  }
  if (tgt && o.type === 'guard' && dist(s.x, s.y, o.x, o.y) > (o.leash || 650)) {
    tgt = null; s.tgt = null;
  }
  if (tgt && o.type === 'escort' && aimother && !aimother.dead && dist(s.x, s.y, aimother.x, aimother.y) > 620) {
    tgt = null; s.tgt = null;
  }

  let mx = null, my = null;
  if (tgt) {
    const dd = dist(s.x, s.y, tgt.x, tgt.y) - (tgt.r || 0);
    s.ang = Math.atan2(tgt.y - s.y, tgt.x - s.x);
    if (dd <= d.range) {
      if (s.cool <= 0) { fireShot(s, tgt, d); s.cool = d.cd * rand(0.9, 1.1) / linkMul(s); }
    } else { mx = tgt.x; my = tgt.y; }
  } else if (o.type === 'hunt') {
    const base = playerAnchor();
    if (base) { mx = base.x; my = base.y; }
  } else if (o.type === 'guard') {
    if (dist(s.x, s.y, o.x, o.y) > 70) { mx = o.x; my = o.y; }
  } else if (o.type === 'escort') {
    if (aimother && !aimother.dead && dist(s.x, s.y, aimother.x, aimother.y) > aimother.r + 130) {
      mx = aimother.x; my = aimother.y;
    }
  }

  if (mx !== null) {
    const a = Math.atan2(my - s.y, mx - s.x);
    s.ang = a;
    s.x += Math.cos(a) * d.speed * linkMul(s) * dragAst(s) * dt;
    s.y += Math.sin(a) * d.speed * linkMul(s) * dragAst(s) * dt;
  }
  s.x = clamp(s.x, 20, WORLD.w - 20);
  s.y = clamp(s.y, 20, WORLD.h - 20);
}

/* ===== v13 : le Collectif — mutation et comportement de nid ===== */
function startMutation(s, to, dejaPaye) {
  const def = MUTATIONS[s.kind];
  if (!def || s.mut || s.dead || !def.vers.includes(to) || !SHIPS[to]) return false;
  if (s.side === 'player' && !dejaPaye) { // v14 : le joueur paie ses mutations, la poche sauvage non
    const c = HIVE_COSTS[to] || { m: 0, e: 0 };
    if (metal < c.m || energy < c.e) { log('Mutation : ressources insuffisantes (' + coutTxt(c) + ').', 'warn'); sfx('nope'); return false; }
    metal -= c.m; energy -= c.e;
  }
  s.mut = { to, t: 0, total: def.t };
  s.tgt = null;
  return true;
}
// v14 : division — seul l'ESSAIM (la cellule-souche) peut se scinder
function startDivision(s) {
  if (s.dead || s.mut || s.kind !== 'h_essaim') return false;
  if (s.side === 'player') {
    if (metal < DIVIDE_COST.m || energy < DIVIDE_COST.e) { log('Division : ressources insuffisantes (' + coutTxt(DIVIDE_COST) + ').', 'warn'); sfx('nope'); return false; }
    metal -= DIVIDE_COST.m; energy -= DIVIDE_COST.e;
  }
  s.mut = { to: 'h_essaim', div: true, t: 0, total: DIVIDE_TIME };
  s.tgt = null;
  return true;
}
/* ===== v15.15 : placer les bâtiments du Collectif ===== */
// Une métamorphose en BÂTIMENT (formes de HIVE_STATIC) ne se fait plus sur
// place : le joueur choisit l'emplacement, la cellule s'y rend, puis mute. Le
// bâtiment était jusqu'ici prisonnier de la position exacte de l'unité, ce qui
// obligeait à la déplacer d'abord — deux gestes pour une décision.
// La cellule reste MOBILE pendant le trajet : le coût est payé au moment du
// placement (comme la sonde du Core central), donc annuler rembourse.
let hivePlacing = null;   // { key } — métamorphose en attente d'un emplacement
// un bâtiment ne se pose pas sur un rocher, une station ou un autre bâtiment
function hiveSpotFree(x, y, r) {
  if (!spotFree(x, y, r, null)) return false;
  return !ships.some(o => !o.dead && HIVE_STATIC.includes(o.kind) && dist(o.x, o.y, x, y) < o.r + r + 10);
}
// une forme statique demande un emplacement… sauf si le corps est déjà ancré
// (un Entrepôt qui devient Couveuse ne peut pas se déplacer : mutation sur place)
const besoinPlacement = (u, key) => HIVE_STATIC.includes(key) && (SHIPS[u.kind] || {}).speed > 0;
function setHivePlacing(key) {
  hivePlacing = key ? { key } : null;
  if (hivePlacing) {
    setPlacing(null);
    moveOrder = null;
    log(SHIPS[key].nom + ' : choisissez l\'emplacement (clic), clic droit pour annuler.', '');
  }
}
// la cellule éligible la plus proche du point visé : on clique où l'on veut le
// bâtiment, c'est la cellule la mieux placée qui s'y rend
function celluleLaPlusProche(key, x, y) {
  let best = null, bd = Infinity;
  for (const u of sel) {
    if (u.side !== 'player' || u.dead || u.mut || u.fus || u.batir) continue;
    if (!MUTATIONS[u.kind] || !MUTATIONS[u.kind].vers.includes(key)) continue;
    if (!besoinPlacement(u, key)) continue;
    const d = dist(u.x, u.y, x, y);
    if (d < bd) { bd = d; best = u; }
  }
  return best;
}
function confirmerHivePlacing(x, y, enchainer) { // geste local : quelle cellule y va
  const key = hivePlacing.key;
  const d = SHIPS[key];
  const u = celluleLaPlusProche(key, x, y);
  if (!u) { log('Aucune cellule sélectionnée ne peut devenir ' + d.nom + '.', 'warn'); sfx('nope'); return; }
  emettre({ t: 'batir', id: idDe(u), key, x, y });
  if (!enchainer) setHivePlacing(null);
}
/** Mise en route effective (les deux clients) : la cellule part bâtir. */
function batirLocal(id, key, x, y) {
  const u = parId(id);
  const d = SHIPS[key];
  if (!u || u.dead || !d) return;
  if (!hiveSpotFree(x, y, d.r)) { log('Emplacement obstrué.', 'warn'); sfx('nope'); return; }
  const c = HIVE_COSTS[key] || { m: 0, e: 0 };
  if (metal < c.m || energy < c.e) { log('Ressources insuffisantes (' + coutTxt(c) + ').', 'warn'); sfx('nope'); return; }
  metal -= c.m; energy -= c.e;   // payé au placement, remboursé si l'ordre est annulé
  u.batir = { key, x: clamp(x, 40, WORLD.w - 40), y: clamp(y, 40, WORLD.h - 40), cout: c };
  u.tgt = null;
  clearQueue(u);
  log(d.nom + ' : la cellule rejoint le site.', '');
  sfx('click');
}
// annulation d'un chantier en route : la mise est rendue
function annulerBatir(u, motif) {
  if (!u || !u.batir) return;
  const c = u.batir.cout || { m: 0, e: 0 };
  metal += c.m; energy += c.e;
  u.batir = null;
  if (motif) log(motif, 'warn');
}
// trajet puis métamorphose sur site (l'unité est mobile, donc vulnérable)
function updateHiveBuild(s, dt) {
  const b = s.batir;
  s.flash = Math.max(0, s.flash - dt);
  const d = SHIPS[s.kind];
  const dd = dist(s.x, s.y, b.x, b.y);
  if (dd > 22) {
    if (!d.speed) { annulerBatir(s, SHIPS[b.key].nom + ' : cette forme ne peut plus se déplacer.'); return; }
    const a = Math.atan2(b.y - s.y, b.x - s.x);
    s.ang = a;
    const v = d.speed * linkMul(s) * dragAst(s);
    s.x += Math.cos(a) * v * dt;
    s.y += Math.sin(a) * v * dt;
    return;
  }
  // arrivé : le site peut avoir été occupé entre-temps (les rochers dérivent)
  if (!hiveSpotFree(s.x, s.y, SHIPS[b.key].r)) {
    annulerBatir(s, SHIPS[b.key].nom + ' : le site est devenu inutilisable, mise rendue.');
    return;
  }
  const key = b.key;
  s.batir = null;
  startMutation(s, key, true); // déjà payé au placement
}

/* ===== v15.8 : la FUSION — deux corps, une forme supérieure ===== */
// `a` est l'hôte (il se reconfigure), `b` se dissout dedans. Les deux sont
// inertes pendant le cycle : une fusion est une fenêtre exposée, comme la mutation.
function startFusion(a, b, to) {
  const def = FUSIONS[to];
  if (!def || !a || !b || a === b || a.dead || b.dead || a.mut || b.mut || a.fus || b.fus) return false;
  if (a.side !== b.side) return false;
  if (dist(a.x, a.y, b.x, b.y) > FUSION_RANGE) {
    log('Fusion : les deux formes sont trop éloignées (' + FUSION_RANGE + ').', 'warn');
    sfx('nope'); return false;
  }
  if (a.side === 'player') {
    const c = def.cost;
    if (metal < c.m || energy < c.e) { log('Fusion : ressources insuffisantes (' + coutTxt(c) + ').', 'warn'); sfx('nope'); return false; }
    metal -= c.m; energy -= c.e;
  }
  a.fus = { to, mate: b, t: 0, total: def.t };
  b.fus = { host: a };
  a.tgt = null; b.tgt = null;
  return true;
}
// paires éligibles dans une sélection, pour une fusion donnée
function pairesFusion(units, to) {
  const def = FUSIONS[to];
  if (!def) return [];
  const libres = units.filter(u => !u.dead && !u.mut && !u.fus);
  const paires = [];
  const pris = new Set();
  const [k1, k2] = def.de;
  for (const a of libres) {
    if (pris.has(a) || a.kind !== k1) continue;
    // le partenaire le plus proche, à portée de fusion
    let best = null, bd = FUSION_RANGE;
    for (const b of libres) {
      if (b === a || pris.has(b) || b.kind !== k2) continue;
      const d = dist(a.x, a.y, b.x, b.y);
      if (d <= bd) { bd = d; best = b; }
    }
    if (best) { paires.push([a, best]); pris.add(a); pris.add(best); }
  }
  return paires;
}
function updateFusion(s, dt) {
  const f = s.fus;
  if (f.host) { // le corps absorbé : inerte, il attend d'être dissous
    if (f.host.dead || !f.host.fus) s.fus = null;
    return;
  }
  const b = f.mate;
  if (!b || b.dead || b.fus !== undefined && b.fus === null) { // partenaire perdu : la fusion avorte
    s.fus = null;
    log('Fusion interrompue : le corps partenaire a été détruit.', 'warn');
    return;
  }
  f.t += dt;
  // le partenaire se déverse dans l'hôte : filaments de matière
  if (Math.random() < 0.5) {
    const k = randVis(0, 1);
    parts.push({ x: b.x + (s.x - b.x) * k, y: b.y + (s.y - b.y) * k,
      vx: (s.x - b.x) * 0.35, vy: (s.y - b.y) * 0.35, life: randVis(0.2, 0.5), color: COL.h });
  }
  if (f.t < f.total) return;
  // absorption : le partenaire disparaît sans compter comme une perte
  b.fus = null;
  b.dead = true;
  spark(b.x, b.y, COL.h);
  const to = f.to;
  s.fus = null;
  s.mut = { to, t: 0, total: 0.35 }; // brève reconfiguration finale
  if (isVisible(s.x, s.y, s.r)) sfx('done');
  if (s.side === 'player') log('Fusion : ' + SHIPS[to].nom + ' constitué.', 'good');
}

/* ===== v15.8 : les bâtiments actifs du Collectif ===== */
function updateHiveBuilding(s, dt) {
  s.flash = Math.max(0, s.flash - dt);
  if (s.kind === 'h_couveuse') {
    // la Couveuse pond des Essaims gratuits, plafonnés à son couvain vivant
    s.covT = (s.covT || 0) - dt;
    if (s.covT <= 0) {
      const couvain = ships.reduce((a, o) => a + (o.nid === s.id && !o.dead ? 1 : 0), 0);
      s.covT = COUVEUSE_DELAI;
      if (couvain < COUVEUSE_MAX) {
        const n = addShip('h_essaim', s.side, s.x + rand(-26, 26), s.y + rand(-26, 26));
        n.nid = s.id;
        n.home = s.home;
        n.order = s.side === 'player' ? { type: 'guard', x: n.x, y: n.y }
          : { type: 'guard', x: s.x, y: s.y, leash: 700 };
        spark(n.x, n.y, COL.h);
      }
    }
  } else if (s.kind === 'h_matrice') {
    // la Matrice répare le réseau autour d'elle — le Core central n'a pas d'équivalent
    s.soinT = (s.soinT || 0) - dt;
    if (s.soinT <= 0) {
      s.soinT = 0.5;
      for (const o of ships) {
        if (o.side !== s.side || o.dead || !MUTATIONS[o.kind] || o === s) continue;
        if (o.hp >= o.maxHp || dist(o.x, o.y, s.x, s.y) > MATRICE_RAYON) continue;
        o.hp = Math.min(o.maxHp, o.hp + MATRICE_SOIN * 0.5);
        if (Math.random() < 0.15) spark(o.x, o.y, COL.h);
      }
    }
  }
}

// avance une mutation ou une division (l'entité est inerte pendant le cycle)
function updateMutation(s, dt) {
  s.mut.t += dt;
  if (s.mut.t < s.mut.total) return;
  if (s.mut.div) {
    s.mut = null;
    const n = addShip('h_essaim', s.side, s.x + rand(-16, 16), s.y + rand(-16, 16));
    n.home = s.home;
    // l'essaim neuf garde sa position (joueur) ou son nid (IA)
    if (s.side === 'player') n.order = { type: 'guard', x: n.x, y: n.y };
    else if (n.home) n.order = { type: 'guard', x: n.home.x, y: n.home.y, leash: 700 };
    spark(s.x, s.y, sideCol(s.side));
    if (isVisible(s.x, s.y, s.r)) sfx('done');
  } else {
    finishMutation(s);
  }
}
function finishMutation(s) {
  const to = s.mut.to, nd = SHIPS[to];
  const hpk = clamp(s.hp / s.maxHp, 0.05, 1); // la coque suit en proportion : les dégâts persistent
  s.kind = to;
  s.maxHp = nd.hp;
  s.hp = Math.max(1, nd.hp * hpk);
  s.r = nd.r;
  s.cool = rand(0, 0.4);
  s.tgt = null;
  s.mut = null;
  spark(s.x, s.y, COL.h);
  if (isVisible(s.x, s.y, s.r)) sfx('place');
}
function updateHive(s, dt) {
  const d = SHIPS[s.kind];
  if (!s.home) s.home = { x: s.x, y: s.y }; // sécurité : tout membre a un nid
  s.cool -= dt; s.flash = Math.max(0, s.flash - dt); s.scanT -= dt;

  // mutation en cours : inerte et vulnérable, c'est la contrepartie de la fluidité
  if (s.mut) { updateMutation(s, dt); return; }

  // ciblage générique : le Collectif est hostile à tout ce qui n'est pas elle
  if (s.tgt && s.tgt.dead) s.tgt = null;
  if (d.dmg && !s.tgt && s.scanT <= 0) {
    s.scanT = rand(0.2, 0.4);
    const cand = nearestEnemy(s, d.range + 80);
    if (cand && dist(cand.x, cand.y, s.home.x, s.home.y) < HIVE_LEASH) s.tgt = cand;
  }

  let mx = null, my = null;
  if (s.tgt && d.dmg) {
    const dd = dist(s.x, s.y, s.tgt.x, s.tgt.y) - (s.tgt.r || 0);
    s.ang = Math.atan2(s.tgt.y - s.y, s.tgt.x - s.x);
    if (dd <= d.range) {
      if (s.cool <= 0) { fireShot(s, s.tgt, d); s.cool = d.cd * rand(0.9, 1.1); }
    } else if (d.speed) { mx = s.tgt.x; my = s.tgt.y; }
  } else if (s.kind === 'h_recolteur') {
    // forage symbolique autour du nid (l'économie réelle de la faction arrive au v14)
    if (s.ast && s.ast.stock <= 0) s.ast = null;
    if (!s.ast) {
      let bd = 600;
      for (const a of asteroids) {
        if (a.stock <= 0) continue;
        const da = dist(s.home.x, s.home.y, a.x, a.y);
        if (da < bd) { bd = da; s.ast = a; }
      }
    }
    if (s.ast) {
      if (dist(s.x, s.y, s.ast.x, s.ast.y) > s.ast.r + 14) { mx = s.ast.x; my = s.ast.y; }
      else s.ang = Math.atan2(s.ast.y - s.y, s.ast.x - s.x); // foreuse pointée
    } else if (dist(s.x, s.y, s.home.x, s.home.y) > 70) { mx = s.home.x; my = s.home.y; }
  } else if (d.speed && dist(s.x, s.y, s.home.x, s.home.y) > 110) {
    mx = s.home.x; my = s.home.y; // retour au nid
  }

  if (mx !== null && d.speed) {
    const a = Math.atan2(my - s.y, mx - s.x);
    s.ang = a;
    s.x += Math.cos(a) * d.speed * dragAst(s) * dt;
    s.y += Math.sin(a) * d.speed * dragAst(s) * dt;
  }
  s.x = clamp(s.x, 20, WORLD.w - 20);
  s.y = clamp(s.y, 20, WORLD.h - 20);
}
// v14.2 : Récolteur joué — récolte ACTIVE. Il remplit sa cargaison (métal foré
// ou énergie captée selon où on le poste) puis la livre à l'Entrepôt le plus
// proche. Le revenu n'est crédité qu'à la livraison : un convoi à protéger.
function nearestEntrepot(s) {
  let best = null, bd = Infinity;
  for (const o of ships) {
    // v15.8 : la Matrice hérite du rôle de dépôt de l'Entrepôt qu'elle absorbe
    if ((o.kind !== 'h_entrepot' && o.kind !== 'h_matrice') || o.side !== s.side || o.dead || o.mut) continue;
    const d2 = dist(s.x, s.y, o.x, o.y);
    if (d2 < bd) { bd = d2; best = o; }
  }
  return best;
}
function updateRecolteur(s, dt) {
  const d = SHIPS.h_recolteur;
  s.flash = Math.max(0, s.flash - dt);
  s.load = s.load || 0;
  let mx = null, my = null;

  // cargaison pleine (ou à vider avant de changer de ressource) : porter à l'Entrepôt
  if (s.load > 0 && (s.load >= RECOLT_CAP || s.flush)) {
    const ent = nearestEntrepot(s);
    if (ent) {
      mx = ent.x; my = ent.y;
      if (dist(s.x, s.y, ent.x, ent.y) < ent.r + s.r + 6) {
        if (s.res === 'e') energy += s.load;
        else { metal += s.load; metalMined += s.load; }
        s.load = 0;
        s.flush = false;
        spark(s.x, s.y, s.res === 'e' ? COL.e : COL.amber);
        sfx('deposit');
        mx = null; my = null;
      }
    }
  } else if (s.task === 'goto') {
    mx = s.gotoPos.x; my = s.gotoPos.y;
    if (dist(s.x, s.y, mx, my) < 20) { s.task = 'hold'; s.holdPos = { x: s.x, y: s.y }; mx = null; my = null; }
  } else if (s.task === 'hold') {
    // posté : capte l'énergie si le poste est dans un champ de radiation
    if (s.holdPos && dist(s.x, s.y, s.holdPos.x, s.holdPos.y) > 26) { mx = s.holdPos.x; my = s.holdPos.y; }
    else {
      const ri = intensityAt(s.x, s.y);
      if (ri > 0) {
        if (s.load <= 0) s.res = 'e';
        if (s.res === 'e') s.load = Math.min(RECOLT_CAP, s.load + RECOLT_RAD * ri * dt);
        else s.flush = true; // cargaison de métal : aller la vider d'abord
      }
    }
  } else if (s.task === 'stop') {
    // halte (S) : ne récolte plus, attend un nouvel ordre
  } else { // métal : forer l'astéroïde assigné ou le plus proche
    if (s.ast && (s.ast.dead || s.ast.stock <= 0)) s.ast = null;
    if (!s.ast) {
      let bd = 700;
      for (const a of asteroids) {
        if (a.stock < AST_WORTH) continue; // v15.5 : une veine qui se régénère à peine ne retient personne
        const da = dist(s.x, s.y, a.x, a.y);
        if (da < bd) { bd = da; s.ast = a; }
      }
    }
    if (s.ast) {
      if (dist(s.x, s.y, s.ast.x, s.ast.y) > s.ast.r + 14) { mx = s.ast.x; my = s.ast.y; }
      else {
        s.ang = Math.atan2(s.ast.y - s.y, s.ast.x - s.x);
        if (s.load <= 0) s.res = 'm';
        if (s.res === 'm') {
          const take = Math.min(RECOLT_RATE * dt, s.ast.stock, RECOLT_CAP - s.load);
          s.ast.stock -= take;
          s.load += take;
          if (s.ast.stock <= 0) log('Astéroïde épuisé.', 'warn');
        } else s.flush = true; // cargaison d'énergie : aller la vider d'abord
      }
    }
  }

  if (mx !== null) {
    const a = Math.atan2(my - s.y, mx - s.x);
    s.ang = a;
    s.x += Math.cos(a) * d.speed * dragAst(s) * dt;
    s.y += Math.sin(a) * d.speed * dragAst(s) * dt;
  }
  s.x = clamp(s.x, 20, WORLD.w - 20);
  s.y = clamp(s.y, 20, WORLD.h - 20);
}

// v13 : mutations scriptées du banc d'essai — remplacé à terme par la vraie
// conscience collective (IA adverse qui lit la menace et décide).
let hiveT = 14;
function updateHiveScript(dt) {
  hiveT -= dt;
  if (hiveT > 0) return;
  const pool = ships.filter(s => s.side === 'hive' && !s.dead && !s.mut);
  if (!pool.length) return;
  hiveT = rand(12, 20);
  const s = pool[Math.floor(alea() * pool.length)];
  const vers = MUTATIONS[s.kind].vers;
  const to = vers[Math.floor(alea() * vers.length)];
  if (startMutation(s, to) && isVisible(s.x, s.y, s.r + 40)) {
    log('Le Collectif mute : ' + SHIPS[s.kind].nom + ' → ' + SHIPS[to].nom + '.', 'warn');
  }
}

/* ===== v15 : l'IA Collective — croissance et assauts (foe === 'collective') ===== */
let aiGrowT = 14, aiRaidT = 70;
const aiHiveUnits = () => ships.filter(s => s.side === 'ai' && !s.dead && MUTATIONS[s.kind]);
function nearestAINest(x, y) {
  let best = AI_NESTS[0], bd = Infinity;
  for (const n of AI_NESTS) { const d = dist(x, y, n.x, n.y); if (d < bd) { bd = d; best = n; } }
  return best;
}
function updateAICollective(dt) {
  if (foe !== 'collective') return;
  const mine = aiHiveUnits();

  // croissance : la ruche se réplique et se diversifie, plafond montant avec l'hostilité
  aiGrowT -= dt;
  if (aiGrowT <= 0) {
    aiGrowT = clamp(16 - aiProg * 0.08, 7, 16);
    const cap = 8 + Math.floor(aiProg / 4); // ~8 → 33
    const combat = mine.filter(s => COMBAT_KINDS.includes(s.kind) && !s.mut).length;
    const essaims = mine.filter(s => s.kind === 'h_essaim' && !s.mut && s.order.type !== 'hunt');
    if (essaims.length) {
      const s = essaims[Math.floor(alea() * essaims.length)];
      // assez d'essaims → en durcir un en artillerie/éclaireur (même au plafond) ;
      // sinon, grossir par division tant qu'on est sous le plafond
      if (essaims.length >= 3 && alea() < 0.45) {
        startMutation(s, alea() < 0.6 ? 'h_epine' : 'h_traqueur');
      } else if (combat < cap) {
        startDivision(s);
      }
    }
  }

  // assauts : une partie de la ruche part en chasse vers le joueur, par vagues
  aiRaidT -= dt;
  if (aiRaidT <= 0) {
    aiRaidT = clamp(85 - aiProg * 0.5, 32, 85);
    const idle = mine.filter(s => COMBAT_KINDS.includes(s.kind) && SHIPS[s.kind].speed && s.order.type !== 'hunt' && !s.mut);
    const k = Math.min(idle.length, 3 + Math.floor(aiProg / 9));
    for (let i = 0; i < k; i++) { idle[i].order = { type: 'hunt' }; idle[i].tgt = null; }
    if (k) { log('LE COLLECTIF ESSAIME : ' + k + ' entités en chasse.', 'bad'); sfx('alarm'); }
  }
}

/* ===== mise à jour : drones de combat ===== */
function updateCDrone(s, dt) {
  const d = SHIPS[s.kind];
  s.cool -= dt; s.flash = Math.max(0, s.flash - dt); s.scanT -= dt;
  const base = homeBase();
  // v14.6 : une unité de combat immobile (Bastion, speed 0) ne peut pas honorer
  // un ordre de déplacement — sinon elle reste bloquée en 'move' et cesse de tirer.
  // On le convertit en garde sur place : elle continue de défendre.
  if (!d.speed && (s.order.type === 'move' || s.order.type === 'amove')) {
    s.order = { type: 'guard', x: s.x, y: s.y };
  }
  // les drones de l'Arche orbitent par défaut ; corvettes et lanceurs tiennent leur position
  const idleType = s.kind === 'cdrone' ? 'orbit' : 'guard';
  const o = (!s.order.type || s.order.type === 'idle')
    ? (idleType === 'orbit' ? { type: 'orbit' } : { type: 'guard', x: s.x, y: s.y })
    : s.order;
  let tgt = null;

  // ordre d'attaque explicite : on poursuit la cible, sans laisse
  if (o.type === 'attack') {
    if (o.target && !o.target.dead) tgt = o.target;
    else { s.order = { type: 'orbit' }; }
  }
  // cible verrouillée de l'Arche : prioritaire pour les drones en orbite
  if (!tgt && o.type !== 'attack' && o.type !== 'amove' && o.type !== 'guard' && o.type !== 'move'
      && focusTgt && !focusTgt.dead && base && dist(focusTgt.x, focusTgt.y, base.x, base.y) < 800) {
    tgt = focusTgt;
  }
  if (!tgt) {
    if (s.tgt && s.tgt.dead) s.tgt = null;
    // v14.5 : 'move' (clic droit) = déplacement pur — aucune acquisition en route
    if (!s.tgt && s.scanT <= 0 && o.type !== 'move') {
      s.scanT = rand(0.15, 0.35);
      // v14.4 : le scan couvre au moins la portée de l'arme (l'artillerie
      // acquiert à 380-420, plus seulement à 280) et toute menace proche de soi
      const cand = nearestEnemy(s, Math.max(300, d.range + 60));
      if (cand) {
        const dSelf = dist(s.x, s.y, cand.x, cand.y) - (cand.r || 0);
        if (o.type === 'hold') { if (dSelf <= d.range) s.tgt = cand; } // tient : ne tire que sans bouger
        else if (o.type === 'guard') { if (dist(cand.x, cand.y, o.x, o.y) < Math.max(360, d.range + 40)) s.tgt = cand; }
        else if (o.type === 'amove') { s.tgt = cand; }
        else if (base && dist(cand.x, cand.y, base.x, base.y) < 650) s.tgt = cand;
        else if (dSelf < 320) s.tgt = cand; // hors de tout : se défend quand même à proximité
      }
    }
    tgt = s.tgt;
  }
  // laisses selon le mode
  if (tgt && s.order.type !== 'attack') {
    if (o.type === 'hold' && dist(s.x, s.y, tgt.x, tgt.y) - (tgt.r || 0) > d.range) { tgt = null; s.tgt = null; }
    if (o.type === 'guard' && dist(s.x, s.y, o.x, o.y) > 460) { tgt = null; s.tgt = null; }
    if (o.type === 'orbit' && base && dist(s.x, s.y, base.x, base.y) > 750) { tgt = null; s.tgt = null; }
  }

  // v14.8 : l'Arche est un porte-drones — les chasseurs sont rangés dans la coque
  // et en sortent quand il y a un combat ou un ordre, puis y rentrent au repos.
  const carrier = s.kind === 'cdrone' && base === mother && !mother.dead;
  if (carrier && s.docked && (tgt || o.type !== 'orbit')) {
    // catapultage : on émerge au bord de la coque, vers la cible si elle existe
    s.docked = false;
    const a = tgt ? Math.atan2(tgt.y - base.y, tgt.x - base.x) : s.ang;
    s.x = base.x + Math.cos(a) * (base.r + 8);
    s.y = base.y + Math.sin(a) * (base.r + 8);
    spark(s.x, s.y, COL.p);
  }

  let mx = null, my = null;
  if (tgt) {
    const dd = dist(s.x, s.y, tgt.x, tgt.y) - (tgt.r || 0);
    s.ang = Math.atan2(tgt.y - s.y, tgt.x - s.x);
    if (dd <= d.range) {
      if (s.cool <= 0) { fireShot(s, tgt, d); s.cool = d.cd * rand(0.9, 1.1) / linkMul(s); }
    } else { mx = tgt.x; my = tgt.y; }
  } else if (o.type === 'amove' || o.type === 'move') {
    mx = o.x; my = o.y;
    if (dist(s.x, s.y, mx, my) < 30) { s.order = { type: 'guard', x: s.x, y: s.y }; mx = null; my = null; }
  } else if (o.type === 'guard') {
    if (dist(s.x, s.y, o.x, o.y) > 40) { mx = o.x; my = o.y; }
  } else if (o.type === 'hold') {
    // position tenue : aucune poursuite, aucun retour à la base
  } else if (carrier) {
    // porte-drones : rentre dans la coque et s'y range (invisible) jusqu'au prochain combat
    if (dist(s.x, s.y, base.x, base.y) <= base.r) {
      if (!s.docked) { s.docked = true; spark(base.x, base.y, COL.p); }
      s.x = base.x; s.y = base.y; s.ang = base.ang;
    } else { mx = base.x; my = base.y; }
  } else if (base) {
    // orbite autour de la base (Station Spatiale en repli)
    const oa = s.orbit + gameT * 0.55;
    const orbR = base.r + 55;
    mx = base.x + Math.cos(oa) * orbR;
    my = base.y + Math.sin(oa) * orbR;
    if (dist(s.x, s.y, mx, my) < 12) { mx = null; my = null; s.ang = oa + Math.PI / 2; }
  }
  if (mx !== null) {
    const a = Math.atan2(my - s.y, mx - s.x);
    s.ang = a;
    s.x += Math.cos(a) * d.speed * linkMul(s) * dragAst(s) * dt;
    s.y += Math.sin(a) * d.speed * linkMul(s) * dragAst(s) * dt;
  }
  s.x = clamp(s.x, 20, WORLD.w - 20);
  s.y = clamp(s.y, 20, WORLD.h - 20);
}

/* ===== mise à jour : drones miniers ===== */
function findAsteroid() {
  const base = homeBase();
  if (!base) return null;
  // v15.5 : on vise d'abord une veine qui vaut le voyage (≥ AST_WORTH) ; sinon,
  // n'importe quel filon encore vivant — la régénération finira par le remplir
  for (const seuil of [AST_WORTH, 0.5]) {
    let best = null, bd = 1100;
    for (const a of asteroids) {
      if (a.stock < seuil) continue;
      const d = dist(base.x, base.y, a.x, a.y);
      if (d < bd) { bd = d; best = a; }
    }
    if (best) return best;
  }
  return null;
}
function updateMiner(s, dt) {
  const d = SHIPS.miner;
  s.flash = Math.max(0, s.flash - dt);
  const base = homeBase();
  let mx = null, my = null;

  if (s.task === 'goto') {
    mx = s.gotoPos.x; my = s.gotoPos.y;
    if (dist(s.x, s.y, mx, my) < 25) { s.task = 'seek'; mx = null; my = null; }
  } else if (s.task === 'seek') {
    if (s.ast && (s.ast.dead || s.ast.stock <= 0)) s.ast = null; // veine pulvérisée ou vidée
    if (!s.ast || s.ast.stock < AST_WORTH) s.ast = findAsteroid() || s.ast;
    if (!s.ast) {
      if (base) {
        const oa = s.orbit + gameT * 0.4;
        mx = base.x + Math.cos(oa) * (base.r + 25);
        my = base.y + Math.sin(oa) * (base.r + 25);
        if (dist(s.x, s.y, mx, my) < 12) { mx = null; my = null; }
      }
    } else {
      mx = s.ast.x; my = s.ast.y;
      if (dist(s.x, s.y, s.ast.x, s.ast.y) < s.ast.r + 16) { s.task = 'mine'; s.mineT = 3; mx = null; my = null; }
    }
  } else if (s.task === 'mine') {
    if (!s.ast || s.ast.stock <= 0) { s.task = 'seek'; s.ast = null; }
    else {
      s.mineT -= dt;
      s.ang = Math.atan2(s.ast.y - s.y, s.ast.x - s.x);
      if (s.mineT <= 0) {
        const take = Math.min(CARGO, s.ast.stock);
        s.ast.stock -= take;
        s.cargo = take;
        s.task = 'return';
        if (s.ast.stock <= 0) log('Astéroïde épuisé.', 'warn');
      }
    }
  } else if (s.task === 'return') {
    // v14.9 : dépose au point le plus proche — l'Arche ou n'importe quelle station
    const drop = nearestDropoff(s) || base;
    if (drop) {
      mx = drop.x; my = drop.y;
      if (dist(s.x, s.y, drop.x, drop.y) < drop.r + 22) {
        metal += s.cargo; metalMined += s.cargo; s.cargo = 0;
        s.task = 'seek';
        sfx('deposit');
        mx = null; my = null;
      }
    }
  }

  if (mx !== null) {
    const a = Math.atan2(my - s.y, mx - s.x);
    s.ang = a;
    s.x += Math.cos(a) * d.speed * linkMul(s) * dragAst(s) * dt;
    s.y += Math.sin(a) * d.speed * linkMul(s) * dragAst(s) * dt;
  }
  s.x = clamp(s.x, 20, WORLD.w - 20);
  s.y = clamp(s.y, 20, WORLD.h - 20);
}

/* ===== mise à jour : capsules d'énergie ===== */
function updateCapsule(s, dt) {
  s.flash = Math.max(0, s.flash - dt);
  const base = homeBase();
  if (!base) return;
  const a = Math.atan2(base.y - s.y, base.x - s.x);
  s.ang = a;
  s.x += Math.cos(a) * SHIPS.capsule.speed * dragAst(s) * dt;
  s.y += Math.sin(a) * SHIPS.capsule.speed * dragAst(s) * dt;
  if (dist(s.x, s.y, base.x, base.y) < base.r + 18) {
    energy += s.charge;
    s.dead = true;
    spark(s.x, s.y, COL.e);
    sfx('deposit');
  }
}

/* ===== relocalisation des stations (repli → transit → déploiement) ===== */
// v15.2 : TOUTES les stations du joueur se déplacent — la Collectrice suit
// désormais les mêmes phases que la Sentinelle et la Station Spatiale.
const MOBILE_KINDS = ['spatiale', 'sentinelle', 'collectsat', 'aiturret', 'gate'];
// t = repli et déploiement (chacun), sp = vitesse de transit
const MOB_SPEC = {
  spatiale:   { t: 8, sp: 45 },
  sentinelle: { t: 4, sp: 75 },
  collectsat: { t: 4, sp: 70 },
  aiturret:   { t: 5, sp: 60 },  // v15.7 : l'artillerie se replie, mais lourdement
  gate:       { t: 7, sp: 40 },  // le Relais traîne son anneau de distorsion
};
const mobSpec = (st) => MOB_SPEC[st.kind] || { t: 5, sp: 70 };
const stationBusy = (st) => !!(st.build || st.up || st.yardUp || st.rebuild || st.mob);
function startMove(st) {
  if (!st || st.dead || st.side !== 'player' || !MOBILE_KINDS.includes(st.kind) || stationBusy(st)) { sfx('nope'); return; }
  moveOrder = st;
  setPlacing(null);
  log(STRUCTS[st.kind].nom + ' : choisissez la destination (clic), clic droit pour annuler.', '');
  sfx('click');
}
function spotFree(x, y, r, ignore) {
  if (x < 60 || y < 60 || x > WORLD.w - 60 || y > WORLD.h - 60) return false;
  if (structs.some(s => s !== ignore && !s.dead && dist(s.x, s.y, x, y) < s.r + r + 12)) return false;
  if (asteroids.some(a => dist(a.x, a.y, x, y) < a.r + r + 6)) return false;
  return true;
}
function orderRelocate(st, x, y) {
  if (!st || st.dead || st.side !== 'player' || !MOBILE_KINDS.includes(st.kind) || stationBusy(st)) { sfx('nope'); return; }
  if (!spotFree(x, y, st.r, st)) { log('Destination obstruée.', 'warn'); sfx('nope'); return; }
  st.mob = { phase: 'pack', t: 0, total: mobSpec(st).t, dest: { x, y } };
  log(STRUCTS[st.kind].nom + ' : repli en cours.', '');
  sfx('click');
}
function mobLabel(st) {
  const mb = st.mob;
  if (!mb) return '';
  if (mb.phase === 'pack') return 'repli ' + Math.ceil(mb.total - mb.t) + 's';
  if (mb.phase === 'move') return 'en transit';
  return 'déploiement ' + Math.ceil(mb.total - mb.t) + 's';
}

/* ===== chantier naval de la Station Spatiale ===== */
const yardLvl = (st) => st.yard || 1;
const yardSpec = (st) => YARD[yardLvl(st) - 1];
function queueStationShip(st, kind) {
  const def = PROD[kind];
  if (!st || st.dead || st.build || st.mob || !def) { sfx('nope'); return; }
  st.queue = st.queue || [];
  if ((st.lvl || 1) < def.lvl) { log(SHIPS[kind].nom + ' : station niveau ' + def.lvl + ' requise.', 'warn'); sfx('nope'); return; }
  if (def.max) {
    const n = ships.reduce((a, s) => a + (s.kind === kind && !s.dead ? 1 : 0), 0)
      + st.queue.reduce((a, q) => a + (q.kind === kind ? 1 : 0), 0);
    if (n >= def.max) { log(SHIPS[kind].nom + ' : maximum atteint (' + def.max + ').', 'warn'); sfx('nope'); return; }
  }
  if (st.queue.length >= yardSpec(st).cap) { log('File de production pleine (' + yardSpec(st).cap + ').', 'warn'); sfx('nope'); return; }
  if (metal < def.m || energy < def.e) { log('Ressources insuffisantes (' + coutTxt(def) + ').', 'warn'); sfx('nope'); return; }
  metal -= def.m; energy -= def.e;
  st.queue.push({ kind, t: 0, total: def.t });
  sfx('click');
}
// v15.3 : Maj → une série de SERIE_MAJ commandes (elle s'arrête au premier
// refus : file pleine, ressources ou maximum d'exemplaires atteint)
function queueStationBatch(st, kind, n) {
  if (!st) return;
  for (let i = 0; i < n; i++) {
    const avant = st.queue ? st.queue.length : 0;
    queueStationShip(st, kind);
    if (!st.queue || st.queue.length === avant) break;
  }
}
// v15.2 : extension du chantier — plafonnée par le niveau de la station, et
// exclusive de l'amélioration de la station (un seul chantier à la fois).
function upgradeYard(st) {
  if (!st || st.dead || st.build || st.mob || st.up || st.yardUp) { sfx('nope'); return; }
  const lvl = yardLvl(st);
  if (lvl >= 3) { sfx('nope'); return; }
  if ((st.lvl || 1) <= lvl) { log('Chantier naval : station niveau ' + (lvl + 1) + ' requise.', 'warn'); sfx('nope'); return; }
  const c = YARD_UP[lvl - 1];
  if (metal < c.m || energy < c.e) { log('Ressources insuffisantes (' + coutTxt(c) + ').', 'warn'); sfx('nope'); return; }
  metal -= c.m; energy -= c.e;
  st.yardUp = { t: 0, total: c.t };
  log('Chantier naval : extension vers le niveau ' + (lvl + 1) + ' (' + c.t + 's).', '');
  sfx('click');
}

/* ===== v15.2 : point de ralliement du chantier naval ===== */
// La station est le seul producteur d'unités du joueur : ce qui en sort part
// honorer le ralliement — un site minier pour les cargos, une position tenue
// pour les vaisseaux de combat.
// v15.5 : un ralliement posé sur un astéroïde SUIT le rocher, qui dérive
function rallyPos(st) {
  const r = st && st.rally;
  if (!r) return null;
  // le rocher prime tant qu'il vit ; garde-fou sur les coordonnées, un point de
  // ralliement NaN contaminerait les positions de sortie de chantier
  if (r.ast && !r.ast.dead && Number.isFinite(r.ast.x)) return { x: r.ast.x, y: r.ast.y, ast: r.ast };
  return { x: r.x, y: r.y, ast: null };
}
function setRally(st, x, y, ast) {
  if (!st || st.dead || st.side !== 'player' || st.kind !== 'spatiale') return;
  const roc = ast && typeof ast === 'object' ? ast : null; // l'astéroïde lui-même, pas un drapeau
  st.rally = { x: clamp(x, 20, WORLD.w - 20), y: clamp(y, 20, WORLD.h - 20), ast: roc };
  log('Ralliement du chantier naval défini' + (roc ? ' — site minier.' : '.'), '');
}
function clearRally(st) {
  if (!st || !st.rally) return;
  st.rally = null;
  log('Ralliement du chantier naval annulé.', '');
}
function applyRally(s, ral) {
  if (s.kind === 'vhangar') return; // rejoint l'Arche de lui-même : le ralliement ne s'applique pas
  if (s.kind === 'cargo') { s.anchor = { x: ral.x, y: ral.y }; s.task = 'travel'; return; }
  if ((s.kind === 'miner' || s.kind === 'h_recolteur') && ral.ast) { s.ast = ral.ast; s.task = 'seek'; return; }
  if (COMBAT_KINDS.includes(s.kind)) {
    s.order = { type: 'move', x: clamp(ral.x + rand(-30, 30), 20, WORLD.w - 20), y: clamp(ral.y + rand(-30, 30), 20, WORLD.h - 20) };
    s.tgt = null;
  }
}
// sortie de chantier : le vaisseau naît du côté du ralliement, puis l'honore
function launchStationShip(st, kind) {
  const ral = rallyPos(st);
  const a = ral ? Math.atan2(ral.y - st.y, ral.x - st.x) + rand(-0.4, 0.4) : rand(0, TAU);
  const sp = addShip(kind, 'player', st.x + Math.cos(a) * (st.r + 22), st.y + Math.sin(a) * (st.r + 22));
  if (kind === 'cargo') { sp.task = 'mine'; sp.load = 0; }
  if (kind === 'corvette' || kind === 'lanceur') sp.order = { type: 'guard', x: sp.x, y: sp.y };
  if (ral) applyRally(sp, ral);
  log(SHIPS[kind].nom + ' : sortie de chantier' + (ral && kind !== 'vhangar' ? ' — ralliement en cours.' : '.'), 'good');
  sfx('done');
}

/* ===== mise à jour : Cargo minier (et ses drones de collecte) ===== */
// v14.9 : point de dépôt de ressources le plus proche — l'Arche OU la Station
// Spatiale (seule station qui reçoit). En chantier ou en relocalisation = inerte.
function nearestDropoff(s) {
  let best = null, bd = Infinity;
  const test = (b) => { if (!b || b.dead || b.build || b.mob) return; const d2 = dist(s.x, s.y, b.x, b.y); if (d2 < bd) { bd = d2; best = b; } };
  if (mother && !mother.dead) test(mother);
  test(spatiale());
  return best;
}
function updateCargo(s, dt) {
  const d = SHIPS.cargo;
  s.flash = Math.max(0, s.flash - dt);
  s.droneT = (s.droneT || 0) - dt;
  let mx = null, my = null;

  if (s.task === 'deliver') {
    const base = nearestDropoff(s); // livre à l'Arche ou à la Station Spatiale, au plus proche
    if (base) {
      mx = base.x; my = base.y;
      if (dist(s.x, s.y, base.x, base.y) < base.r + 24) {
        metal += s.load; metalMined += s.load; s.load = 0;
        s.task = s.anchor ? 'travel' : 'mine';
        sfx('deposit');
        mx = null; my = null;
      }
    }
  } else if (s.task === 'travel') {
    if (!s.anchor) s.task = 'mine';
    else {
      mx = s.anchor.x; my = s.anchor.y;
      if (dist(s.x, s.y, mx, my) < 36) { s.task = 'mine'; mx = null; my = null; }
    }
  } else if (s.task === 'stop') {
    // halte (S) : immobile, drones de collecte en formation
  } else { // 'mine' : en station sur site, les drones de collecte travaillent
    if (s.load >= CARGO_FULL) s.task = 'deliver';
    else if (!asteroids.some(a => a.stock >= AST_WORTH && dist(s.x, s.y, a.x, a.y) < 320)) {
      // plus rien à forer ici : se rapproche de la veine suivante (les rochers
      // dérivent — le site du cargo se recale sur la position courante)
      let best = null, bd = 1400;
      for (const a of asteroids) {
        if (a.stock < AST_WORTH) continue;
        const dd = dist(s.x, s.y, a.x, a.y);
        if (dd < bd) { bd = dd; best = a; }
      }
      if (best) { s.anchor = { x: best.x, y: best.y }; s.task = 'travel'; }
    } else {
      // entretient ses 3 drones de collecte
      const mine = ships.filter(o => o.kind === 'cminer' && o.boss === s && !o.dead);
      if (mine.length < 3 && s.droneT <= 0) {
        s.droneT = 1.4;
        const dr = addShip('cminer', 'player', s.x + rand(-12, 12), s.y + rand(-12, 12));
        dr.boss = s; dr.sub = 'seek';
      }
    }
  }

  if (mx !== null) {
    const a = Math.atan2(my - s.y, mx - s.x);
    s.ang = a;
    s.x += Math.cos(a) * d.speed * linkMul(s) * dragAst(s) * dt;
    s.y += Math.sin(a) * d.speed * linkMul(s) * dragAst(s) * dt;
  }
  s.x = clamp(s.x, 20, WORLD.w - 20);
  s.y = clamp(s.y, 20, WORLD.h - 20);
}
function updateCMiner(s, dt) {
  const d = SHIPS.cminer;
  s.flash = Math.max(0, s.flash - dt);
  const boss = s.boss;
  if (!boss || boss.dead) { s.dead = true; spark(s.x, s.y, COL.p); return; }
  let mx = null, my = null;

  if (boss.task !== 'mine') {
    // suit le cargo en formation
    s.ast = null; s.sub = 'seek';
    const oa = (s.id % 6) / 6 * TAU;
    mx = boss.x + Math.cos(oa) * (boss.r + 10);
    my = boss.y + Math.sin(oa) * (boss.r + 10);
    if (dist(s.x, s.y, mx, my) < 6) { mx = null; my = null; s.ang = boss.ang; }
  } else if (s.sub === 'dig') {
    if (!s.ast || s.ast.stock <= 0) { s.sub = 'seek'; s.ast = null; }
    else {
      s.mineT -= dt;
      s.ang = Math.atan2(s.ast.y - s.y, s.ast.x - s.x);
      if (s.mineT <= 0) {
        s.carga = Math.min(25, s.ast.stock);
        s.ast.stock -= s.carga;
        s.sub = 'back';
        if (s.ast.stock <= 0) log('Astéroïde épuisé.', 'warn');
      }
    }
  } else if (s.sub === 'back') {
    mx = boss.x; my = boss.y;
    if (dist(s.x, s.y, boss.x, boss.y) < boss.r + 8) {
      boss.load += s.carga || 0; s.carga = 0;
      s.sub = 'seek';
      mx = null; my = null;
    }
  } else { // seek
    if (!s.ast || s.ast.stock <= 0) {
      s.ast = null;
      let bd = 340;
      for (const a of asteroids) {
        if (a.stock <= 0) continue;
        const dd = dist(boss.x, boss.y, a.x, a.y);
        if (dd < bd) { bd = dd; s.ast = a; }
      }
    }
    if (s.ast) {
      mx = s.ast.x; my = s.ast.y;
      if (dist(s.x, s.y, s.ast.x, s.ast.y) < s.ast.r + 12) { s.sub = 'dig'; s.mineT = 2; mx = null; my = null; }
    } else {
      mx = boss.x; my = boss.y;
      if (dist(s.x, s.y, boss.x, boss.y) < boss.r + 14) { mx = null; my = null; }
    }
  }

  if (mx !== null) {
    const a = Math.atan2(my - s.y, mx - s.x);
    s.ang = a;
    s.x += Math.cos(a) * d.speed * linkMul(s) * dragAst(s) * dt;
    s.y += Math.sin(a) * d.speed * linkMul(s) * dragAst(s) * dt;
  }
}

/* ===== mise à jour : Vaisseau-hangar ===== */
function updateVHangar(s, dt) {
  const d = SHIPS.vhangar;
  s.flash = Math.max(0, s.flash - dt);
  if (mother && !mother.dead) {
    if (s.docked) {
      // arrimé : suit l'Arche, étend la capacité de chasseurs
      const a = mother.ang + Math.PI * 0.8 * (s.slot ? -1 : 1);
      s.x = mother.x + Math.cos(a) * (mother.r + 9);
      s.y = mother.y + Math.sin(a) * (mother.r + 9);
      s.ang = mother.ang;
      return;
    }
    const dd = dist(s.x, s.y, mother.x, mother.y);
    if (dd < mother.r + 16) {
      s.docked = true;
      s.slot = ships.reduce((a2, o) => a2 + (o !== s && o.kind === 'vhangar' && o.docked && !o.dead ? 1 : 0), 0) % 2;
      log('Vaisseau-hangar arrimé : +' + VHANGAR_CAP + ' chasseurs de capacité.', 'good');
      sfx('done');
      return;
    }
    const a = Math.atan2(mother.y - s.y, mother.x - s.x);
    s.ang = a;
    s.x += Math.cos(a) * d.speed * linkMul(s) * dragAst(s) * dt;
    s.y += Math.sin(a) * d.speed * linkMul(s) * dragAst(s) * dt;
  } else {
    // l'Arche est détruite : se détache et attend près de la station
    if (s.docked) { s.docked = false; log('Vaisseau-hangar désarrimé.', 'warn'); }
    const st = spatiale();
    if (st && dist(s.x, s.y, st.x, st.y) > st.r + 60) {
      const a = Math.atan2(st.y - s.y, st.x - s.x);
      s.ang = a;
      s.x += Math.cos(a) * d.speed * linkMul(s) * dragAst(s) * dt;
      s.y += Math.sin(a) * d.speed * linkMul(s) * dragAst(s) * dt;
    }
  }
}

/* ===== Station Spatiale : amélioration & renaissance de l'Arche ===== */
function upgradeSpatiale(st) {
  if (!st || st.dead || st.build || st.up || st.yardUp || st.mob || st.lvl >= 3) { sfx('nope'); return; }
  const c = SPATIALE_UP[st.lvl - 1];
  if (metal < c.m || energy < c.e) { log('Ressources insuffisantes (' + coutTxt(c) + ').', 'warn'); sfx('nope'); return; }
  metal -= c.m; energy -= c.e;
  st.up = { t: 0, total: 15 };
  log('Station Spatiale : amélioration vers le niveau ' + (st.lvl + 1) + ' (15s).', '');
  sfx('click');
}
function startRebuild(st) {
  if (!st || st.dead || st.lvl < 3 || st.rebuild || st.mob || (mother && !mother.dead)) { sfx('nope'); return; }
  if (metal < REBUILD_COST.m || energy < REBUILD_COST.e) {
    log('Ressources insuffisantes (' + coutTxt(REBUILD_COST) + ').', 'warn');
    sfx('nope'); return;
  }
  metal -= REBUILD_COST.m; energy -= REBUILD_COST.e;
  st.rebuild = { t: 0, total: 30 };
  log('RECONSTRUCTION DE L\'ARCHE — 30s. Protégez la station.', 'warn');
  sfx('alarm');
}
function respawnMother(st) {
  mother = {
    id: idSeq++, kind: 'mother', side: 'player', x: st.x + st.r + 60, y: st.y, r: 36 + 1.8 * modLevels(),
    hp: 3200 + 200 * modLevels(), maxHp: 3200 + 200 * modLevels(), shield: 0, shieldMax: 0,
    ang: 0, dest: null, flash: 0, shieldFlash: 0,
    cool: 0, hangarT: 2, forgeT: 2, buildQ: null, dead: false
  };
  sel = [mother];
  boom(mother.x, mother.y, 70, COL.p);
  showTaunt('L\'ARCHE RENAÎT.');
  log('L\'Arche est reconstruite — les modules sont préservés.', 'good');
}

/* ===== mise à jour : l'Arche ===== */
function updateMother(dt) {
  const m = mother;
  m.flash = Math.max(0, m.flash - dt);
  m.shieldFlash = Math.max(0, m.shieldFlash - dt);
  m.cool -= dt;
  // la base grandit avec chaque module installé
  m.r = 36 + 1.8 * modLevels();

  // chantier de module en cours
  if (m.buildQ) {
    m.buildQ.t += dt;
    if (m.buildQ.t >= m.buildQ.total) {
      const key = m.buildQ.key;
      mods[key]++;
      m.maxHp += 200;
      m.hp += 200;
      if (key === 'bouclier') m.shield += 250;
      log('Module ' + MODULES[key].nom + ' → niveau ' + mods[key] + '. L\'Arche grandit.', 'good');
      sfx('place');
      m.buildQ = null;
    }
  }

  // déplacement
  if (m.dest) {
    const dd = dist(m.x, m.y, m.dest.x, m.dest.y);
    if (dd < 14) m.dest = null;
    else {
      const a = Math.atan2(m.dest.y - m.y, m.dest.x - m.x);
      let da = a - m.ang;
      while (da > Math.PI) da -= TAU;
      while (da < -Math.PI) da += TAU;
      m.ang += clamp(da, -1.6 * dt, 1.6 * dt);
      const vm = motherSpeed() * dragAst(m); // v15.14 : l'Arche aussi laboure la roche
      m.x += Math.cos(m.ang) * vm * dt;
      m.y += Math.sin(m.ang) * vm * dt;
      // traînée moteur
      if (Math.random() < 0.5) {
        parts.push({
          x: m.x - Math.cos(m.ang) * (m.r + 4) + randVis(-6, 6),
          y: m.y - Math.sin(m.ang) * (m.r + 4) + randVis(-6, 6),
          vx: -Math.cos(m.ang) * 40, vy: -Math.sin(m.ang) * 40,
          life: randVis(0.3, 0.7), color: COL.p
        });
      }
    }
    m.x = clamp(m.x, 60, WORLD.w - 60);
    m.y = clamp(m.y, 60, WORLD.h - 60);
  }

  // canon spinal
  if (mods.canon > 0 && m.cool <= 0) {
    const def = { dmg: 20 * mods.canon, vsS: 1.4, range: 340, ss: 700 };
    let t = (focusTgt && !focusTgt.dead && dist(m.x, m.y, focusTgt.x, focusTgt.y) - focusTgt.r <= def.range) ? focusTgt : nearestEnemy(m, def.range);
    if (t) {
      fireShot(m, t, def);
      m.cool = 1.1;
    }
  }

  // réparation de coque hors combat (consomme du métal)
  m.repairT = (m.repairT || 0) - dt;
  if (m.repairT <= 0) { m.repairT = 0.5; m.safe = !nearestEnemy(m, 520); }
  m.repairing = false;
  if (m.safe && m.hp < m.maxHp && metal > 0) {
    const rep = Math.min(10 * dt, m.maxHp - m.hp, metal / 0.2);
    m.hp += rep;
    metal -= rep * 0.2;
    m.repairing = rep > 0.01;
  }

  // bouclier
  m.shieldMax = 250 * mods.bouclier;
  if (m.shield < m.shieldMax && energy > 0) {
    const regen = Math.min(10 * dt, m.shieldMax - m.shield, energy / 0.25);
    m.shield += regen;
    energy = Math.max(0, energy - regen * 0.25);
  }
  m.shield = Math.min(m.shield, m.shieldMax);

  // fabrication automatique des drones
  m.hangarT -= dt;
  if (m.hangarT <= 0) {
    m.hangarT = 4;
    if (cdrones().length < cdroneCap() && metal >= CDRONE_COST.m && energy >= CDRONE_COST.e) {
      metal -= CDRONE_COST.m; energy -= CDRONE_COST.e;
      addShip('cdrone', 'player', m.x + rand(-40, 40), m.y + rand(-40, 40));
      sfx('done');
    }
  }
  m.forgeT -= dt;
  if (m.forgeT <= 0) {
    m.forgeT = 5;
    if (miners().length < minerCap() && metal >= MINER_COST.m && energy >= MINER_COST.e) {
      metal -= MINER_COST.m; energy -= MINER_COST.e;
      addShip('miner', 'player', m.x + rand(-40, 40), m.y + rand(-40, 40));
      sfx('done');
    }
  }
}

/* ===== mise à jour : le QG du Core central adverse ===== */
function updateAIMother(dt) {
  const m = aimother;
  m.flash = Math.max(0, m.flash - dt);
  m.cool -= dt;
  m.r = 50 + aiProg * 0.15;

  // rôde dans son secteur nord-est — c'est au joueur d'aller le détruire
  if (!m.dest || dist(m.x, m.y, m.dest.x, m.dest.y) < 40) {
    m.dest = { x: rand(4300, 6200), y: rand(280, 1800) };
  }
  const speed = 24 * dragAst(m);
  const a = Math.atan2(m.dest.y - m.y, m.dest.x - m.x);
  let da = a - m.ang;
  while (da > Math.PI) da -= TAU;
  while (da < -Math.PI) da += TAU;
  m.ang += clamp(da, -1.2 * dt, 1.2 * dt);
  m.x += Math.cos(m.ang) * speed * dt;
  m.y += Math.sin(m.ang) * speed * dt;
  m.x = clamp(m.x, 80, WORLD.w - 80);
  m.y = clamp(m.y, 80, WORLD.h - 80);

  // canon — plus violent à mesure que l'hostilité monte
  if (m.cool <= 0) {
    const def = { dmg: 16 + 0.12 * aiProg, vsS: 1.4, range: 330, ss: 620 };
    const t = nearestEnemy(m, def.range);
    if (t) { fireShot(m, t, def); m.cool = 1.4; }
  }

  // il entretient sa propre escorte
  m.hangarT -= dt;
  if (m.hangarT <= 0) {
    m.hangarT = 16;
    const escorts = ships.reduce((a2, s) => a2 + (s.order.type === 'escort' && !s.dead ? 1 : 0), 0);
    const cap = 6 + Math.floor(aiProg / 15);
    if (escorts < cap) {
      const kind = aiProg > 50 && alea() < 0.3 ? 'raider' : 'drone';
      addShip(kind, 'ai', m.x + rand(-80, 80), m.y + rand(-80, 80), { type: 'escort' });
    }
  }
}

function separate() {
  for (let i = 0; i < ships.length; i++) {
    const a = ships[i];
    if (a.docked) continue; // drones rangés dans l'Arche : hors collision
    for (let j = i + 1; j < ships.length; j++) {
      const b = ships[j];
      if (b.docked) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const rr = a.r + b.r + 4;
      const d2 = dx * dx + dy * dy;
      if (d2 < rr * rr && d2 > 0.01) {
        const dd = Math.sqrt(d2);
        const push = (rr - dd) / dd * 0.45;
        // les bâtiments de le Collectif sont ancrés : seul l'autre est poussé
        const aFix = HIVE_STATIC.includes(a.kind), bFix = HIVE_STATIC.includes(b.kind);
        if (aFix && bFix) continue;
        if (aFix) { b.x += dx * push * 2; b.y += dy * push * 2; }
        else if (bFix) { a.x -= dx * push * 2; a.y -= dy * push * 2; }
        else {
          a.x -= dx * push; a.y -= dy * push;
          b.x += dx * push; b.y += dy * push;
        }
      }
    }
  }
}

/* ===== tirs ===== */
function fireShot(src, tgt, d) {
  const heavy = src.kind === 'mother' || src.kind === 'aimother';
  shots.push({
    x: src.x, y: src.y, target: tgt,
    speed: d.ss || 560, dmg: d.dmg, vsS: d.vsS || 1,
    side: src.side, life: 2.2,
    heavy,
    ang: Math.atan2(tgt.y - src.y, tgt.x - src.x)
  });
  sfx(heavy ? 'cannon' : 'fire');
}
function updateShots(dt) {
  for (const sh of shots) {
    if (sh.target && !sh.target.dead) {
      sh.ang = Math.atan2(sh.target.y - sh.y, sh.target.x - sh.x);
    }
    sh.x += Math.cos(sh.ang) * sh.speed * dt;
    sh.y += Math.sin(sh.ang) * sh.speed * dt;
    sh.life -= dt;
    if (sh.life <= 0) { sh.dead = true; continue; }
    if (sh.target && !sh.target.dead && dist(sh.x, sh.y, sh.target.x, sh.target.y) < sh.target.r + 6) {
      const isS = !!STRUCTS[sh.target.kind] || sh.target.kind === 'mother' || sh.target.kind === 'aimother';
      damage(sh.target, sh.dmg * (isS ? sh.vsS : 1));
      spark(sh.x, sh.y, sideCol(sh.side));
      sh.dead = true;
    }
  }
}

/* ===== effets SVG animés (couche DOM au-dessus du canvas) ===== */
const svgLayer = (() => {
  let d = document.getElementById('svg-fx');
  if (!d) { d = document.createElement('div'); d.id = 'svg-fx'; document.body.appendChild(d); }
  return d;
})();
let svgFxs = [];
// animation de transformation sonde → plateforme : anneau de matérialisation,
// quatre panneaux qui se déplient (SMIL), cœur pulsant
function deployFx(x, y, big) {
  const px = big ? 240 : 150;
  const el = document.createElement('div');
  el.className = 'svgfx';
  el.innerHTML =
    '<svg viewBox="-50 -50 100 100" width="' + px + '" height="' + px + '">' +
    '<g fill="none" stroke="#5ce8c9">' +
    // onde de matérialisation
    '<circle r="4" stroke-width="1.5" stroke-dasharray="4 3">' +
    '<animate attributeName="r" from="4" to="46" dur="1.5s" fill="freeze"/>' +
    '<animate attributeName="opacity" from="0.9" to="0" dur="1.5s" fill="freeze"/>' +
    '</circle>' +
    '<circle r="3" stroke-width="1.2">' +
    '<animate attributeName="r" from="3" to="30" begin="0.25s" dur="1.3s" fill="freeze"/>' +
    '<animate attributeName="opacity" from="0.8" to="0" begin="0.25s" dur="1.3s" fill="freeze"/>' +
    '</circle>' +
    // quatre panneaux qui se déplient
    [0, 90, 180, 270].map(rot =>
      '<g transform="rotate(' + rot + ')"><rect x="7" y="-2.5" width="0" height="5" stroke-width="1.3">' +
      '<animate attributeName="width" from="0" to="15" begin="0.5s" dur="0.7s" fill="freeze"/>' +
      '</rect></g>'
    ).join('') +
    // anneau final qui se verrouille
    '<circle r="22" stroke-width="1.5" opacity="0" stroke-dasharray="9 5">' +
    '<animate attributeName="opacity" from="0" to="0.9" begin="0.9s" dur="0.4s" fill="freeze"/>' +
    '<animateTransform attributeName="transform" type="rotate" from="0" to="90" begin="0.9s" dur="0.9s" fill="freeze"/>' +
    '</circle>' +
    // cœur
    '<circle r="2.5" fill="#5ce8c9" stroke="none">' +
    '<animate attributeName="opacity" values="1;0.25;1;0.25;1;1" dur="1.8s"/>' +
    '<animate attributeName="r" values="2.5;4;2.5" begin="1.2s" dur="0.6s"/>' +
    '</circle>' +
    '</g></svg>';
  svgLayer.appendChild(el);
  svgFxs.push({ el, x, y, start: performance.now(), dur: 1900 });
}
function renderSvgFx(now) {
  svgFxs = svgFxs.filter(f => {
    if (now - f.start >= f.dur) { f.el.remove(); return false; }
    const p = w2s(f.x, f.y);
    const off = p.x < -200 || p.x > vw + 200 || p.y < -200 || p.y > vh + 200;
    f.el.style.display = off ? 'none' : '';
    if (!off) {
      f.el.style.left = p.x + 'px';
      f.el.style.top = p.y + 'px';
      f.el.style.transform = 'translate(-50%,-50%) scale(' + cam.z.toFixed(3) + ')';
    }
    return true;
  });
}

/* ===== effets ===== */
function boom(x, y, r, color) {
  fxs.push({ x, y, t: 0, dur: 0.6, r, color });
  const n = Math.min(26, Math.floor(r));
  for (let i = 0; i < n; i++) {
    const a = randVis(0, TAU), v = randVis(25, 150);
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: randVis(0.4, 1), color });
  }
}
function spark(x, y, color) {
  for (let i = 0; i < 4; i++) {
    const a = randVis(0, TAU), v = randVis(15, 80);
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: randVis(0.12, 0.32), color });
  }
}
function updateFx(dt) {
  for (const f of fxs) f.t += dt;
  fxs = fxs.filter(f => f.t < f.dur);
  for (const p of parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
  parts = parts.filter(p => p.life > 0);
}

/* ===== modules & satellites ===== */
function buyModule(key) {
  const m = MODULES[key];
  const lvl = mods[key];
  if (lvl >= m.max) { sfx('nope'); return; }
  if (mother.buildQ) { log('Les chantiers de l\'Arche sont occupés (' + MODULES[mother.buildQ.key].nom + ').', 'warn'); sfx('nope'); return; }
  const c = m.cost[lvl];
  if (metal < c.m || energy < c.e) {
    log('Ressources insuffisantes (' + coutTxt(c) + ').', 'warn');
    sfx('nope'); return;
  }
  metal -= c.m; energy -= c.e;
  mother.buildQ = { key, t: 0, total: 8 + 5 * lvl }; // 8s, 13s, 18s selon le niveau
  log('Assemblage : ' + m.nom + ' niv ' + (lvl + 1) + ' — ' + mother.buildQ.total + 's.', '');
  sfx('click');
}
const DEPLOY_RANGE = 600; // les stations se déploient à portée de l'Arche
function setPlacing(kind) {
  placing = (placing === kind) ? null : kind;
  document.querySelectorAll('.bbtn[data-sat]').forEach(b => {
    b.classList.toggle('active', b.dataset.sat === placing);
  });
}
function stationPlacement(key, px, py) {
  key = key || placing;
  const c = SATS[key];
  const d = STRUCTS[key];
  const x = px === undefined ? mouse.wx : px, y = py === undefined ? mouse.wy : py;
  if (!mother || mother.dead) return { ok: false, x, y, why: 'l\'Arche est détruite' };
  const n = structs.reduce((a, s) => a + (s.side === 'player' && !s.dead ? 1 : 0), 0)
    + ships.reduce((a, s) => a + (s.kind === 'probe' && !s.dead ? 1 : 0), 0);
  if (n >= 12) return { ok: false, x, y, why: 'limite de stations atteinte (12)' };
  if (key === 'spatiale' && spatialeExists()) return { ok: false, x, y, why: 'une seule Station Spatiale par flotte' };
  if (metal < c.m || energy < c.e) return { ok: false, x, y, why: 'ressources insuffisantes (' + coutTxt(c) + ')' };
  if (dist(x, y, mother.x, mother.y) > DEPLOY_RANGE) return { ok: false, x, y, why: 'hors de portée de déploiement' };
  if (structs.some(s => !s.dead && dist(s.x, s.y, x, y) < s.r + d.r + 12)) return { ok: false, x, y, why: 'emplacement obstrué' };
  if (asteroids.some(a => dist(a.x, a.y, x, y) < a.r + d.r + 6)) return { ok: false, x, y, why: 'emplacement obstrué' };
  return { ok: true, x, y, why: '' };
}
// le coût est payé au lancement de la sonde ; la station naît à l'arrivée
function tryPlaceStation() { // geste local : on valide sous le curseur, puis on émet
  const p = stationPlacement();
  if (!p.ok) { log('Déploiement impossible : ' + p.why + '.', 'warn'); sfx('nope'); return; }
  emettre({ t: 'sat', key: placing, x: p.x, y: p.y });
  if (!keys['shift']) setPlacing(null); // Maj enfoncée : on enchaîne les placements
}
/** Pose effective (les deux clients) : la sonde part, la station naît à l'arrivée. */
function poserSat(key, x, y) {
  const p = stationPlacement(key, x, y);
  if (!p.ok) return; // l'état a changé entre le geste et le tick : on renonce des deux côtés
  const c = SATS[key];
  metal -= c.m; energy -= c.e;
  const pr = addShip('probe', 'player', mother.x, mother.y);
  pr.carry = key;
  pr.dest = { x, y };
  pr.ang = Math.atan2(y - mother.y, x - mother.x);
  log('Sonde lancée — ' + STRUCTS[key].nom + ' en route.', '');
  sfx('place');
}

/* ===== mise à jour : sondes de déploiement ===== */
function updateProbe(s, dt) {
  s.flash = Math.max(0, s.flash - dt);
  if (!s.dest) { s.dead = true; return; }
  const a = Math.atan2(s.dest.y - s.y, s.dest.x - s.x);
  s.ang = a;
  s.x += Math.cos(a) * SHIPS.probe.speed * dragAst(s) * dt;
  s.y += Math.sin(a) * SHIPS.probe.speed * dragAst(s) * dt;
  if (dist(s.x, s.y, s.dest.x, s.dest.y) < 10) {
    // transformation : la sonde devient la plateforme
    s.dead = true; // arrivée, pas une destruction — onDeath n'est pas appelé
    const st = addStruct(s.carry, 'player', s.dest.x, s.dest.y); // niveaux et file initialisés par addStruct
    st.build = { t: 0, total: BUILD_TIMES[s.carry] || 10 };
    st.hp = Math.floor(st.maxHp * 0.35);
    deployFx(s.dest.x, s.dest.y, s.carry === 'spatiale');
    log(STRUCTS[s.carry].nom + ' : déploiement (' + st.build.total + 's).', '');
    sfx('place');
  }
}

/* ===== victoire / défaite ===== */
function fmtTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}
function showEnd(won) {
  releaseLock(); // v15.4 : l'écran de fin rend le curseur au joueur
  const sc = document.getElementById('screen-end');
  const ti = document.getElementById('end-title');
  const tx = document.getElementById('end-text');
  const stEl = document.getElementById('end-stats');
  ti.textContent = won ? 'CORE CENTRAL ANÉANTI' : 'VOTRE CORE EST TOMBÉ';
  ti.style.color = won ? COL.p : COL.a;
  ti.style.textShadow = '0 0 24px ' + (won ? 'rgba(92,232,201,.5)' : 'rgba(255,66,84,.5)');
  tx.style.textAlign = 'center';
  tx.innerHTML = won
    ? 'Le silence retombe sur le secteur. Quelque part, d\'autres noyaux calculent déjà votre existence — mais ce soir, l\'Arche navigue dans une galaxie qui respire.'
    : 'Le camp adverse a archivé votre signal sous : <em>anomalie résolue</em>.';
  stEl.innerHTML =
    '<div><b>' + fmtTime(gameT) + '</b><span>DURÉE</span></div>' +
    '<div><b>' + kills + '</b><span>HOSTILES DÉTRUITS</span></div>' +
    '<div><b>' + losses + '</b><span>DRONES PERDUS</span></div>' +
    '<div><b>' + Math.floor(metalMined) + '</b><span>MÉTAL EXTRAIT</span></div>' +
    '<div><b>' + capsLost + '</b><span>CAPSULES PERDUES</span></div>';
  sc.classList.remove('hidden');
}
function win() { if (state !== 'playing') return; state = 'won'; showEnd(true); }
function lose() { if (state !== 'playing') return; state = 'lost'; showEnd(false); }

/* ===== journal ===== */
function log(msg, cls) {
  const ul = document.getElementById('log');
  if (!ul) return;
  const li = document.createElement('li');
  li.textContent = msg;
  if (cls) li.className = cls;
  ul.prepend(li);
  while (ul.children.length > 6) ul.removeChild(ul.lastChild);
  setTimeout(() => { if (li.parentNode) li.remove(); }, 13000);
}

/* ===== v15.5 : ceintures vivantes — dérive, régénération, collisions ===== */
let astTarget = 0;   // population de référence (fixée par initWorld)
let astRespawnT = 0;
function updateAsteroids(dt) {
  for (const a of asteroids) {
    a.x += a.vx * dt;
    a.y += a.vy * dt;
    a.rot += a.spin * dt;
    // rebond sur les limites du secteur : les rochers restent en jeu
    const m = a.r + 30;
    if (a.x < m) { a.x = m; a.vx = Math.abs(a.vx); }
    else if (a.x > WORLD.w - m) { a.x = WORLD.w - m; a.vx = -Math.abs(a.vx); }
    if (a.y < m) { a.y = m; a.vy = Math.abs(a.vy); }
    else if (a.y > WORLD.h - m) { a.y = WORLD.h - m; a.vy = -Math.abs(a.vy); }
    // régénération de la veine (jamais au-delà du stock d'origine)
    if (a.stock < a.maxStock) a.stock = Math.min(a.maxStock, a.stock + AST_REGEN * dt);
  }
  // contacts rocher contre rocher : bousculade si le choc est mou, explosion sinon
  for (let i = 0; i < asteroids.length; i++) {
    const a = asteroids[i];
    if (a.dead) continue;
    for (let j = i + 1; j < asteroids.length; j++) {
      const b = asteroids[j];
      if (b.dead) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.001;
      if (d >= a.r + b.r) continue;
      if (Math.hypot(a.vx - b.vx, a.vy - b.vy) >= AST_SMASH) { explodeAsteroids(a, b); break; }
      bounceAsteroids(a, b, dx / d, dy / d, d);
    }
  }
  // le secteur se repeuple : un rocher neuf entre par un bord, cap vers l'intérieur
  if (asteroids.length < astTarget) {
    astRespawnT -= dt;
    if (astRespawnT <= 0) {
      astRespawnT = AST_RESPAWN;
      spawnDriftingAsteroid();
    }
  } else astRespawnT = AST_RESPAWN;
}
function spawnDriftingAsteroid() {
  const bord = Math.floor(rand(0, 4));
  const m = 60;
  let x, y, vx, vy;
  const sp = rand(AST_DRIFT[0], AST_DRIFT[1]);
  if (bord === 0) { x = m; y = rand(m, WORLD.h - m); vx = sp; vy = rand(-sp, sp) * 0.4; }
  else if (bord === 1) { x = WORLD.w - m; y = rand(m, WORLD.h - m); vx = -sp; vy = rand(-sp, sp) * 0.4; }
  else if (bord === 2) { x = rand(m, WORLD.w - m); y = m; vy = sp; vx = rand(-sp, sp) * 0.4; }
  else { x = rand(m, WORLD.w - m); y = WORLD.h - m; vy = -sp; vx = rand(-sp, sp) * 0.4; }
  addAsteroid(x, y, rand(AST_TAILLE[0], AST_TAILLE[1]), rand(900, 1600), vx, vy);
  log('Un astéroïde entre dans le secteur.', '');
}
// choc mou : on décolle les deux rochers et on échange la composante normale
// de leur vitesse (masses égales) — ils se bousculent et repartent chacun de leur côté
function bounceAsteroids(a, b, nx, ny, d) {
  const chevauche = (a.r + b.r - d) / 2 + 0.5;
  a.x -= nx * chevauche; a.y -= ny * chevauche;
  b.x += nx * chevauche; b.y += ny * chevauche;
  const p = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (p <= 0) return; // ils s'éloignent déjà
  a.vx -= p * nx; a.vy -= p * ny;
  b.vx += p * nx; b.vy += p * ny;
  spark((a.x + b.x) / 2, (a.y + b.y) / 2, COL.ast);
}
// vague de dégâts : tout ce qui vit dans le rayon prend, les deux camps compris
function explodeAsteroids(a, b) {
  const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
  const somme = a.r + b.r;
  const R = somme * AST_BOOM_R;
  const D = somme * AST_BOOM_DMG;
  a.dead = true; b.dead = true;
  a.stock = 0; b.stock = 0;

  const frapper = (e) => {
    if (!e || e.dead) return;
    const d = dist(e.x, e.y, x, y) - (e.r || 0);
    if (d > R) return;
    // atténuation linéaire, plancher à 30 % en bordure de vague
    damage(e, D * Math.max(0.3, 1 - d / R));
  };
  for (const s of ships) if (!s.docked) frapper(s); // les drones arrimés sont à l'abri dans la coque
  for (const s of structs) frapper(s);
  frapper(mother);
  frapper(aimother);

  boom(x, y, somme * 2.2, COL.amber);
  fxs.push({ x, y, t: 0, dur: 1.1, r: R, color: 'rgba(255,180,84,0.9)' }); // l'onde
  for (let i = 0; i < 22; i++) {
    const ang = randVis(0, TAU), v = randVis(60, 260);
    parts.push({ x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, life: randVis(0.5, 1.4), color: COL.ast });
  }
  sfx('bigboom');
  log('Collision d\'astéroïdes — onde de choc.', 'warn');
}

/* ===== v15.3 : enchaînement d'ordres (Maj) ===== */
// Chaque unité du joueur porte une file `oq` : Maj + clic droit ajoute la
// commande au lieu de la remplacer. Le dispatcher passe à l'ordre suivant dès
// que l'unité est LIBRE — un combat en cours ou un astéroïde encore chargé
// retiennent la file, si bien qu'un enchaînement décrit une tournée, pas une
// suite de coupures.
const ORDER_QUEUE_MAX = 12;
function clearQueue(u) { if (u) u.oq = null; }
function pushAction(u, act) {
  u.oq = u.oq || [];
  if (u.oq.length >= ORDER_QUEUE_MAX) return false;
  u.oq.push(act);
  return true;
}
// l'unité est-elle encore occupée par son ordre courant ?
function unitBusy(u) {
  if (u.batir) return true; // v15.15 : elle rejoint son site de construction
  if (u === mother) return !!mother.dest || !!(focusTgt && !focusTgt.dead);
  if (COMBAT_KINDS.includes(u.kind)) {
    const t = u.order && u.order.type;
    if (t === 'move' || t === 'amove') return true;
    if (t === 'attack') return !!(u.order.target && !u.order.target.dead);
    return !!(u.tgt && !u.tgt.dead); // engagée : on finit le combat avant de continuer
  }
  // v15.5 : « la veine donne encore » se mesure au seuil d'intérêt — avec la
  // régénération, `stock > 0` serait vrai pour toujours et la file ne tournerait plus
  if (u.kind === 'miner') {
    if (u.task === 'goto' || u.task === 'return') return true;
    return !!(u.ast && !u.ast.dead && u.ast.stock >= AST_WORTH);
  }
  if (u.kind === 'h_recolteur') {
    if (u.task === 'goto') return true;
    if ((u.load || 0) > 0 && ((u.load || 0) >= RECOLT_CAP || u.flush)) return true; // livraison en cours
    return !!(u.ast && !u.ast.dead && u.ast.stock >= AST_WORTH);
  }
  if (u.kind === 'cargo') {
    if (u.task === 'travel' || u.task === 'deliver') return true;
    return u.task === 'mine' && asteroids.some(a => a.stock >= AST_WORTH && dist(u.x, u.y, a.x, a.y) < 320);
  }
  return false;
}
// application d'UN ordre à UNE unité — le décalage de formation est déjà cuit
// dans act.x/act.y au moment de la commande
function applyAction(u, act) {
  if (!u || u.dead || !act) return;
  // v15.15 : un ordre explicite abandonne le chantier en route et rembourse
  if (u.batir) annulerBatir(u, SHIPS[u.batir.key].nom + ' : chantier abandonné, mise rendue.');
  if (u === mother) {
    if (act.a === 'attack') { if (act.target && !act.target.dead) focusTgt = act.target; }
    else if (act.x !== undefined) mother.dest = { x: clamp(act.x, 60, WORLD.w - 60), y: clamp(act.y, 60, WORLD.h - 60) };
    return;
  }
  if (COMBAT_KINDS.includes(u.kind)) {
    if (act.a === 'attack') {
      if (!act.target || act.target.dead) return; // cible morte : l'ordre s'évapore
      u.order = { type: 'attack', target: act.target };
      u.tgt = act.target;
    } else if (act.a === 'recall') {
      u.order = u.kind === 'cdrone' ? { type: 'orbit' } : { type: 'move', x: act.x, y: act.y };
      u.tgt = null;
    } else {
      u.order = { type: act.a === 'amove' ? 'amove' : 'move', x: act.x, y: act.y };
      u.tgt = null;
    }
    return;
  }
  if (u.kind === 'miner' || u.kind === 'h_recolteur') {
    if (act.a === 'mine' && act.ast && act.ast.stock > 0) { u.ast = act.ast; u.task = 'seek'; }
    else if (act.x !== undefined) { u.task = 'goto'; u.gotoPos = { x: act.x, y: act.y }; }
    return;
  }
  if (u.kind === 'cargo') {
    if (act.a === 'recall') { u.load > 0 ? u.task = 'deliver' : (u.anchor = null, u.task = 'travel'); return; }
    // v15.5 : un site minier dérive — on vise sa position courante, pas celle du clic
    const cible = act.ast && !act.ast.dead ? act.ast : act;
    if (cible.x !== undefined) { u.anchor = { x: cible.x, y: cible.y }; u.task = 'travel'; }
  }
}
function advanceQueues() {
  const step = (u) => {
    if (!u || u.dead || !u.oq || !u.oq.length) return;
    if (unitBusy(u)) return;
    applyAction(u, u.oq.shift());
    if (!u.oq.length) u.oq = null;
  };
  for (const s of ships) if (s.side === 'player' && !s.dead) step(s);
  if (mother && !mother.dead) step(mother);
}

/* ===== boucle de simulation ===== */
function update(dt) {
  gameT += dt;

  // énergie (radiations)
  energy += energyRate() * dt;

  // taux de minage affiché (échantillon glissant)
  mRateSample.t += dt;
  if (mRateSample.t >= 2) {
    mRateSample.rate = (metalMined - mRateSample.mined) / mRateSample.t;
    mRateSample.mined = metalMined;
    mRateSample.t = 0;
  }

  updateAsteroids(dt); // v15.5 : dérive, régénération et collisions des ceintures
  advanceQueues(); // v15.3 : ordres enchaînés (Maj) — l'unité libre prend le suivant
  if (foe === 'collective') updateAICollective(dt); // la ruche adverse croît et essaime (intensité fixe)
  updateHiveScript(dt);
  if (mother && !mother.dead) updateMother(dt);
  if (aimother && !aimother.dead) updateAIMother(dt);
  for (const s of structs) if (!s.dead) { updateLink(s, dt); updateStruct(s, dt); }
  for (const s of ships) {
    if (s.dead) continue;
    updateLink(s, dt);
    if (s.batir) updateHiveBuild(s, dt); // v15.15 : en route vers son site de construction
    else if (s.fus) updateFusion(s, dt);    // v15.8 : fusion en cours — inerte, les deux corps
    else if (s.mut) updateMutation(s, dt); // mutation/division : inerte quel que soit le camp
    else if (HIVE_BUILDINGS.includes(s.kind)) updateHiveBuilding(s, dt); // Couveuse, Matrice
    else if (HIVE_PASSIVE.includes(s.kind)) s.flash = Math.max(0, s.flash - dt); // bâtiments passifs (les deux camps)
    else if (s.side === 'ai') updateEnemy(s, dt); // unités de l'IA (Core central ou Collectif adverse) : chassent le joueur
    else if (s.side === 'hive') updateHive(s, dt); // poche sauvage (héritage)
    else if (s.kind === 'h_recolteur') updateRecolteur(s, dt);
    else if (COMBAT_KINDS.includes(s.kind)) updateCDrone(s, dt);
    else if (s.kind === 'miner') updateMiner(s, dt);
    else if (s.kind === 'capsule') updateCapsule(s, dt);
    else if (s.kind === 'probe') updateProbe(s, dt);
    else if (s.kind === 'cargo') updateCargo(s, dt);
    else if (s.kind === 'cminer') updateCMiner(s, dt);
    else if (s.kind === 'vhangar') updateVHangar(s, dt);
    else updateEnemy(s, dt);
  }
  separate();
  updateShots(dt);
  updateFx(dt);
  computeVision();
  updateFog(dt);

  if (focusTgt && focusTgt.dead) focusTgt = null;
  sel = sel.filter(u => !u.dead);

  ships = ships.filter(s => !s.dead);
  structs = structs.filter(s => !s.dead);
  shots = shots.filter(s => !s.dead);
  asteroids = asteroids.filter(a => !a.dead); // rochers pulvérisés (v15.5)
}

/* ===== caméra clavier ===== */
function handleKeys(dt) {
  const v = 950 / cam.z * dt;
  let moved = false;
  // v14.4 : caméra aux flèches et aux bords seulement — les lettres servent aux ordres
  if (keys['arrowup']) { cam.y -= v; moved = true; }
  if (keys['arrowdown']) { cam.y += v; moved = true; }
  if (keys['arrowleft']) { cam.x -= v; moved = true; }
  if (keys['arrowright']) { cam.x += v; moved = true; }
  // défilement par les bords de l'écran
  const EDGE = 16;
  if (mouse.x <= EDGE) { cam.x -= v; moved = true; }
  if (mouse.x >= vw - EDGE) { cam.x += v; moved = true; }
  if (mouse.y <= EDGE) { cam.y -= v; moved = true; }
  if (mouse.y >= vh - EDGE) { cam.y += v; moved = true; }
  if (moved) follow = false;
  if (follow && mother && !mother.dead) { cam.x = mother.x; cam.y = mother.y; }
  cam.x = clamp(cam.x, 0, WORLD.w);
  cam.y = clamp(cam.y, 0, WORLD.h);
}

/* ============================================================
   RENDU
   ============================================================ */
function render(now) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#04070c';
  ctx.fillRect(0, 0, vw, vh);

  for (const st of stars) {
    const sx = ((st.x - cam.x * st.f * cam.z) % vw + vw) % vw;
    const sy = ((st.y - cam.y * st.f * cam.z) % vh + vh) % vh;
    const a = 0.25 + 0.45 * Math.abs(Math.sin(now * 0.0006 + st.tw));
    ctx.fillStyle = 'rgba(159,182,201,' + a.toFixed(2) + ')';
    ctx.fillRect(sx, sy, st.s, st.s);
  }

  ctx.save();
  ctx.translate(vw / 2, vh / 2);
  ctx.scale(cam.z, cam.z);
  ctx.translate(-cam.x, -cam.y);

  drawNebulas();
  drawGrid();
  drawBounds();
  for (const p of pulsars) drawPulsar(p, now);
  for (const a of asteroids) drawAsteroid(a);
  for (const s of structs) {
    if (s.side === 'ai' && !s.seen) continue; // jamais repérée
    drawStruct(s, now);
  }
  if (aimother && !aimother.dead && isVisible(aimother.x, aimother.y, aimother.r)) drawAIMother(now);
  if (mother && !mother.dead) drawMother(now);
  for (const s of ships) {
    if (s.docked) continue; // rangé dans l'Arche : non rendu
    if (s.side !== 'player' && !isVisible(s.x, s.y, s.r)) continue;
    drawShip(s, now);
  }
  drawShots();
  drawParts();
  drawBooms();
  drawFog();
  drawSelRings(now);
  drawLinks(now);
  drawFocus(now);
  drawDest(now);
  drawRally(now);
  drawOrderQueue(now);
  if (placing) drawPlacement();
  if (hivePlacing) drawHivePlacement();
  drawHiveBuilds(now);
  if (moveOrder && !moveOrder.dead) drawMoveTarget();
  if (aMode) { // réticule du mode attaque
    ctx.strokeStyle = COL.a;
    ctx.lineWidth = 1.4 / cam.z;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(mouse.wx, mouse.wy, 14 / cam.z, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(mouse.wx - 20 / cam.z, mouse.wy); ctx.lineTo(mouse.wx + 20 / cam.z, mouse.wy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mouse.wx, mouse.wy - 20 / cam.z); ctx.lineTo(mouse.wx, mouse.wy + 20 / cam.z); ctx.stroke();
  }

  ctx.restore();

  // boîte de sélection (espace écran)
  if (dragStart && dist(dragStart.x, dragStart.y, mouse.x, mouse.y) > 6) {
    ctx.strokeStyle = COL.p;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1;
    ctx.strokeRect(dragStart.x, dragStart.y, mouse.x - dragStart.x, mouse.y - dragStart.y);
    ctx.setLineDash([]);
  }

  renderSvgFx(now);
  drawMinimap(now);
}

function drawPlacement() {
  if (!mother || mother.dead) return;
  // portée de déploiement autour de l'Arche
  ctx.strokeStyle = 'rgba(92,232,201,0.18)';
  ctx.lineWidth = 1 / cam.z;
  ctx.setLineDash([8, 8]);
  ctx.beginPath(); ctx.arc(mother.x, mother.y, DEPLOY_RANGE, 0, TAU); ctx.stroke();
  // fantôme de la station
  const p = stationPlacement();
  const d = STRUCTS[placing];
  ctx.strokeStyle = p.ok ? COL.p : COL.a;
  ctx.lineWidth = 1.6 / cam.z;
  ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.arc(p.x, p.y, d.r, 0, TAU); ctx.stroke();
  if (d.range) { ctx.beginPath(); ctx.arc(p.x, p.y, d.range, 0, TAU); ctx.stroke(); }
  ctx.setLineDash([]);
  if (placing === 'collectsat') {
    const k = intensityAt(p.x, p.y);
    ctx.fillStyle = k > 0.05 ? COL.e : 'rgba(141,255,168,0.45)';
    ctx.font = (13 / cam.z) + 'px monospace';
    ctx.fillText('radiations ' + Math.round(k * 100) + '% → +' + (STRUCTS.collectsat.rate * k).toFixed(1) + '⚡/s', p.x + d.r + 10, p.y - d.r);
  }
}

// v15.15 : fantôme du bâtiment du Collectif au curseur + trait vers la cellule
function drawHivePlacement() {
  const key = hivePlacing.key;
  const d = SHIPS[key];
  const x = mouse.wx, y = mouse.wy;
  const u = celluleLaPlusProche(key, x, y);
  const c = HIVE_COSTS[key] || { m: 0, e: 0 };
  const ok = !!u && hiveSpotFree(x, y, d.r) && metal >= c.m && energy >= c.e;
  ctx.strokeStyle = ok ? COL.h : COL.a;
  ctx.lineWidth = 1.6 / cam.z;
  ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.arc(x, y, d.r, 0, TAU); ctx.stroke();
  if (d.range) { ctx.beginPath(); ctx.arc(x, y, d.range, 0, TAU); ctx.stroke(); } // portée du Bastion
  if (u) { ctx.beginPath(); ctx.moveTo(u.x, u.y); ctx.lineTo(x, y); ctx.stroke(); }
  ctx.setLineDash([]);
  ctx.fillStyle = ok ? 'rgba(199,125,255,0.9)' : 'rgba(255,66,84,0.9)';
  ctx.font = (13 / cam.z) + 'px monospace';
  ctx.fillText(d.nom + (u ? '' : ' — aucune cellule éligible'), x + d.r + 10, y - d.r);
}
// chantiers en route : la cellule et le site qui l'attend
function drawHiveBuilds(now) {
  for (const s of ships) {
    if (s.dead || !s.batir) continue;
    if (s.side !== 'player' && !isVisible(s.x, s.y, s.r)) continue;
    const b = s.batir, d = SHIPS[b.key];
    ctx.strokeStyle = 'rgba(199,125,255,' + (0.4 + 0.3 * Math.abs(Math.sin(now * 0.005))).toFixed(2) + ')';
    ctx.lineWidth = 1.2 / cam.z;
    ctx.setLineDash([4, 6]);
    ctx.lineDashOffset = -now * 0.02;
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(b.x, b.y, d.r, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawMoveTarget() {
  const st = moveOrder;
  const ok = spotFree(mouse.wx, mouse.wy, st.r, st);
  ctx.strokeStyle = ok ? COL.p : COL.a;
  ctx.lineWidth = 1.6 / cam.z;
  ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.arc(mouse.wx, mouse.wy, st.r, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(st.x, st.y); ctx.lineTo(mouse.wx, mouse.wy); ctx.stroke();
  ctx.setLineDash([]);
}

// v15.3 : chemin des ordres enchaînés (Maj) des unités sélectionnées
function currentDest(u) {
  if (u === mother) return mother.dest;
  const o = u.order;
  if (o && (o.type === 'move' || o.type === 'amove') && o.x !== undefined) return { x: o.x, y: o.y };
  if (o && o.type === 'attack' && o.target && !o.target.dead) return { x: o.target.x, y: o.target.y, hostile: true };
  if (u.task === 'goto' && u.gotoPos) return u.gotoPos;
  if ((u.task === 'travel' || u.task === 'seek') && u.anchor) return u.anchor;
  if ((u.task === 'seek' || u.task === 'mine') && u.ast) return { x: u.ast.x, y: u.ast.y };
  return null;
}
function drawOrderQueue(now) {
  ctx.lineWidth = 1 / cam.z;
  for (const u of sel) {
    if (u.dead || u.side !== 'player' || !u.oq || !u.oq.length) continue;
    const pts = [];
    const cur = currentDest(u);
    if (cur) pts.push(cur);
    for (const act of u.oq) {
      if (act.a === 'attack') { if (act.target && !act.target.dead) pts.push({ x: act.target.x, y: act.target.y, hostile: true }); }
      else if (act.ast) { if (!act.ast.dead) pts.push({ x: act.ast.x, y: act.ast.y, mine: true }); }
      else if (act.x !== undefined) pts.push({ x: act.x, y: act.y });
    }
    let px = u.x, py = u.y;
    for (const p of pts) {
      ctx.strokeStyle = p.hostile ? 'rgba(255,66,84,0.45)' : 'rgba(92,232,201,0.35)';
      ctx.setLineDash([3, 6]);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.setLineDash([]);
      const s = 4 / cam.z;
      ctx.beginPath();
      if (p.hostile) { // croix : cible d'attaque
        ctx.moveTo(p.x - s, p.y - s); ctx.lineTo(p.x + s, p.y + s);
        ctx.moveTo(p.x + s, p.y - s); ctx.lineTo(p.x - s, p.y + s);
      } else if (p.mine) { // losange : site minier
        ctx.moveTo(p.x, p.y - s * 1.4); ctx.lineTo(p.x + s, p.y);
        ctx.lineTo(p.x, p.y + s * 1.4); ctx.lineTo(p.x - s, p.y); ctx.closePath();
      } else ctx.rect(p.x - s, p.y - s, s * 2, s * 2);
      ctx.stroke();
      px = p.x; py = p.y;
    }
  }
}

// v15.2 : point de ralliement du chantier naval (station sélectionnée seulement)
function drawRally(now) {
  for (const st of sel) {
    if (st.dead || st.kind !== 'spatiale' || st.side !== 'player' || !st.rally) continue;
    const r = rallyPos(st); // suit le rocher si le ralliement vise un site minier
    ctx.strokeStyle = 'rgba(255,180,84,0.5)';
    ctx.lineWidth = 1.2 / cam.z;
    ctx.setLineDash([5, 8]);
    ctx.beginPath(); ctx.moveTo(st.x, st.y); ctx.lineTo(r.x, r.y); ctx.stroke();
    ctx.setLineDash([]);
    // losange pulsant à l'arrivée (doublé si le ralliement vise un site minier)
    const k = 0.5 + 0.5 * Math.sin(now * 0.004);
    ctx.strokeStyle = 'rgba(255,180,84,' + (0.5 + 0.4 * k).toFixed(2) + ')';
    const s = 9 / cam.z;
    const losange = (h) => {
      ctx.beginPath();
      ctx.moveTo(r.x, r.y - h * 1.5); ctx.lineTo(r.x + h, r.y);
      ctx.lineTo(r.x, r.y + h * 1.5); ctx.lineTo(r.x - h, r.y);
      ctx.closePath(); ctx.stroke();
    };
    losange(s);
    if (r.ast) losange(s * 1.7);
  }
}

function drawSelRings(now) {
  ctx.lineWidth = 1.2 / cam.z;
  for (const u of sel) {
    if (u.dead) continue;
    ctx.strokeStyle = sideCol(u.side);
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -now * 0.01;
    ctx.beginPath(); ctx.arc(u.x, u.y, u.r + (u.kind === 'mother' || u.kind === 'aimother' ? 24 : 6), 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
  }
}

/* ===== v12 : lien au core — liaison de la sélection et marqueurs d'orphelins ===== */
function drawLinks(now) {
  // pointillé discret de l'entité sélectionnée vers son core
  ctx.lineWidth = 1 / cam.z;
  ctx.setLineDash([2, 7]);
  for (const u of sel) {
    if (u.dead || !u.core || u.core.dead) continue;
    // ne jamais révéler à travers le brouillard la position d'un core ennemi
    if (u.side === 'ai' && !(isVisible(u.x, u.y, u.r) && isVisible(u.core.x, u.core.y, u.core.r))) continue;
    ctx.strokeStyle = u.side === 'ai' ? 'rgba(255,66,84,0.4)' : 'rgba(92,232,201,0.4)';
    ctx.beginPath(); ctx.moveTo(u.x, u.y); ctx.lineTo(u.core.x, u.core.y); ctx.stroke();
  }
  ctx.setLineDash([]);
  // orphelins : petit anneau ambre barré, clignotant, au-dessus de l'entité
  const blink = 0.5 + 0.5 * Math.sin(now * 0.008);
  ctx.strokeStyle = 'rgba(255,180,84,' + (0.45 + 0.45 * blink).toFixed(2) + ')';
  ctx.lineWidth = 1.4 / cam.z;
  const mark = (e) => {
    const y = e.y - e.r - 10 / cam.z, rr = 4 / cam.z;
    ctx.beginPath(); ctx.arc(e.x, y, rr, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(e.x - rr, y + rr); ctx.lineTo(e.x + rr, y - rr); ctx.stroke();
  };
  for (const s of ships) if (!s.dead && s.orphan && (s.side === 'player' || isVisible(s.x, s.y, s.r))) mark(s);
  for (const s of structs) if (!s.dead && s.orphan && (s.side === 'player' || (s.seen && isVisible(s.x, s.y, s.r)))) mark(s);
}

function drawNebulas() {
  const blobs = [
    [1400, 3300, 1300, 'rgba(20,70,66,0.10)'],
    [5400, 900, 1500, 'rgba(90,18,28,0.12)'],
    [3300, 2200, 1800, 'rgba(28,38,70,0.08)'],
  ];
  for (const [x, y, r, c] of blobs) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, c);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}
function drawGrid() {
  ctx.strokeStyle = 'rgba(40,70,80,0.10)';
  ctx.lineWidth = 1 / cam.z;
  ctx.beginPath();
  for (let x = 0; x <= WORLD.w; x += 400) { ctx.moveTo(x, 0); ctx.lineTo(x, WORLD.h); }
  for (let y = 0; y <= WORLD.h; y += 400) { ctx.moveTo(0, y); ctx.lineTo(WORLD.w, y); }
  ctx.stroke();
}
function drawBounds() {
  ctx.strokeStyle = 'rgba(255,66,84,0.18)';
  ctx.lineWidth = 2 / cam.z;
  ctx.setLineDash([14, 10]);
  ctx.strokeRect(0, 0, WORLD.w, WORLD.h);
  ctx.setLineDash([]);
}
function drawPulsar(p, now) {
  // champ de radiation
  const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
  g.addColorStop(0, 'rgba(141,255,168,0.10)');
  g.addColorStop(0.6, 'rgba(141,255,168,0.045)');
  g.addColorStop(1, 'rgba(141,255,168,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(141,255,168,0.16)';
  ctx.lineWidth = 1 / cam.z;
  ctx.setLineDash([6, 10]);
  ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.stroke();
  ctx.setLineDash([]);
  // cœur du pulsar
  const pulse = 1 + 0.25 * Math.sin(now * 0.004 + p.ph);
  const g2 = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 36 * pulse);
  g2.addColorStop(0, 'rgba(235,255,240,0.95)');
  g2.addColorStop(0.3, 'rgba(141,255,168,0.55)');
  g2.addColorStop(1, 'rgba(141,255,168,0)');
  ctx.fillStyle = g2;
  ctx.beginPath(); ctx.arc(p.x, p.y, 36 * pulse, 0, TAU); ctx.fill();
  // rayons tournants
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(now * 0.0005 + p.ph);
  ctx.strokeStyle = 'rgba(141,255,168,0.35)';
  ctx.lineWidth = 1.5 / cam.z;
  for (let i = 0; i < 2; i++) {
    ctx.rotate(Math.PI / 2 * (i ? 1 : 0) + (i ? 0 : 0));
    ctx.beginPath();
    ctx.moveTo(-60 * pulse, 0); ctx.lineTo(60 * pulse, 0);
    ctx.stroke();
    ctx.rotate(Math.PI / 2);
  }
  ctx.restore();
}
function drawAsteroid(a) {
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.rotate(a.rot);
  ctx.beginPath();
  for (let i = 0; i < a.verts.length; i++) {
    const ang = i / a.verts.length * TAU;
    const rr = a.verts[i];
    if (i === 0) ctx.moveTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
    else ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(35,42,56,0.85)';
  ctx.fill();
  ctx.strokeStyle = a.stock > 0 ? COL.ast : 'rgba(60,66,80,0.5)';
  ctx.lineWidth = 1.4 / cam.z;
  ctx.stroke();
  if (a.stock > 0) {
    // veine de métal proportionnelle au stock restant
    const k = clamp(a.stock / a.maxStock, 0.15, 1);
    ctx.fillStyle = 'rgba(255,180,84,' + (0.25 + 0.45 * k).toFixed(2) + ')';
    ctx.fillRect(-a.r * 0.3 * k, -a.r * 0.14 * k, a.r * 0.6 * k, a.r * 0.28 * k);
  }
  ctx.restore();
}

function hpBar(e) {
  if (e.hp >= e.maxHp) return;
  const w = e.r * 2.2;
  const y = e.y - e.r - 10;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(e.x - w / 2, y, w, 4);
  const ratio = clamp(e.hp / e.maxHp, 0, 1);
  ctx.fillStyle = ratio > 0.4 ? sideCol(e.side) : COL.amber;
  ctx.fillRect(e.x - w / 2, y, w * ratio, 4);
}

function drawStruct(st, now) {
  const c = st.side === 'player' ? COL.p : COL.a;
  const cD = st.side === 'player' ? COL.pDark : COL.aDark;
  ctx.save();
  ctx.translate(st.x, st.y);
  ctx.lineWidth = 1.6 / cam.z;
  ctx.strokeStyle = st.flash > 0 ? '#ffffff' : c;
  ctx.fillStyle = cD;

  const img = svgPret(st.kind, st.side);
  if (img) {
    const scale = UNIT_SCALES[st.kind] || 1;
    ctx.save();
    
    let rot = 0;
    if (st.kind === 'sentinelle' || st.kind === 'aiturret') {
      rot = st.aim;
    } else if (st.kind === 'collectsat' || st.kind === 'gate') {
      rot = st.rot;
    } else if (st.kind === 'spatiale') {
      rot = st.rot * 0.4;
    }
    ctx.rotate(rot);

    if (st.flash > 0) {
      ctx.filter = 'brightness(0) invert(1)';
    }
    ctx.drawImage(img, -60 / scale, -60 / scale, 120 / scale, 120 / scale);
    if (st.flash > 0) {
      ctx.filter = 'none';
    }
    ctx.restore();

    if (st.kind === 'collectsat') {
      const k = intensityAt(st.x, st.y);
      if (k > 0) {
        ctx.fillStyle = 'rgba(141,255,168,' + (0.25 + 0.35 * Math.abs(Math.sin(now * 0.005))).toFixed(2) + ')';
        ctx.beginPath(); ctx.arc(0, 0, 4 + k * 4, 0, TAU); ctx.fill();
      }
      const bf = clamp((st.buf || 0) / CAPSULE_CHARGE, 0, 1);
      if (bf > 0.03) {
        ctx.strokeStyle = COL.e;
        ctx.lineWidth = 2 / cam.z;
        ctx.beginPath(); ctx.arc(0, 0, st.r + 6, -Math.PI / 2, -Math.PI / 2 + TAU * bf); ctx.stroke();
      }
    } else if (st.kind === 'spatiale') {
      const lvl = st.lvl || 1;
      for (let i = 0; i < 3; i++) {
        const cx = (i - 1) * 7;
        ctx.beginPath(); ctx.arc(cx, 0, 2.5, 0, TAU);
        if (i < lvl) { ctx.fillStyle = i === 2 ? COL.amber : c; ctx.fill(); }
        else {
          ctx.strokeStyle = c;
          ctx.lineWidth = 1 / cam.z;
          ctx.stroke();
        }
      }
      const job = st.up || st.rebuild;
      if (job) {
        ctx.strokeStyle = st.rebuild ? COL.amber : c;
        ctx.lineWidth = 2.4 / cam.z;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(0, 0, st.r + 18, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(job.t / job.total, 0, 1));
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else if (st.kind === 'gate') {
      // v15.7 : l'anneau de distorsion prend la couleur de son camp
      const sw = st.r * (0.35 + 0.2 * Math.sin(now * 0.003));
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, sw + 8);
      const rgb = st.side === 'player' ? '92,232,201' : '255,66,84';
      g.addColorStop(0, 'rgba(' + rgb + ',0.85)');
      g.addColorStop(1, 'rgba(' + rgb + ',0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, sw + 8, 0, TAU); ctx.fill();
    }
  } else {
    switch (st.kind) {
      case 'sentinelle': {
        ctx.fillRect(-st.r, -st.r, st.r * 2, st.r * 2);
        ctx.strokeRect(-st.r, -st.r, st.r * 2, st.r * 2);
        ctx.save();
        ctx.rotate(st.aim);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(st.r + 11, 0);
        ctx.lineWidth = 3.4 / cam.z; ctx.stroke();
        ctx.restore();
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(0, 0, 4, 0, TAU); ctx.fill();
        break;
      }
      case 'collectsat': {
        ctx.save();
        ctx.rotate(st.rot);
        ctx.beginPath();
        ctx.moveTo(st.r, 0); ctx.lineTo(0, st.r); ctx.lineTo(-st.r, 0); ctx.lineTo(0, -st.r);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = COL.e;
        ctx.beginPath();
        ctx.moveTo(-st.r - 9, 0); ctx.lineTo(st.r + 9, 0);
        ctx.stroke();
        ctx.restore();
        const k = intensityAt(st.x, st.y);
        if (k > 0) {
          ctx.fillStyle = 'rgba(141,255,168,' + (0.25 + 0.35 * Math.abs(Math.sin(now * 0.005))).toFixed(2) + ')';
          ctx.beginPath(); ctx.arc(0, 0, 4 + k * 4, 0, TAU); ctx.fill();
        }
        const bf = clamp((st.buf || 0) / CAPSULE_CHARGE, 0, 1);
        if (bf > 0.03) {
          ctx.strokeStyle = COL.e;
          ctx.lineWidth = 2 / cam.z;
          ctx.beginPath(); ctx.arc(0, 0, st.r + 6, -Math.PI / 2, -Math.PI / 2 + TAU * bf); ctx.stroke();
        }
        break;
      }
      case 'aiturret': {
        ctx.fillRect(-st.r, -st.r, st.r * 2, st.r * 2);
        ctx.strokeRect(-st.r, -st.r, st.r * 2, st.r * 2);
        ctx.save();
        ctx.rotate(st.aim);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(st.r + 11, 0);
        ctx.lineWidth = 3.4 / cam.z; ctx.stroke();
        ctx.restore();
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(0, 0, 4, 0, TAU); ctx.fill();
        break;
      }
      case 'spatiale': {
        const lvl = st.lvl || 1;
        ctx.save();
        ctx.rotate(st.rot * 0.4);
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = i / 8 * TAU;
          const rr = st.r;
          if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
          else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
        for (let i = 0; i < 4; i++) {
          const a = st.rot * 0.4 + i / 4 * TAU;
          ctx.strokeStyle = i < lvl + 1 ? c : 'rgba(92,232,201,0.25)';
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * st.r * 0.5, Math.sin(a) * st.r * 0.5);
          ctx.lineTo(Math.cos(a) * (st.r + 12), Math.sin(a) * (st.r + 12));
          ctx.stroke();
        }
        ctx.strokeStyle = st.flash > 0 ? '#ffffff' : c;
        ctx.beginPath(); ctx.arc(0, 0, st.r * 0.45, 0, TAU); ctx.stroke();
        for (let i = 0; i < 3; i++) {
          ctx.beginPath(); ctx.arc((i - 1) * 8, 0, 3, 0, TAU);
          if (i < lvl) { ctx.fillStyle = i === 2 ? COL.amber : c; ctx.fill(); }
          else ctx.stroke();
        }
        const job = st.up || st.rebuild;
        if (job) {
          ctx.strokeStyle = st.rebuild ? COL.amber : c;
          ctx.lineWidth = 2.4 / cam.z;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.arc(0, 0, st.r + 18, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(job.t / job.total, 0, 1));
          ctx.stroke();
          ctx.setLineDash([]);
        }
        break;
      }
      case 'gate': {
        ctx.save();
        ctx.rotate(st.rot);
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.arc(0, 0, st.r, i / 4 * TAU + 0.2, (i + 1) / 4 * TAU - 0.2);
          ctx.lineWidth = 3.5 / cam.z;
          ctx.stroke();
        }
        ctx.restore();
        const sw = st.r * (0.35 + 0.2 * Math.sin(now * 0.003));
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, sw + 8);
        const rgb2 = st.side === 'player' ? '92,232,201' : '255,66,84';
        g.addColorStop(0, 'rgba(' + rgb2 + ',0.85)');
        g.addColorStop(1, 'rgba(' + rgb2 + ',0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, sw + 8, 0, TAU); ctx.fill();
        break;
      }
    }
  }
  // chantier en cours : arc de progression
  if (st.build) {
    ctx.strokeStyle = 'rgba(255,180,84,0.85)';
    ctx.lineWidth = 2.2 / cam.z;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(0, 0, st.r + 9, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(st.build.t / st.build.total, 0, 1));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // relocalisation : arc de repli/déploiement
  if (st.mob && st.mob.phase !== 'move') {
    ctx.strokeStyle = 'rgba(255,180,84,0.85)';
    ctx.lineWidth = 2.2 / cam.z;
    ctx.setLineDash([3, 3]);
    const k = clamp(st.mob.t / st.mob.total, 0, 1);
    ctx.beginPath();
    // repli : l'arc se vide ; déploiement : il se remplit
    ctx.arc(0, 0, st.r + 9, -Math.PI / 2, -Math.PI / 2 + TAU * (st.mob.phase === 'pack' ? 1 - k : k));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
  // transit : trajectoire pointillée vers la destination
  if (st.mob && st.mob.phase === 'move') {
    ctx.strokeStyle = 'rgba(92,232,201,0.45)';
    ctx.lineWidth = 1.2 / cam.z;
    ctx.setLineDash([6, 8]);
    ctx.beginPath(); ctx.moveTo(st.x, st.y); ctx.lineTo(st.mob.dest.x, st.mob.dest.y); ctx.stroke();
    ctx.setLineDash([]);
  }
  hpBar(st);
}

function drawAIMother(now) {
  const m = aimother;
  const k = m.r / 50;
  ctx.save();
  ctx.translate(m.x, m.y);

  // coque (rouge, grandit avec l'hostilité)
  ctx.save();
  ctx.rotate(m.ang);
  ctx.scale(k, k);
  
  const img = svgPret('aimother');
  if (img) {
    const scale = UNIT_SCALES['aimother'];
    if (m.flash > 0) {
      ctx.filter = 'brightness(0) invert(1)';
    }
    ctx.drawImage(img, -60 / scale, -60 / scale, 120 / scale, 120 / scale);
    if (m.flash > 0) {
      ctx.filter = 'none';
    }
  } else {
    ctx.lineWidth = 1.8 / (cam.z * k);
    ctx.strokeStyle = m.flash > 0 ? '#ffffff' : COL.a;
    ctx.fillStyle = 'rgba(46,12,16,0.95)';
    ctx.beginPath();
    ctx.moveTo(54, 0); ctx.lineTo(26, 19); ctx.lineTo(-30, 24); ctx.lineTo(-48, 11);
    ctx.lineTo(-48, -11); ctx.lineTo(-30, -24); ctx.lineTo(26, -19);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(54, 0); ctx.lineTo(-48, 0); ctx.stroke();
  }
  ctx.restore();

  // l'œil
  const eye = (9 + Math.sin(now * 0.002) * 3) * k;
  const g2 = ctx.createRadialGradient(0, 0, 0, 0, 0, eye * 2.6);
  g2.addColorStop(0, '#ff8d97');
  g2.addColorStop(0.45, 'rgba(255,66,84,0.85)');
  g2.addColorStop(1, 'rgba(255,66,84,0)');
  ctx.fillStyle = g2;
  ctx.beginPath(); ctx.arc(0, 0, eye * 2.6, 0, TAU); ctx.fill();
  ctx.restore();
  hpBar(m);
}

/* sockets de modules dessinés autour de la coque (remplis quand achetés) */
const MOD_SOCKETS = [
  [-6, -22], [-6, 22], [-22, -14], [-22, 14], [-34, -6], [-34, 6]
];
function drawMother(now) {
  const m = mother;
  ctx.save();
  ctx.translate(m.x, m.y);

  // bulle de bouclier
  if (m.shieldMax > 0 && m.shield > 1) {
    const k = m.shield / m.shieldMax;
    ctx.strokeStyle = 'rgba(159,198,255,' + (0.18 + 0.5 * m.shieldFlash + 0.1 * k).toFixed(2) + ')';
    ctx.lineWidth = (1.5 + m.shieldFlash * 4) / cam.z;
    ctx.beginPath(); ctx.arc(0, 0, m.r + 16, 0, TAU); ctx.stroke();
  }

  ctx.rotate(m.ang);
  // la coque est dessinée à l'échelle de la base : elle grossit avec les modules
  const k = m.r / 41;
  ctx.scale(k, k);
  
  const img = svgPret('mother');
  if (img) {
    const scale = UNIT_SCALES['mother'];
    if (m.flash > 0) {
      ctx.filter = 'brightness(0) invert(1)';
    }
    ctx.drawImage(img, -60 / scale, -60 / scale, 120 / scale, 120 / scale);
    if (m.flash > 0) {
      ctx.filter = 'none';
    }
  } else {
    ctx.lineWidth = 1.8 / (cam.z * k);
    ctx.strokeStyle = m.flash > 0 ? '#ffffff' : COL.p;
    ctx.fillStyle = 'rgba(13,40,36,0.95)';
    // coque
    ctx.beginPath();
    ctx.moveTo(46, 0); ctx.lineTo(22, 15); ctx.lineTo(-26, 19); ctx.lineTo(-40, 9);
    ctx.lineTo(-40, -9); ctx.lineTo(-26, -19); ctx.lineTo(22, -15);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // épine dorsale
    ctx.beginPath(); ctx.moveTo(46, 0); ctx.lineTo(-40, 0); ctx.stroke();
    // proue lumineuse
    ctx.fillStyle = COL.p;
    ctx.beginPath(); ctx.arc(30, 0, 3.5 + Math.sin(now * 0.004) * 1, 0, TAU); ctx.fill();
  }

  // sockets de modules : se remplissent quand le module est installé
  MOD_KEYS.forEach((key, i) => {
    const [sx, sy] = MOD_SOCKETS[i];
    const lvl = mods[key];
    ctx.beginPath(); ctx.arc(sx, sy, 4, 0, TAU);
    if (lvl > 0) {
      ctx.fillStyle = lvl >= MODULES[key].max ? COL.amber : COL.p;
      ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(92,232,201,0.35)';
      ctx.lineWidth = 1 / cam.z;
      ctx.stroke();
      ctx.strokeStyle = COL.p;
      ctx.lineWidth = 1.8 / cam.z;
    }
  });

  ctx.restore();

  // barres coque + bouclier
  const w = m.r * 2.2, y0 = m.y - m.r - 18;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(m.x - w / 2, y0, w, 4);
  ctx.fillStyle = m.hp / m.maxHp > 0.35 ? COL.p : COL.amber;
  ctx.fillRect(m.x - w / 2, y0, w * clamp(m.hp / m.maxHp, 0, 1), 4);
  if (m.shieldMax > 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(m.x - w / 2, y0 - 6, w, 3);
    ctx.fillStyle = '#9fc6ff';
    ctx.fillRect(m.x - w / 2, y0 - 6, w * clamp(m.shield / m.shieldMax, 0, 1), 3);
  }

  // v14.8 : chasseurs embarqués — petits points sous la barre de coque
  const stowed = ships.reduce((a, s) => a + (s.kind === 'cdrone' && s.docked && !s.dead ? 1 : 0), 0);
  if (stowed > 0) {
    ctx.fillStyle = COL.p;
    for (let i = 0; i < stowed; i++) ctx.fillRect(m.x - w / 2 + i * 5, y0 + 6, 3, 3);
  }
}

function drawShip(s, now) {
  const isCapsule = s.kind === 'capsule';
  const c = isCapsule ? COL.e : sideCol(s.side);
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.ang);

  const img = svgPret(s.kind, s.side);
  if (img) {
    const scale = UNIT_SCALES[s.kind] || 1;
    if (s.flash > 0) {
      ctx.filter = 'brightness(0) invert(1)';
    }
    ctx.drawImage(img, -60 / scale, -60 / scale, 120 / scale, 120 / scale);
    if (s.flash > 0) {
      ctx.filter = 'none';
    }
  } else {
    ctx.lineWidth = 1.5 / cam.z;
    ctx.strokeStyle = s.flash > 0 ? '#ffffff' : c;
    ctx.fillStyle = isCapsule ? 'rgba(20,46,26,0.9)'
      : s.side === 'player' ? 'rgba(15,46,41,0.9)'
      : s.side === 'hive' ? 'rgba(34,16,48,0.9)' : 'rgba(46,12,16,0.9)';
    ctx.beginPath();
    switch (s.kind) {
      case 'cdrone':
        ctx.moveTo(7, 0); ctx.lineTo(-5, 4.5); ctx.lineTo(-2.5, 0); ctx.lineTo(-5, -4.5); break;
      case 'capsule':
        ctx.moveTo(5, 0); ctx.lineTo(2.5, 4.3); ctx.lineTo(-2.5, 4.3); ctx.lineTo(-5, 0); ctx.lineTo(-2.5, -4.3); ctx.lineTo(2.5, -4.3); break;
      case 'probe':
        ctx.moveTo(7, 0); ctx.lineTo(-2, 3.5); ctx.lineTo(-5, 1.5); ctx.lineTo(-5, -1.5); ctx.lineTo(-2, -3.5); break;
      case 'cargo':
        ctx.moveTo(13, 4); ctx.lineTo(16, 0); ctx.lineTo(13, -4); ctx.lineTo(-13, -8); ctx.lineTo(-16, 0); ctx.lineTo(-13, 8); break;
      case 'cminer':
        ctx.moveTo(4.5, 0); ctx.lineTo(-3.5, 3); ctx.lineTo(-3.5, -3); break;
      case 'corvette':
        ctx.moveTo(10, 0); ctx.lineTo(2, 5); ctx.lineTo(-6, 8); ctx.lineTo(-4, 0); ctx.lineTo(-6, -8); ctx.lineTo(2, -5); break;
      case 'lanceur':
        ctx.moveTo(14, 1.6); ctx.lineTo(14, -1.6); ctx.lineTo(2, -3.5); ctx.lineTo(-8, -6); ctx.lineTo(-11, 0); ctx.lineTo(-8, 6); ctx.lineTo(2, 3.5); break;
      case 'vhangar':
        ctx.moveTo(10, 7); ctx.lineTo(12, 0); ctx.lineTo(10, -7); ctx.lineTo(-10, -7); ctx.lineTo(-12, 0); ctx.lineTo(-10, 7); break;
      case 'miner':
        ctx.moveTo(5, 4); ctx.lineTo(-6, 4); ctx.lineTo(-6, -4); ctx.lineTo(5, -4); ctx.lineTo(8, 0); break;
      case 'drone':
        ctx.moveTo(7, 0); ctx.lineTo(0, 5); ctx.lineTo(-7, 0); ctx.lineTo(0, -5); break;
      case 'raider':
        ctx.moveTo(10, 0); ctx.lineTo(-4, 7); ctx.lineTo(-1, 0); ctx.lineTo(-4, -7); break;
      case 'dread':
        ctx.moveTo(18, 0); ctx.lineTo(6, 10); ctx.lineTo(-10, 10); ctx.lineTo(-14, 0); ctx.lineTo(-10, -10); ctx.lineTo(6, -10); break;
      // v13 — silhouettes synthétiques du Collectif
      case 'h_essaim':
        ctx.moveTo(8, 0); ctx.lineTo(-2, 4); ctx.lineTo(-5, 1.5); ctx.lineTo(-3, 0); ctx.lineTo(-5, -1.5); ctx.lineTo(-2, -4); break;
      case 'h_bastion':
        for (let i = 0; i < 7; i++) {
          const a = i / 7 * TAU, rr = i % 2 ? 8 : 12;
          i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        break;
      case 'h_recolteur':
        for (let i = 0; i < 5; i++) {
          const a = i / 5 * TAU;
          i ? ctx.lineTo(Math.cos(a) * 7, Math.sin(a) * 7) : ctx.moveTo(7, 0);
        }
        break;
      case 'h_epine': // dard d'artillerie
        ctx.moveTo(13, 0); ctx.lineTo(-5, 4); ctx.lineTo(-8, 1.5); ctx.lineTo(-8, -1.5); ctx.lineTo(-5, -4); break;
      case 'h_traqueur': // fléchette d'éclairage
        ctx.moveTo(6, 0); ctx.lineTo(-4, 3); ctx.lineTo(-1.5, 0); ctx.lineTo(-4, -3); break;
      case 'h_entrepot': // silo octogonal
        for (let i = 0; i < 8; i++) {
          const a = i / 8 * TAU + TAU / 16;
          i ? ctx.lineTo(Math.cos(a) * 12, Math.sin(a) * 12) : ctx.moveTo(Math.cos(a) * 12, Math.sin(a) * 12);
        }
        break;
      case 'h_synapse': // capteur en losange
        ctx.moveTo(9, 0); ctx.lineTo(0, 7); ctx.lineTo(-9, 0); ctx.lineTo(0, -7); break;
      // v15.8 — le palier supérieur (repli vectoriel si le SVG manque)
      case 'h_couveuse': // ruche : hexagone alvéolé
        for (let i = 0; i < 6; i++) {
          const a = i / 6 * TAU + TAU / 12;
          i ? ctx.lineTo(Math.cos(a) * 13, Math.sin(a) * 13) : ctx.moveTo(Math.cos(a) * 13, Math.sin(a) * 13);
        }
        break;
      case 'h_matrice': // noyau à douze faces
        for (let i = 0; i < 12; i++) {
          const a = i / 12 * TAU, rr = i % 2 ? 10 : 14;
          i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        break;
      case 'h_colosse': // masse trapue à mâchoires
        ctx.moveTo(15, 0); ctx.lineTo(6, 9); ctx.lineTo(-8, 12); ctx.lineTo(-13, 5);
        ctx.lineTo(-8, 0); ctx.lineTo(-13, -5); ctx.lineTo(-8, -12); ctx.lineTo(6, -9); break;
      case 'h_dard': // long fer de lance
        ctx.moveTo(18, 0); ctx.lineTo(2, 3.5); ctx.lineTo(-6, 6); ctx.lineTo(-10, 2);
        ctx.lineTo(-10, -2); ctx.lineTo(-6, -6); ctx.lineTo(2, -3.5); break;
      case 'h_nuee': // triple dard groupé
        ctx.moveTo(8, 0); ctx.lineTo(0, 5); ctx.lineTo(-4, 2); ctx.lineTo(-1, 0);
        ctx.lineTo(-4, -2); ctx.lineTo(0, -5); break;
    }
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  }

  if (s.kind === 'miner' && s.cargo > 0) {
    // cargaison de métal visible
    ctx.fillStyle = COL.amber;
    ctx.fillRect(-3, -2, 5, 4);
  }
  if (isCapsule) {
    // cœur d'énergie pulsant
    ctx.fillStyle = 'rgba(141,255,168,' + (0.5 + 0.4 * Math.abs(Math.sin(now * 0.008 + s.id))).toFixed(2) + ')';
    ctx.beginPath(); ctx.arc(0, 0, 2.4, 0, TAU); ctx.fill();
  }
  if (s.kind === 'probe') {
    // feu de signalisation de la cargaison
    ctx.fillStyle = 'rgba(255,180,84,' + (0.4 + 0.6 * Math.abs(Math.sin(now * 0.012 + s.id))).toFixed(2) + ')';
    ctx.fillRect(-1.5, -1.5, 3, 3);
  }
  if (s.kind === 'cargo') {
    // jauge de soute (remplissage ambre)
    const k = clamp((s.load || 0) / CARGO_FULL, 0, 1);
    if (k > 0.02) { ctx.fillStyle = COL.amber; ctx.fillRect(-11, -3, 20 * k, 6); }
    ctx.strokeStyle = 'rgba(255,180,84,0.5)';
    ctx.lineWidth = 0.8 / cam.z;
    ctx.strokeRect(-11, -3, 20, 6);
  }
  if (s.kind === 'cminer' && s.carga > 0) {
    ctx.fillStyle = COL.amber;
    ctx.fillRect(-2, -1.5, 3, 3);
  }
  if (s.kind === 'h_synapse') {
    // œil du capteur, pulsation lente
    ctx.fillStyle = c;
    ctx.globalAlpha = 0.35 + 0.5 * Math.abs(Math.sin(now * 0.003 + s.id));
    ctx.beginPath(); ctx.arc(0, 0, 3, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (s.kind === 'h_entrepot') {
    // casiers de stockage
    ctx.fillStyle = COL.amber; ctx.fillRect(-6, -2, 5, 4);
    ctx.fillStyle = COL.e; ctx.fillRect(1, -2, 5, 4);
  }
  if (s.kind === 'h_recolteur' && (s.load || 0) > 0) {
    // jauge de cargaison : ambre = métal, vert = énergie
    const k = clamp(s.load / RECOLT_CAP, 0, 1);
    ctx.fillStyle = s.res === 'e' ? COL.e : COL.amber;
    ctx.fillRect(-4, -1.5, 8 * k, 3);
  }
  if (s.kind === 'vhangar') {
    // baie d'accueil
    ctx.strokeStyle = s.docked ? COL.p : 'rgba(92,232,201,0.45)';
    ctx.lineWidth = 1 / cam.z;
    ctx.strokeRect(-7, -4, 14, 8);
  }
  const fl = 0.4 + 0.6 * Math.abs(Math.sin(now * 0.02 + s.id));
  ctx.fillStyle = s.side === 'player' ? 'rgba(92,232,201,' + (fl * 0.7).toFixed(2) + ')'
    : s.side === 'hive' ? 'rgba(199,125,255,' + (fl * 0.7).toFixed(2) + ')'
    : 'rgba(255,120,90,' + (fl * 0.7).toFixed(2) + ')';
  ctx.beginPath(); ctx.arc(-s.r - 1, 0, 2, 0, TAU); ctx.fill();
  ctx.restore();

  // v15.8 : fusion en cours — filament tendu entre les deux corps + arc de l'hôte
  if (s.fus) {
    const f = s.fus;
    if (f.mate && !f.mate.dead) {
      ctx.strokeStyle = 'rgba(199,125,255,' + (0.35 + 0.35 * Math.abs(Math.sin(now * 0.008))).toFixed(2) + ')';
      ctx.lineWidth = 2 / cam.z;
      ctx.setLineDash([3, 5]);
      ctx.lineDashOffset = -now * 0.05;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(f.mate.x, f.mate.y); ctx.stroke();
      ctx.setLineDash([]);
      const k = clamp(f.t / f.total, 0, 1);
      ctx.strokeStyle = COL.h;
      ctx.lineWidth = 2.4 / cam.z;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r + 11, -Math.PI / 2, -Math.PI / 2 + k * TAU); ctx.stroke();
    } else if (f.host) { // le corps absorbé se creuse
      ctx.strokeStyle = 'rgba(199,125,255,0.5)';
      ctx.lineWidth = 1.2 / cam.z;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r + 4, 0, TAU); ctx.stroke();
    }
  }

  // v13 : cocon de mutation — membrane pulsante + arc de progression
  if (s.mut) {
    const k = clamp(s.mut.t / s.mut.total, 0, 1);
    ctx.strokeStyle = 'rgba(199,125,255,' + (0.35 + 0.3 * Math.abs(Math.sin(now * 0.006 + s.id))).toFixed(2) + ')';
    ctx.lineWidth = 1.4 / cam.z;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r + 5 + Math.sin(now * 0.006 + s.id) * 1.5, 0, TAU); ctx.stroke();
    ctx.strokeStyle = COL.h;
    ctx.lineWidth = 2.2 / cam.z;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r + 9, -Math.PI / 2, -Math.PI / 2 + k * TAU); ctx.stroke();
  }

  // rayon minier (récolteur du Collectif : faisceau violet)
  const drill = (s.kind === 'miner' && s.task === 'mine' && s.ast) || (s.kind === 'cminer' && s.sub === 'dig' && s.ast)
    || (s.kind === 'h_recolteur' && s.ast && dist(s.x, s.y, s.ast.x, s.ast.y) <= s.ast.r + 16);
  if (drill) {
    ctx.strokeStyle = s.side === 'hive' ? 'rgba(199,125,255,0.7)' : 'rgba(255,180,84,0.7)';
    ctx.lineWidth = 1.4 / cam.z;
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -now * 0.02;
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.ast.x, s.ast.y); ctx.stroke();
    ctx.setLineDash([]);
  }
  hpBar(s);
}

function drawFog() {
  if (state === 'intro') return;
  ctx.globalAlpha = 0.55; // zones explorées mais hors de vue : assombries
  ctx.drawImage(fogVis, 0, 0, WORLD.w, WORLD.h);
  ctx.globalAlpha = 0.94; // zones inexplorées : noires
  ctx.drawImage(fogExp, 0, 0, WORLD.w, WORLD.h);
  ctx.globalAlpha = 1;
}

function drawShots() {
  ctx.lineCap = 'round';
  for (const sh of shots) {
    if (!isVisible(sh.x, sh.y, 30)) continue;
    const dx = Math.cos(sh.ang), dy = Math.sin(sh.ang);
    const c = sideCol(sh.side);
    const len = sh.heavy ? 20 : 12;
    ctx.strokeStyle = sh.side === 'player' ? 'rgba(92,232,201,0.25)'
      : sh.side === 'hive' ? 'rgba(199,125,255,0.25)' : 'rgba(255,66,84,0.25)';
    ctx.lineWidth = (sh.heavy ? 8 : 5) / cam.z;
    ctx.beginPath(); ctx.moveTo(sh.x - dx * len, sh.y - dy * len); ctx.lineTo(sh.x, sh.y); ctx.stroke();
    ctx.strokeStyle = c;
    ctx.lineWidth = (sh.heavy ? 2.8 : 1.8) / cam.z;
    ctx.beginPath(); ctx.moveTo(sh.x - dx * len, sh.y - dy * len); ctx.lineTo(sh.x, sh.y); ctx.stroke();
  }
  ctx.lineCap = 'butt';
}
function drawParts() {
  for (const p of parts) {
    if (!isVisible(p.x, p.y, 10)) continue;
    ctx.globalAlpha = clamp(p.life * 2.5, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
  }
  ctx.globalAlpha = 1;
}
function drawBooms() {
  for (const f of fxs) {
    if (!isVisible(f.x, f.y, f.r)) continue;
    const k = f.t / f.dur;
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = f.color;
    ctx.lineWidth = 2.5 / cam.z;
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r * k, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r * k * 0.55, 0, TAU); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
function drawFocus(now) {
  if (!focusTgt || focusTgt.dead) return;
  const e = focusTgt;
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(now * 0.002);
  ctx.strokeStyle = COL.a;
  ctx.lineWidth = 1.6 / cam.z;
  const r = e.r + 12;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(0, 0, r, i / 4 * TAU + 0.25, i / 4 * TAU + 1.1);
    ctx.stroke();
  }
  ctx.restore();
}
function drawDest(now) {
  if (!mother || mother.dead || !mother.dest) return;
  const d = mother.dest;
  ctx.strokeStyle = 'rgba(92,232,201,0.5)';
  ctx.lineWidth = 1.2 / cam.z;
  ctx.setLineDash([6, 8]);
  ctx.beginPath(); ctx.moveTo(mother.x, mother.y); ctx.lineTo(d.x, d.y); ctx.stroke();
  ctx.setLineDash([]);
  const k = 1 - (now % 900) / 900;
  ctx.strokeStyle = 'rgba(92,232,201,' + (0.3 + 0.5 * k).toFixed(2) + ')';
  ctx.beginPath(); ctx.arc(d.x, d.y, 6 + 14 * k, 0, TAU); ctx.stroke();
}

/* ===== minimap ===== */
function drawMinimap(now) {
  const mw = mmCv.width, mh = mmCv.height;
  const sx = mw / WORLD.w, sy = mh / WORLD.h;
  mmCtx.fillStyle = '#020409';
  mmCtx.fillRect(0, 0, mw, mh);
  // champs de radiation
  for (const p of pulsars) {
    mmCtx.fillStyle = 'rgba(141,255,168,0.13)';
    mmCtx.beginPath();
    mmCtx.arc(p.x * sx, p.y * sy, p.r * sx, 0, TAU);
    mmCtx.fill();
  }
  for (const a of asteroids) {
    mmCtx.fillStyle = a.stock > 0 ? 'rgba(255,180,84,0.8)' : 'rgba(84,97,122,0.5)';
    mmCtx.fillRect(a.x * sx - 1, a.y * sy - 1, 2, 2);
  }
  for (const s of structs) {
    if (s.side === 'ai' && !s.seen) continue;
    mmCtx.fillStyle = s.side === 'player' ? COL.p : COL.a;
    const sz = s.kind === 'spatiale' || s.kind === 'gate' ? 5 : 3;
    mmCtx.fillRect(s.x * sx - sz / 2, s.y * sy - sz / 2, sz, sz);
  }
  for (const s of ships) {
    if (s.docked) continue;
    if (s.side !== 'player' && !isVisible(s.x, s.y, s.r)) continue;
    mmCtx.fillStyle = s.side === 'player' ? 'rgba(92,232,201,0.8)'
      : s.side === 'hive' ? 'rgba(199,125,255,0.85)' : 'rgba(255,66,84,0.8)';
    mmCtx.fillRect(s.x * sx - 0.75, s.y * sy - 0.75, 1.5, 1.5);
  }
  // brouillard sur la minimap
  if (state !== 'intro') {
    mmCtx.globalAlpha = 0.45;
    mmCtx.drawImage(fogVis, 0, 0, mw, mh);
    mmCtx.globalAlpha = 0.9;
    mmCtx.drawImage(fogExp, 0, 0, mw, mh);
    mmCtx.globalAlpha = 1;
  }
  if (aimother && !aimother.dead && isVisible(aimother.x, aimother.y, aimother.r)) {
    mmCtx.fillStyle = '#ffb9bf';
    mmCtx.fillRect(aimother.x * sx - 2.5, aimother.y * sy - 2.5, 5, 5);
    mmCtx.strokeStyle = COL.a;
    mmCtx.lineWidth = 1;
    mmCtx.strokeRect(aimother.x * sx - 4, aimother.y * sy - 4, 8, 8);
  }
  if (mother && !mother.dead) {
    mmCtx.fillStyle = '#eafff9';
    mmCtx.fillRect(mother.x * sx - 2.5, mother.y * sy - 2.5, 5, 5);
    mmCtx.strokeStyle = COL.p;
    mmCtx.lineWidth = 1;
    mmCtx.strokeRect(mother.x * sx - 4, mother.y * sy - 4, 8, 8);
  }
  mmCtx.strokeStyle = 'rgba(184,216,208,0.6)';
  mmCtx.lineWidth = 1;
  mmCtx.strokeRect(
    (cam.x - vw / 2 / cam.z) * sx, (cam.y - vh / 2 / cam.z) * sy,
    vw / cam.z * sx, vh / cam.z * sy
  );
}

/* ============================================================
   INTERFACE
   ============================================================ */
const EL_IDS = {
  metal: 'res-metal', mrate: 'res-mrate', energy: 'res-energy', erate: 'res-erate',
  fleet: 'res-fleet', miner: 'res-miner',
  time: 'game-time', panel: 'mother-status',
};
const el = {};
// résolution paresseuse : survit aux remplacements de DOM du hot reload (bun, etc.)
function resolveEls() {
  for (const k in EL_IDS) {
    if (!el[k] || !el[k].isConnected) el[k] = document.getElementById(EL_IDS[k]);
    if (!el[k]) return false;
  }
  return true;
}
let uiAcc = 0;
function updateHUD(dt) {
  uiAcc += dt;
  if (uiAcc < 0.12) return;
  uiAcc = 0;
  if (!resolveEls()) return; // DOM pas (encore) en phase avec le script
  el.metal.textContent = Math.floor(metal);
  el.mrate.textContent = '+' + mRateSample.rate.toFixed(1) + '/s';
  el.energy.textContent = Math.floor(energy);
  el.erate.textContent = '+' + energyRate().toFixed(1) + '/s';
  if (faction === 'collective') {
    el.fleet.textContent = ships.reduce((a, s) => a + (s.side === 'player' && COMBAT_KINDS.includes(s.kind) && !s.dead ? 1 : 0), 0);
    el.miner.textContent = ships.reduce((a, s) => a + (s.side === 'player' && s.kind === 'h_recolteur' && !s.dead ? 1 : 0), 0);
  } else {
    el.fleet.textContent = cdrones().length + '/' + cdroneCap();
    el.miner.textContent = miners().length + '/' + minerCap();
  }
  el.time.textContent = fmtTime(gameT);

  // panneaux de construction : contextuels — Arche sélectionnée → modules ; Station sélectionnée → chantier naval
  const motherSel = mother && !mother.dead && sel.includes(mother);
  // v15.7 : l'IA a aussi des Stations Spatiales — n'ouvrir le panneau que sur les nôtres
  const stSel = !motherSel ? sel.find(u => u.kind === 'spatiale' && u.side === 'player' && !u.dead) : null;
  const modPanel = document.getElementById('mod-panel');
  if (modPanel) modPanel.classList.toggle('hidden', !motherSel);
  const stPanel = document.getElementById('station-panel');
  if (stPanel) {
    stPanel.classList.toggle('hidden', !stSel);
    if (stSel) updateStationPanel(stSel);
  }
  // v14.1 : panneau de mutations du Collectif (sélection d'entités du joueur)
  const hiveSel = sel.filter(u => u.side === 'player' && !u.dead && MUTATIONS[u.kind]);
  const hivePanel = document.getElementById('hive-panel');
  if (hivePanel) {
    hivePanel.classList.toggle('hidden', !hiveSel.length);
    if (hiveSel.length) updateHivePanel(hiveSel);
  }

  // lignes de modules
  const bq = mother && mother.buildQ;
  document.querySelectorAll('.mrow').forEach(row => {
    const k = row.dataset.mod;
    const m = MODULES[k];
    if (!m) return; // idem : tolère un DOM d'une autre version
    const lvl = mods[k];
    const pips = row.querySelector('.pips');
    const cost = row.querySelector('.c');
    pips.textContent = '●'.repeat(lvl) + '○'.repeat(m.max - lvl);
    if (bq && bq.key === k) {
      // chantier en cours sur ce module
      cost.textContent = Math.ceil(bq.total - bq.t) + 's';
      row.style.setProperty('--prog', Math.floor(bq.t / bq.total * 100) + '%');
      row.classList.remove('maxed', 'nope');
    } else {
      row.style.setProperty('--prog', '0%');
      if (lvl >= m.max) {
        cost.textContent = 'MAX';
        row.classList.add('maxed');
        row.classList.remove('nope');
      } else {
        const c = m.cost[lvl];
        cost.textContent = coutTxt(c);
        row.classList.remove('maxed');
        row.classList.toggle('nope', metal < c.m || energy < c.e || !!bq);
      }
    }
  });
  document.querySelectorAll('.bbtn[data-sat]').forEach(b => {
    const c = SATS[b.dataset.sat];
    if (!c) return; // DOM et script désynchronisés (hot reload) : on ignore
    const unique = b.dataset.sat === 'spatiale' && spatialeExists();
    b.classList.toggle('nope', metal < c.m || energy < c.e || unique);
    b.classList.toggle('active', b.dataset.sat === placing);
  });

  // panneau du bas : sélection ou état de l'Arche
  const html = bottomPanelHTML();
  if (html !== el.panel._last) { el.panel._last = html; el.panel.innerHTML = html; }
}

function hpbarHTML(ratio, cls) {
  return '<div class="hpbar"><i class="' + (cls || '') + '" style="width:' + Math.floor(clamp(ratio, 0, 1) * 100) + '%"></i></div>';
}
function motherPanelHTML() {
  const rad = intensityAt(mother.x, mother.y);
  return '<span class="sname">L\'ARCHE</span>' +
    '<div class="stat"><label>COQUE</label>' + hpbarHTML(mother.hp / mother.maxHp) + '</div>' +
    '<div class="stat"><label>BOUCLIER</label>' + hpbarHTML(mother.shieldMax > 0 ? mother.shield / mother.shieldMax : 0, 'blue') + '</div>' +
    '<span class="ms-info">' +
    Math.ceil(mother.hp) + '/' + mother.maxHp + ' · vit ' + Math.round(motherSpeed()) + ' · ' +
    (rad > 0.05 ? 'radiations ' + Math.round(rad * 100) + '% · ' : 'hors radiations · ') +
    (mother.repairing ? 'réparation · ' : '') +
    (motherProducing() ? 'production (ralentie) · ' : '') +
    (focusTgt && !focusTgt.dead ? 'cible verrouillée' : (mother.dest ? 'en route' : 'en station')) +
    '</span>';
}
// fiche d'état (bandeau bas) — les actions vivent dans #station-panel
function spatialePanelHTML(st) {
  const lvl = st.lvl || 1;
  const spec = yardSpec(st);
  const nq = st.queue ? st.queue.length : 0;
  let status = '';
  if (st.build) status = 'déploiement ' + Math.ceil(st.build.total - st.build.t) + 's';
  else if (st.up) status = 'amélioration → niv ' + (lvl + 1) + ' : ' + Math.ceil(st.up.total - st.up.t) + 's';
  else if (st.yardUp) status = 'chantier → niv ' + (yardLvl(st) + 1) + ' : ' + Math.ceil(st.yardUp.total - st.yardUp.t) + 's';
  else if (st.rebuild) status = '<span style="color:#ffd9a3">RECONSTRUCTION DE L\'ARCHE : ' + Math.ceil(st.rebuild.total - st.rebuild.t) + 's</span>';
  else if (st.mob) status = mobLabel(st);
  else status = 'dmg ' + STRUCTS.spatiale.dmg * lvl + ' · portée ' + STRUCTS.spatiale.range +
    ' · chantier niv ' + yardLvl(st) + ' (' + spec.lines + '×) ' +
    (nq ? 'file ' + nq + '/' + spec.cap : 'libre') +
    (st.rally ? ' · ralliement défini' : '');
  return '<span class="sname">STATION SPATIALE</span>' +
    '<span class="ms-info">niv ' + '●'.repeat(lvl) + '○'.repeat(3 - lvl) + '</span>' +
    hpbarHTML(st.hp / st.maxHp) +
    '<span class="ms-info">' + Math.ceil(st.hp) + '/' + st.maxHp + ' · ' + status + '</span>';
}

/* ===== panneau de la station (même modèle que celui de l'Arche) ===== */
function updateStationPanel(st) {
  const lvl = st.lvl || 1;
  st.queue = st.queue || [];

  // ligne Améliorer
  const up = document.querySelector('#station-panel [data-stact="upgrade"]');
  if (up) {
    up.querySelector('.pips').textContent = '●'.repeat(lvl) + '○'.repeat(3 - lvl);
    const c = up.querySelector('.c');
    if (st.up) {
      c.textContent = Math.ceil(st.up.total - st.up.t) + 's';
      up.style.setProperty('--prog', Math.floor(st.up.t / st.up.total * 100) + '%');
      up.classList.remove('maxed', 'nope');
    } else {
      up.style.setProperty('--prog', '0%');
      if (lvl >= 3) { c.textContent = 'MAX'; up.classList.add('maxed'); up.classList.remove('nope'); }
      else {
        const co = SPATIALE_UP[lvl - 1];
        c.textContent = coutTxt(co);
        up.classList.remove('maxed');
        up.classList.toggle('nope', metal < co.m || energy < co.e || !!st.build);
      }
    }
  }
  // ligne Chantier naval (extension de la file de production)
  const yd = document.querySelector('#station-panel [data-stact="yard"]');
  if (yd) {
    const yl = yardLvl(st);
    yd.querySelector('.pips').textContent = '●'.repeat(yl) + '○'.repeat(3 - yl);
    const c = yd.querySelector('.c');
    if (st.yardUp) {
      c.textContent = Math.ceil(st.yardUp.total - st.yardUp.t) + 's';
      yd.style.setProperty('--prog', Math.floor(st.yardUp.t / st.yardUp.total * 100) + '%');
      yd.classList.remove('maxed', 'nope');
    } else {
      yd.style.setProperty('--prog', '0%');
      if (yl >= 3) { c.textContent = 'MAX'; yd.classList.add('maxed'); yd.classList.remove('nope'); }
      else {
        const co = YARD_UP[yl - 1];
        c.textContent = lvl <= yl ? 'station niv ' + (yl + 1) : coutTxt(co);
        yd.classList.remove('maxed');
        yd.classList.toggle('nope', lvl <= yl || metal < co.m || energy < co.e || !!st.up || !!st.build);
      }
    }
  }
  // ligne Déplacer
  const mv = document.querySelector('#station-panel [data-stact="move"]');
  if (mv) {
    const c = mv.querySelector('.c');
    if (st.mob) {
      c.textContent = mobLabel(st);
      mv.classList.remove('nope');
      mv.style.setProperty('--prog', st.mob.phase === 'move' ? '0%' : Math.floor(st.mob.t / st.mob.total * 100) + '%');
    } else {
      mv.style.setProperty('--prog', '0%');
      const mt = mobSpec(st).t;
      c.textContent = moveOrder === st ? 'cible ?' : mt + 's + ' + mt + 's';
      mv.classList.toggle('nope', stationBusy(st));
    }
  }
  // ligne Reconstruire l'Arche (visible seulement si possible)
  const rb = document.querySelector('#station-panel [data-stact="rebuild"]');
  if (rb) {
    const dispo = lvl >= 3 && (!mother || mother.dead);
    rb.style.display = dispo ? '' : 'none';
    if (dispo) {
      const c = rb.querySelector('.c');
      if (st.rebuild) {
        c.textContent = Math.ceil(st.rebuild.total - st.rebuild.t) + 's';
        rb.style.setProperty('--prog', Math.floor(st.rebuild.t / st.rebuild.total * 100) + '%');
        rb.classList.remove('nope');
      } else {
        rb.style.setProperty('--prog', '0%');
        c.textContent = coutTxt(REBUILD_COST);
        rb.classList.toggle('nope', metal < REBUILD_COST.m || energy < REBUILD_COST.e);
      }
    }
  }
  // lignes du chantier naval
  const spec = yardSpec(st);
  const actives = st.queue.slice(0, spec.lines); // commandes en cours de construction
  document.querySelectorAll('#station-panel [data-prod]').forEach(row => {
    const kind = row.dataset.prod;
    const def = PROD[kind];
    if (!def) return;
    const c = row.querySelector('.c');
    // la plus avancée des lignes qui construisent ce type
    const enCours = actives.filter(q => q.kind === kind).sort((a, b) => b.t / b.total - a.t / a.total)[0];
    if (lvl < def.lvl) {
      c.textContent = 'niv ' + def.lvl;
      row.classList.add('maxed');
      row.classList.remove('nope');
      row.style.setProperty('--prog', '0%');
    } else {
      row.classList.remove('maxed');
      if (enCours) {
        c.textContent = Math.ceil((enCours.total - enCours.t) / spec.spd) + 's';
        row.style.setProperty('--prog', Math.floor(enCours.t / enCours.total * 100) + '%');
      } else {
        c.textContent = coutTxt(def);
        row.style.setProperty('--prog', '0%');
      }
      let plein = false;
      if (def.max) {
        const n = ships.reduce((a, s) => a + (s.kind === kind && !s.dead ? 1 : 0), 0)
          + st.queue.reduce((a, q) => a + (q.kind === kind ? 1 : 0), 0);
        plein = n >= def.max;
      }
      row.classList.toggle('nope', metal < def.m || energy < def.e || st.queue.length >= spec.cap || plein || !!st.build);
    }
  });
  // file de production : les `lines` premières avancent en parallèle
  const qEl = document.getElementById('st-queue');
  if (qEl) {
    let html = '<div class="qhead">FILE ' + st.queue.length + '/' + spec.cap
      + ' · ' + spec.lines + ' ligne' + (spec.lines > 1 ? 's' : '')
      + (st.rally ? ' · <b>ralliement</b>' : '') + '</div>';
    html += st.queue.map((q, i) => {
      const pct = i < spec.lines ? Math.floor(q.t / q.total * 100) : 0;
      return '<div class="qchip' + (i < spec.lines ? ' live' : '') + '"><i style="width:' + pct + '%"></i><span>'
        + SHIPS[q.kind].nom + '</span></div>';
    }).join('');
    if (qEl._last !== html) { qEl._last = html; qEl.innerHTML = html; }
  }
}
// v14.1 : le panneau de mutations vit dans le dock (à gauche, comme les modules
// de l'Arche). Chaque ligne montre combien d'unités sélectionnées sont éligibles.
function updateHivePanel(units) {
  // v15.8 : lignes de fusion — on compte les PAIRES réalisables dans la sélection
  document.querySelectorAll('#hive-panel .mrow[data-hfus]').forEach(row => {
    const key = row.dataset.hfus;
    const def = FUSIONS[key];
    if (!def) return;
    const paires = pairesFusion(units.filter(u => !u.mut && !u.fus), key).length;
    const cEl = row.querySelector('.c');
    if (cEl) cEl.textContent = coutTxt(def.cost);
    const p = row.querySelector('.pips');
    if (p) p.textContent = paires ? paires + '×' : '';
    row.classList.toggle('nope', !paires || metal < def.cost.m || energy < def.cost.e);
  });
  document.querySelectorAll('#hive-panel .mrow[data-hmut]').forEach(row => {
    const key = row.dataset.hmut;
    const isDiv = key === 'div';
    const elig = units.filter(u => !u.mut &&
      (isDiv ? u.kind === 'h_essaim' : u.kind !== key && MUTATIONS[u.kind].vers.includes(key)));
    const c = isDiv ? DIVIDE_COST : (HIVE_COSTS[key] || { m: 0, e: 0 });
    const cEl = row.querySelector('.c');
    if (cEl) cEl.textContent = coutTxt(c);
    const p = row.querySelector('.pips');
    if (p) p.textContent = elig.length ? elig.length + '×' : '';
    row.classList.toggle('nope', !elig.length || metal < c.m || energy < c.e);
  });
}
function collectivePanelHTML() {
  const mine = ships.filter(s => s.side === 'player' && !s.dead);
  if (!mine.length) return '';
  const by = {};
  for (const u of mine) by[u.kind] = (by[u.kind] || 0) + 1;
  const parts2 = Object.entries(by).map(([k, n]) => n + ' ' + (SHIPS[k] ? SHIPS[k].nom : k) + (n > 1 ? 's' : ''));
  const muting = mine.filter(u => u.mut).length;
  return '<span class="sname">LE COLLECTIF</span><span class="ms-info">' + parts2.join(' · ')
    + (muting ? ' · <b style="color:#c77dff">' + muting + ' en mutation</b>' : '')
    + ' · aucune tête à couper</span>';
}
function bottomPanelHTML() {
  const others = sel.filter(u => u !== mother && !u.dead);
  if (!others.length) {
    if (mother && !mother.dead) return motherPanelHTML(); // rien ou l'Arche seule → état de l'Arche
    const st = spatiale();
    if (st) return spatialePanelHTML(st);
    return faction === 'collective' ? collectivePanelHTML() : '';
  }

  // une seule unité : fiche détaillée
  if (others.length === 1 && !sel.includes(mother)) {
    const u = others[0];
    if (u.kind === 'spatiale' && u.side === 'player') return spatialePanelHTML(u);
    const d = SHIPS[u.kind] || STRUCTS[u.kind] || { nom: entName(u) };
    const enemy = u.side !== 'player';
    let stats = Math.ceil(u.hp) + '/' + u.maxHp + ' PV';
    if (u.kind === 'aimother') stats = Math.ceil(u.hp) + '/' + u.maxHp + ' PV · dmg ' + Math.round(16 + 0.12 * aiProg) + ' · portée 330';
    else if (u.build) stats += ' · construction ' + Math.ceil(u.build.total - u.build.t) + 's';
    else if (u.mob) stats += ' · ' + mobLabel(u);
    else if (u.mut) stats += ' · <b style="color:#c77dff">' + (u.mut.div ? 'division' : 'mutation') + ' → ' + SHIPS[u.mut.to].nom + ' ' + Math.ceil(u.mut.total - u.mut.t) + 's</b>';
    else if (u.kind === 'collectsat') stats += ' · capte +' + (STRUCTS.collectsat.rate * intensityAt(u.x, u.y)).toFixed(1) + '⚡/s · capsule ' + Math.floor((u.buf || 0) / CAPSULE_CHARGE * 100) + '%';
    else if (u.kind === 'capsule') stats += ' · ' + u.charge + '⚡ en transit · vit ' + SHIPS.capsule.speed;
    else if (u.kind === 'probe') stats += ' · transporte : ' + (STRUCTS[u.carry] ? STRUCTS[u.carry].nom : '?') + ' · vit ' + SHIPS.probe.speed;
    else if (u.kind === 'cargo') stats += ' · soute ' + Math.floor(u.load || 0) + '/' + CARGO_FULL + ' · ' + (u.task === 'deliver' ? 'livraison' : u.task === 'travel' ? 'en route' : 'forage') + ' · 3 drones';
    else if (u.kind === 'vhangar') stats += (u.docked ? ' · ARRIMÉ : +' + VHANGAR_CAP + ' chasseurs' : ' · en approche de l\'Arche');
    else if (d.dmg) stats += ' · dmg ' + d.dmg + ' · portée ' + d.range + (d.speed ? ' · vit ' + d.speed : '');
    else if (u.kind === 'miner') stats += ' · cargo ' + CARGO + ' · vit ' + SHIPS.miner.speed + (u.task === 'mine' ? ' · forage…' : u.task === 'return' ? ' · livraison' : '');
    else if (u.kind === 'h_recolteur') stats += ' · cargaison ' + Math.floor(u.load || 0) + '/' + RECOLT_CAP + (u.res === 'e' ? '⚡' : '◆') + ((u.load || 0) >= RECOLT_CAP || u.flush ? ' · livraison' : '');
    // v15.3 : ordres enchaînés en attente
    if (u.oq && u.oq.length) stats += ' · <b style="color:#5ce8c9">' + u.oq.length + ' ordre' + (u.oq.length > 1 ? 's' : '') + ' en file</b>';
    // v12 : état du lien au core
    if (u.orphan) stats += ' · <b style="color:#ffb454">ORPHELIN −50 %</b>';
    else if (u.core && !u.core.dead) stats += ' · lié : ' + entName(u.core);
    let extra = '';
    // v15.2 : toute station du joueur peut se relocaliser (la Spatiale a son panneau)
    if (u.side === 'player' && MOBILE_KINDS.includes(u.kind) && u.kind !== 'spatiale' && !stationBusy(u)) {
      extra = '<button class="pbtn" data-act="move">Déplacer (K)</button>';
    }
    return '<span class="sname' + (enemy ? ' enemy' : '') + '">' + entName(u).toUpperCase() + '</span>' +
      hpbarHTML(u.hp / u.maxHp, enemy ? 'red' : '') +
      '<span class="ms-info">' + stats + '</span>' + extra;
  }

  // groupe : une ligne par type
  const groups = {};
  for (const u of others) {
    (groups[u.kind] = groups[u.kind] || []).push(u);
  }
  let rows = '';
  if (sel.includes(mother)) {
    rows += '<div class="sel-row"><b>1×</b><span class="nm">L\'Arche</span>' +
      hpbarHTML(mother.hp / mother.maxHp) +
      '<span class="st">vit ' + Math.round(motherSpeed()) + '</span></div>';
  }
  for (const [kind, us] of Object.entries(groups)) {
    const d = SHIPS[kind] || STRUCTS[kind];
    if (!d) continue; // type inconnu : on ignore plutôt que planter
    const hp = us.reduce((a, u) => a + u.hp, 0) / Math.max(1, us.reduce((a, u) => a + u.maxHp, 0));
    const st = d.dmg ? d.dmg + ' dmg · ' + d.range + ' prt' + (d.speed ? ' · ' + d.speed + ' vit' : '')
      : kind === 'miner' ? 'cargo ' + CARGO + ' · ' + d.speed + ' vit'
      : d.speed ? 'vit ' + d.speed : 'structure';
    const nOrph = us.reduce((a, u) => a + (u.orphan ? 1 : 0), 0);
    rows += '<div class="sel-row"><b>' + us.length + '×</b><span class="nm">' + d.nom + '</span>' +
      hpbarHTML(hp) + '<span class="st">' + st +
      (nOrph ? ' · <b style="color:#ffb454">' + nOrph + ' orphelin' + (nOrph > 1 ? 's' : '') + '</b>' : '') + '</span></div>';
  }
  return '<div class="sel-rows">' + rows + '</div>';
}

/* ============================================================
   ENTRÉES
   ============================================================ */
function entName(e) {
  if (e.kind === 'aimother') return 'CORE CENTRAL';
  if (e.kind === 'mother') return 'L\'ARCHE';
  return STRUCTS[e.kind] ? STRUCTS[e.kind].nom : SHIPS[e.kind].nom;
}
function asteroidAt(wx, wy) {
  const tol = 10 / cam.z;
  return asteroids.find(a => dist(wx, wy, a.x, a.y) < a.r + tol) || null;
}

addEventListener('mousemove', e => {
  if (locked) {
    // v15.4 : sous capture, `clientX/Y` est figé — on cumule les déplacements
    // et on borne le curseur à l'écran (c'est là tout l'intérêt : il ne sort plus)
    mouse.x = clamp(mouse.x + e.movementX, 0, vw);
    mouse.y = clamp(mouse.y + e.movementY, 0, vh);
    syncCursor();
    const now = performance.now();
    if (now - hoverScan > 60) { hoverScan = now; setHover(uiAt(mouse.x, mouse.y)); }
  } else {
    mouse.x = e.clientX; mouse.y = e.clientY;
  }
  const w = s2w(mouse.x, mouse.y);
  mouse.wx = w.x; mouse.wy = w.y;
});
cv.addEventListener('mousedown', e => {
  if (state !== 'playing') return;
  requestLock(); // capture perdue (refus initial, sortie d'onglet) : un clic la reprend
  // v15.9 — clic secondaire : bouton droit, tap à deux doigts du trackpad (qui
  // arrive ici en bouton 2) et Ctrl+clic, la convention macOS. On commande depuis
  // `mousedown` plutôt que d'attendre `contextmenu`, qui manque à l'appel sur
  // certains périphériques et sous capture du curseur.
  if (e.button === 2 || (e.button === 0 && e.ctrlKey && !e.metaKey && !e.altKey)) {
    e.preventDefault();
    ordreClicDroit(e);
    return;
  }
  if (e.button === 0) {
    // v15.15 : un emplacement de bâtiment attend son clic
    if (hivePlacing) { confirmerHivePlacing(mouse.wx, mouse.wy, e.shiftKey); return; }
    if (moveOrder) {
      if (moveOrder.dead) { moveOrder = null; return; }
      emettre({ t: 'relocaliser', id: idDe(moveOrder), x: mouse.wx, y: mouse.wy });
      moveOrder = null; // destination transmise : le fantôme se referme
      return;
    }
    if (placing) { tryPlaceStation(); return; }
    // v14.4 — mode attaque : ce clic est l'ordre, pas une sélection
    if (aMode) {
      // v15.3 : Maj maintenue → l'attaque s'enchaîne et le mode reste armé
      const q = e.shiftKey;
      aMode = q;
      const give = collecteOrdres(q);
      const cu = sel.filter(u => u.side === 'player' && !u.dead && COMBAT_KINDS.includes(u.kind));
      const hasMother = mother && !mother.dead && sel.includes(mother);
      const ent = entityAt(mouse.wx, mouse.wy);
      if (ent && ent.side !== 'player') {
        for (const u of cu) give(u, { a: 'attack', target: ent });
        if (hasMother) give(mother, { a: 'attack', target: ent }); // l'Arche verrouille son canon
        log('Cible : ' + entName(ent) + (q ? ' (enchaînée).' : '.'), '');
      } else {
        cu.forEach((u, i) => {
          const ox = (i % 4 - 1.5) * 26, oy = (Math.floor(i / 4) - (cu.length > 4 ? 1 : 0)) * 26;
          give(u, { a: 'amove', x: clamp(mouse.wx + ox, 20, WORLD.w - 20), y: clamp(mouse.wy + oy, 20, WORLD.h - 20) });
        });
        if (hasMother) give(mother, { a: 'move', x: mouse.wx, y: mouse.wy });
        log('Attaque-déplacement (' + (cu.length + (hasMother ? 1 : 0)) + ')' + (q ? ' enchaînée.' : '.'), '');
      }
      give.emettre();
      sfx('click');
      return;
    }
    dragStart = { x: mouse.x, y: mouse.y };
  }
});
addEventListener('mouseup', e => {
  if (e.button !== 0 || !dragStart) return;
  if (state !== 'playing') { dragStart = null; return; }
  const moved = dist(dragStart.x, dragStart.y, mouse.x, mouse.y) > 6;
  if (moved) {
    // boîte de sélection : unités du joueur
    const x1 = Math.min(dragStart.x, mouse.x), x2 = Math.max(dragStart.x, mouse.x);
    const y1 = Math.min(dragStart.y, mouse.y), y2 = Math.max(dragStart.y, mouse.y);
    const picked = [];
    const test = (u) => {
      const p = w2s(u.x, u.y);
      if (p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2) picked.push(u);
    };
    for (const s of ships) if (s.side === 'player' && !s.docked && !['capsule', 'probe', 'cminer'].includes(s.kind)) test(s);
    if (mother && !mother.dead) test(mother);
    if (keys['shift']) { for (const p of picked) if (!sel.includes(p)) sel.push(p); }
    else sel = picked;
    if (sel.length) sfx('click');
  } else {
    const ent = entityAt(mouse.wx, mouse.wy);
    if (ent) {
      const nowT = performance.now();
      if (nowT - lastClick.t < 350 && lastClick.kind === ent.kind
          && ent.side === 'player' && ent.kind !== 'mother' && ent.kind !== 'capsule') {
        // double-clic : toutes les unités du même type visibles à l'écran
        sel = ships.filter(s => {
          if (s.side !== 'player' || s.kind !== ent.kind) return false;
          const p = w2s(s.x, s.y);
          return p.x >= -20 && p.x <= vw + 20 && p.y >= -20 && p.y <= vh + 20;
        });
      } else if (keys['shift'] && ent.side === 'player') {
        if (!sel.includes(ent)) sel.push(ent); else sel = sel.filter(u => u !== ent);
      } else {
        sel = [ent]; // une unité ennemie peut être inspectée (stats), pas commandée
      }
      lastClick = { t: nowT, kind: ent.kind };
      sfx('click');
    } else {
      sel = [];
      lastClick = { t: 0, kind: null };
    }
  }
  dragStart = null;
});
/* v15.9 — l'ordre du clic droit est une FONCTION, plus un handler d'événement.
   Raison : `contextmenu` n'est pas un canal fiable pour un RTS. Sur trackpad
   macOS le tap à deux doigts (clic secondaire) ne le déclenche pas toujours, et
   sous capture du curseur le navigateur peut le supprimer purement et simplement
   — il n'y a plus de position de curseur système à laquelle accrocher un menu.
   On commande donc sur `mousedown` (bouton 2, ou Ctrl+clic à la mode macOS), et
   `contextmenu` ne sert plus qu'à étouffer le menu natif… et de filet de secours
   pour les périphériques qui n'émettent QUE lui. */
let dernierOrdreDroit = 0;
/* ============================================================
   BUS DE COMMANDES (v16.1 — coop en réseau)
   ============================================================
   Règle : l'interface ne mute plus le monde directement. Chaque geste produit
   une COMMANDE sérialisable, appliquée par `appliquerCmd` — tout de suite en
   solo, au tick fixé par le relais en réseau, et sur les DEUX clients.

   Ce qui reste local : l'INTERPRÉTATION du geste — qui est sélectionné, ce qu'il
   y a sous le curseur, la dispersion des destinations, le fantôme de placement.
   Seul son résultat circule. C'est ce qui laisse à chaque joueur sa sélection,
   sa caméra et son mode attaque sans rien synchroniser de tout ça.

   Les entités voyagent par `id`, jamais par référence : `parId` rend `null` pour
   un mort, et une commande qui vise un mort est simplement ignorée — les deux
   clients l'ignorent au même tick, donc ça ne casse pas la synchronisation.

   AJOUTER UN GESTE : lui donner un type ici ET son cas dans `appliquerCmd`. Un
   geste qui muterait le monde sans passer par le bus ne se produirait que chez
   son auteur : la partie divergerait en silence. */

function idDe(e) { return e ? e.id | 0 : 0; }
function parId(id) {
  if (!id) return null;
  if (mother && mother.id === id && !mother.dead) return mother;
  if (aimother && aimother.id === id && !aimother.dead) return aimother;
  for (const s of ships) if (s.id === id) return s;
  for (const s of structs) if (s.id === id) return s;
  for (const a of asteroids) if (a.id === id) return a;
  return null;
}
const parIds = (ids) => ids.map(parId).filter(u => u && !u.dead);
// Une action d'unité porte des références (cible, astéroïde) : seuls leurs id
// traversent le bus, rétablis à l'application.
function actSortante(act) {
  const o = Object.assign({}, act);
  if (o.target) { o.tgt = idDe(o.target); delete o.target; }
  if (o.ast) o.ast = idDe(o.ast);
  return o;
}
function actEntrante(o) {
  const act = Object.assign({}, o);
  if (act.tgt) { act.target = parId(act.tgt); delete act.tgt; if (!act.target) return null; }
  if (act.ast) { act.ast = parId(act.ast); if (!act.ast) return null; }
  return act;
}

let reseau = null; // { envoyer(cmd) } tant qu'une partie en réseau est en cours
function emettre(cmd) {
  if (reseau) reseau.envoyer(cmd); // le relais la rendra à tout le monde, nous compris
  else appliquerCmd(cmd);
}
/** Collecteur d'ordres : l'interface empile (unité, action), puis émet d'un bloc. */
function collecteOrdres(file) {
  const liste = [];
  const give = (u, act) => { if (u && !u.dead) liste.push({ id: idDe(u), act: actSortante(act) }); };
  give.emettre = () => { if (liste.length) emettre({ t: 'ordres', file: !!file, liste }); };
  return give;
}

function appliquerCmd(c) {
  switch (c.t) {
    case 'ordres':
      for (const o of c.liste) {
        const u = parId(o.id), act = actEntrante(o.act);
        if (!u || u.dead || !act) continue;
        if (c.file) pushAction(u, act);
        else { clearQueue(u); applyAction(u, act); }
      }
      break;
    case 'tenir': // H : les unités de combat tiennent leur position
      for (const u of parIds(c.ids)) {
        clearQueue(u);
        if (u === mother) mother.dest = null;
        else { u.order = { type: 'hold' }; u.tgt = null; }
      }
      break;
    case 'halte': // S : halte et purge des files (le chantier en route est remboursé)
      for (const u of parIds(c.ids)) {
        clearQueue(u);
        annulerBatir(u, null);
        if (u === mother) { mother.dest = null; focusTgt = null; }
        else if (COMBAT_KINDS.includes(u.kind)) { u.order = { type: 'guard', x: u.x, y: u.y }; u.tgt = null; }
        else if (u.kind === 'miner' || u.kind === 'h_recolteur' || u.kind === 'cargo') { u.task = 'stop'; u.anchor = null; u.ast = null; }
      }
      break;
    case 'orbite': // O : les drones regagnent l'orbite de l'Arche
      for (const u of parIds(c.ids)) { u.order = { type: 'orbit' }; u.tgt = null; clearQueue(u); }
      break;
    case 'module': buyModule(c.key); break;
    case 'sat': poserSat(c.key, c.x, c.y); break;
    case 'relocaliser': { const st = parId(c.id); if (st) orderRelocate(st, c.x, c.y); break; }
    case 'rally': {
      const st = parId(c.id);
      if (st) { if (c.off) clearRally(st); else setRally(st, c.x, c.y, parId(c.ast)); }
      break;
    }
    case 'produire': { const st = parId(c.id); if (st) queueStationBatch(st, c.kind, c.n); break; }
    case 'stAction': {
      const st = parId(c.id);
      if (!st) break;
      if (c.quoi === 'upgrade') upgradeSpatiale(st);
      else if (c.quoi === 'yard') upgradeYard(st);
      else if (c.quoi === 'rebuild') startRebuild(st);
      break;
    }
    case 'hive': hiveLocal(c.key, c.max, c.ids); break;
    case 'batir': batirLocal(c.id, c.key, c.x, c.y); break;
    default: break;
  }
}

function ordreClicDroit(e) {
  dernierOrdreDroit = performance.now();
  if (state !== 'playing' || !playerAnchor()) return;
  aMode = false; // le clic droit annule le mode attaque
  if (hivePlacing) { setHivePlacing(null); log('Placement annulé.', ''); return; }
  if (moveOrder) { moveOrder = null; log('Relocalisation annulée.', ''); return; }
  if (placing) { setPlacing(null); return; }
  const playerSel = sel.filter(u => u.side === 'player' && !u.dead);
  if (!playerSel.length) return;
  const drones = playerSel.filter(u => COMBAT_KINDS.includes(u.kind));
  const mins = playerSel.filter(u => u.kind === 'miner' || u.kind === 'h_recolteur');
  const cargos = playerSel.filter(u => u.kind === 'cargo');
  const hasMother = mother && !mother.dead && playerSel.includes(mother);
  const ent = entityAt(mouse.wx, mouse.wy);
  const ast = asteroidAt(mouse.wx, mouse.wy);
  // v15.3 — Maj : la commande s'AJOUTE à la file de l'unité au lieu de la
  // remplacer. Sans Maj, elle purge la file : un ordre nu reste un ordre nu.
  const q = e.shiftKey;
  const give = collecteOrdres(q); // les ordres sont empilés puis émis d'un bloc

  // v15.2 — Station Spatiale sélectionnée : le clic droit règle son point de
  // ralliement (clic sur la station elle-même = annulation). Sa relocalisation
  // passe donc par K / « Déplacer », comme n'importe quel producteur d'un RTS.
  for (const st of playerSel) {
    if (st.kind !== 'spatiale') continue;
    if (ent === st) emettre({ t: 'rally', id: idDe(st), off: true });
    else emettre({ t: 'rally', id: idDe(st), x: ast ? ast.x : mouse.wx, y: ast ? ast.y : mouse.wy, ast: idDe(ast) }); // l'astéroïde : le ralliement le suivra
  }

  if (ent && ent.side !== 'player') {
    // attaque (Core central ou Collectif)
    for (const u of drones) give(u, { a: 'attack', target: ent });
    if (hasMother) give(mother, { a: 'attack', target: ent });
    log('Cible : ' + entName(ent) + (q ? ' (enchaînée).' : '.'), '');
  } else if (ent && (ent === mother || ent.kind === 'spatiale') && (drones.length || cargos.length) && !hasMother) {
    // (le garde `ent &&` est vital : en mode Collective, mother est null et
    // un clic droit dans le vide donnait ent === mother → null === null)
    // rappel : drones de l'Arche en orbite, le reste converge vers la base
    for (const u of drones) give(u, { a: 'recall', x: ent.x + rand(-60, 60), y: ent.y + rand(-60, 60) });
    for (const u of cargos) give(u, { a: 'recall' });
    log('Unités rappelées.', '');
  } else if (ast && ast.stock > 0 && (mins.length || cargos.length)) {
    // assignation minière
    for (const u of mins) give(u, { a: 'mine', ast });
    for (const u of cargos) give(u, { a: 'mine', ast, x: ast.x, y: ast.y });
    for (const u of drones) give(u, { a: 'move', x: ast.x, y: ast.y });
    if (hasMother) give(mother, { a: 'move', x: mouse.wx, y: mouse.wy });
    log('Site minier assigné' + (q ? ' (enchaîné).' : '.'), '');
  } else {
    // déplacement PUR (v14.5) : l'ordre prime — le ciblage automatique est purgé
    // et aucune cible n'est acquise en route (l'attaque-déplacement, c'est A)
    drones.forEach((u, i) => {
      const ox = (i % 4 - 1.5) * 26, oy = (Math.floor(i / 4) - (drones.length > 4 ? 1 : 0)) * 26;
      give(u, { a: 'move', x: clamp(mouse.wx + ox, 20, WORLD.w - 20), y: clamp(mouse.wy + oy, 20, WORLD.h - 20) });
    });
    mins.forEach((u, i) => {
      give(u, { a: 'move', x: clamp(mouse.wx + (i % 3 - 1) * 24, 20, WORLD.w - 20), y: clamp(mouse.wy + Math.floor(i / 3) * 24, 20, WORLD.h - 20) });
    });
    cargos.forEach((u, i) => {
      give(u, { a: 'move', x: clamp(mouse.wx + i * 40, 20, WORLD.w - 20), y: clamp(mouse.wy, 20, WORLD.h - 20) });
    });
    // clic droit au sol avec une station mobile sélectionnée : relocalisation
    // directe — sauf la Station Spatiale, dont le clic droit sert au ralliement
    const movSt = playerSel.find(u => MOBILE_KINDS.includes(u.kind) && u.kind !== 'spatiale');
    if (movSt && !stationBusy(movSt)) emettre({ t: 'relocaliser', id: idDe(movSt), x: mouse.wx, y: mouse.wy });
    if (hasMother) give(mother, { a: 'move', x: mouse.wx, y: mouse.wy });
    if (q) log('Ordre enchaîné.', '');
  }
  give.emettre();
  sfx('click');
}
// le menu natif ne doit jamais s'ouvrir sur le canvas ; et si l'appareil n'a
// émis QUE `contextmenu` (aucun mousedown bouton 2), on commande depuis ici.
cv.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (performance.now() - dernierOrdreDroit > 400) ordreClicDroit(e);
});
cv.addEventListener('wheel', e => {
  e.preventDefault();
  const before = s2w(mouse.x, mouse.y);
  cam.z = clamp(cam.z * Math.pow(1.0014, -e.deltaY), 0.22, 2.2);
  const after = s2w(mouse.x, mouse.y);
  cam.x += before.x - after.x;
  cam.y += before.y - after.y;
}, { passive: false });

mmCv.addEventListener('mousedown', e => {
  const r = mmCv.getBoundingClientRect();
  cam.x = (e.clientX - r.left) / mmCv.width * WORLD.w;
  cam.y = (e.clientY - r.top) / mmCv.height * WORLD.h;
  follow = false;
});

addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  keys[k] = true;
  if (k === ' ') e.preventDefault();
  if (state !== 'playing') return;
  // groupes de contrôle : Ctrl/Alt+chiffre assigne, chiffre rappelle (×2 : centre la caméra)
  if (/^Digit[1-9]$/.test(e.code)) {
    const g = e.code[5];
    if (e.ctrlKey || e.altKey || e.metaKey) {
      e.preventDefault();
      const units = sel.filter(u => u.side === 'player' && !u.dead && u.kind !== 'capsule');
      if (units.length) { groups[g] = [...units]; log('Groupe ' + g + ' assigné (' + units.length + ' unités).', ''); sfx('click'); }
    } else {
      const units = (groups[g] || []).filter(u => !u.dead);
      groups[g] = units;
      if (units.length) {
        sel = [...units];
        const nowT = performance.now();
        if (lastGroup.key === g && nowT - lastGroup.t < 450) {
          cam.x = units.reduce((a, u) => a + u.x, 0) / units.length;
          cam.y = units.reduce((a, u) => a + u.y, 0) / units.length;
        }
        lastGroup = { t: nowT, key: g };
        sfx('click');
      }
    }
    return;
  }
  // modules au clavier (l'Arche sélectionnée) : B/G/C/T/U/V
  const MOD_HOTKEYS = { b: 'hangar', g: 'forage', c: 'collecteur', t: 'canon', u: 'bouclier', v: 'propulsion' };
  if (MOD_HOTKEYS[k] && !e.ctrlKey && !e.metaKey && !e.altKey && mother && !mother.dead && sel.includes(mother)) {
    emettre({ t: 'module', key: MOD_HOTKEYS[k] });
    return;
  }
  // chantier naval au clavier (la Station sélectionnée, sans l'Arche) : C/V/L/G + U/J/R
  const stKey = (!mother || mother.dead || !sel.includes(mother)) ? sel.find(u => u.kind === 'spatiale' && u.side === 'player' && !u.dead) : null;
  if (stKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const PROD_HOTKEYS = { c: 'cargo', v: 'corvette', d: 'drone', l: 'lanceur', b: 'raider', e: 'dread', g: 'vhangar' };
    if (PROD_HOTKEYS[k]) { emettre({ t: 'produire', id: idDe(stKey), kind: PROD_HOTKEYS[k], n: e.shiftKey ? SERIE_MAJ : 1 }); return; }
    if (k === 'u') { emettre({ t: 'stAction', id: idDe(stKey), quoi: 'upgrade' }); return; }
    if (k === 'j') { emettre({ t: 'stAction', id: idDe(stKey), quoi: 'yard' }); return; }
    if (k === 'r') { emettre({ t: 'stAction', id: idDe(stKey), quoi: 'rebuild' }); return; }
  }
  // K : déplacer la station mobile sélectionnée (Spatiale, Sentinelle ou Collectrice)
  if (k === 'k' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const mv = sel.find(u => MOBILE_KINDS.includes(u.kind) && !u.dead);
    if (mv) { startMove(mv); return; }
  }
  // v14.3 — raccourcis du Collectif (entités du joueur sélectionnées) :
  // E/B/R/L/T/N/Y mutent, V divise. Sans conflit : les touches de l'Arche et de
  // la Station exigent leur sélection, impossible en même temps que des formes h_*.
  const HIVE_HOTKEYS = { e: 'h_essaim', b: 'h_bastion', r: 'h_recolteur', l: 'h_epine', t: 'h_traqueur',
    n: 'h_entrepot', y: 'h_synapse', g: 'h_couveuse', v: 'div',
    c: 'h_colosse', d: 'h_dard', u: 'h_nuee', i: 'h_matrice' }; // v15.8 : fusions
  if (HIVE_HOTKEYS[k] && !e.ctrlKey && !e.metaKey && !e.altKey
      && sel.some(u => u.side === 'player' && !u.dead && MUTATIONS[u.kind])) {
    applyHiveAction(HIVE_HOTKEYS[k], e.shiftKey ? SERIE_MAJ : 1);
    return;
  }
  switch (k) {
    case 'e': if (sel.includes(mother)) setPlacing('sentinelle'); break;
    case 'r': if (sel.includes(mother)) setPlacing('collectsat'); break;
    // v15.7 : les deux structures récupérées du Core central adverse
    case 'y': if (sel.includes(mother)) setPlacing('aiturret'); break;
    case 'd': if (sel.includes(mother)) setPlacing('gate'); break;
    case 'a': { // mode attaque : le prochain clic gauche ordonne l'attaque
      // v14.7 : l'Arche aussi — son canon se verrouille (cible) ou elle se déplace (sol)
      const cu = sel.filter(u => u.side === 'player' && !u.dead && COMBAT_KINDS.includes(u.kind));
      const hasMother = mother && !mother.dead && sel.includes(mother);
      if (cu.length || hasMother) {
        aMode = true;
        log('Attaque : cliquez la cible (Échap pour annuler).', '');
        sfx('click');
      }
      break;
    }
    case 'h': { // tenir la position (unités de combat et/ou l'Arche) ; sinon, sélectionner la base
      const cu = sel.filter(u => u.side === 'player' && !u.dead && COMBAT_KINDS.includes(u.kind));
      const hasMother = mother && !mother.dead && sel.includes(mother);
      if (cu.length || hasMother) {
        const ids = cu.map(idDe);
        if (hasMother) ids.push(idDe(mother)); // l'Arche cesse d'avancer et tient sa position
        emettre({ t: 'tenir', ids });
        log('Position tenue (' + (cu.length + (hasMother ? 1 : 0)) + ').', '');
        sfx('click');
        break;
      }
      const hb = homeBase();
      if (hb) {
        if (sel.length === 1 && sel[0] === hb) { cam.x = hb.x; cam.y = hb.y; }
        else sel = [hb];
        sfx('click');
      }
      break;
    }
    case 's': { // stop : halte et purge des ordres (file d'enchaînement comprise)
      const halte = sel.filter(u => u.side === 'player' && !u.dead
        && (u === mother || COMBAT_KINDS.includes(u.kind) || u.kind === 'miner' || u.kind === 'h_recolteur' || u.kind === 'cargo'));
      if (halte.length) {
        emettre({ t: 'halte', ids: halte.map(idDe) }); // v15.15 : halte = chantier abandonné, mise rendue
        aMode = false; log('Halte.', ''); sfx('click');
      }
      break;
    }
    case 'n': if (mother && !mother.dead && sel.includes(mother)) setPlacing('spatiale'); break;
    case 'x': { // toute la flotte de combat
      const all = ships.filter(s => s.side === 'player' && COMBAT_KINDS.includes(s.kind) && !s.dead);
      if (all.length) { sel = all; sfx('click'); }
      break;
    }
    case 'o': { // rappel en orbite des drones sélectionnés
      const ds = sel.filter(u => u.kind === 'cdrone' && !u.dead);
      if (ds.length) { emettre({ t: 'orbite', ids: ds.map(idDe) }); log('Drones rappelés en orbite.', ''); sfx('click'); }
      break;
    }
    case 'f':
      follow = !follow;
      log(follow ? 'Caméra verrouillée sur l\'Arche.' : 'Caméra libre.', '');
      break;
    case 'escape': setPlacing(null); setHivePlacing(null); moveOrder = null; focusTgt = null; aMode = false; sel = []; break;
    case ' ': { const hb2 = homeBase(); if (hb2) { cam.x = hb2.x; cam.y = hb2.y; } break; }
    case 'p': paused ? closePause() : openPause(); break;
    case 'm': sndOn = !sndOn; syncSoundBtn(); log(sndOn ? 'Son activé.' : 'Son coupé.', ''); break;
  }
});
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

document.querySelectorAll('.mrow[data-mod]').forEach(row => {
  row.addEventListener('click', () => { if (state === 'playing') emettre({ t: 'module', key: row.dataset.mod }); });
});
// panneau de la station : production et actions
const selSpatiale = () => sel.find(u => u.kind === 'spatiale' && u.side === 'player' && !u.dead);
document.querySelectorAll('#station-panel [data-prod]').forEach(row => {
  row.addEventListener('click', (e) => {
    const st = selSpatiale();
    if (state !== 'playing' || !st) return;
    emettre({ t: 'produire', id: idDe(st), kind: row.dataset.prod, n: e.shiftKey ? SERIE_MAJ : 1 });
  });
});
document.querySelectorAll('#station-panel [data-stact]').forEach(row => {
  row.addEventListener('click', () => {
    const st = selSpatiale();
    if (state !== 'playing' || !st) return;
    const act = row.dataset.stact;
    if (act === 'move') startMove(st); // simple armement local : la destination viendra au clic
    else emettre({ t: 'stAction', id: idDe(st), quoi: act });
  });
});
// bouton « Déplacer » des fiches du bandeau (Sentinelle) — délégué : la fiche est regénérée
document.addEventListener('click', e => {
  const b = e.target.closest('#mother-status [data-act="move"]');
  if (!b || state !== 'playing') return;
  const st = sel.find(u => MOBILE_KINDS.includes(u.kind) && !u.dead);
  if (st) startMove(st);
});
// v14.3 : une action du Collectif (mutation ou division), appliquée à toute
// la sélection éligible — partagée entre le panneau et les raccourcis clavier
// v15.11 — UN CLIC = UNE ENTITÉ. Même avec vingt formes sélectionnées, une
// action n'en transforme qu'une : on garde le contrôle de la composition au lieu
// de convertir tout son essaim d'un geste. v15.12 : Maj en lance cinq — la même
// série que Maj sur une ligne du chantier naval.
function applyHiveAction(key, combien) { // geste local : quelles cellules, et le fantôme
  const max = Math.max(1, combien || 1);
  const units = sel.filter(u => u.side === 'player' && !u.dead && !u.mut && !u.fus && MUTATIONS[u.kind]);
  if (!units.length) return false;
  if (!FUSIONS[key] && units.some(u => besoinPlacement(u, key))) {
    // v15.15 : une métamorphose en bâtiment se PLACE — fantôme au curseur, rien
    // n'est encore commandé ; c'est le clic de pose qui émettra `batir`.
    setHivePlacing(key);
    return true;
  }
  emettre({ t: 'hive', key, max, ids: units.map(idDe) });
  return true;
}
/** Effet (les deux clients) : mutations, divisions et fusions sur les id reçus. */
function hiveLocal(key, max, ids) {
  const units = parIds(ids).filter(u => !u.mut && !u.fus && MUTATIONS[u.kind]);
  if (!units.length) return false;
  let n = 0;
  if (FUSIONS[key]) {
    // une fusion consomme DEUX corps — on apparie ce qui est sélectionné
    const paires = pairesFusion(units, key);
    for (const [a, b] of paires) {
      if (startFusion(a, b, key)) n++;
      if (n >= max) break;
    }
    if (!n && !paires.length) {
      log('Fusion : il faut ' + FUSIONS[key].de.map(k => SHIPS[k].nom).join(' + ')
        + ' à moins de ' + FUSION_RANGE + ' l\'un de l\'autre.', 'warn');
    }
  } else {
    for (const u of units) {
      if (key === 'div') { if (startDivision(u)) n++; }
      else if (u.kind !== key && MUTATIONS[u.kind].vers.includes(key) && startMutation(u, key)) n++;
      if (n >= max) break;
    }
  }
  if (n) sfx('click'); else sfx('nope');
  return true;
}
document.querySelectorAll('#hive-panel .mrow[data-hmut], #hive-panel .mrow[data-hfus]').forEach(row => {
  row.addEventListener('click', (e) => {
    if (state !== 'playing') return;
    applyHiveAction(row.dataset.hmut || row.dataset.hfus, e.shiftKey ? SERIE_MAJ : 1);
  });
});
document.querySelectorAll('.bbtn[data-sat]').forEach(b => {
  b.addEventListener('click', () => { if (state === 'playing') setPlacing(b.dataset.sat); });
});

/* ===== v15.4 : capture du curseur (pointer lock) =====
   Le pointeur est verrouillé sur le canvas pendant la partie : il ne peut plus
   sortir de l'écran (défilement par les bords fiable, second moniteur sans
   piège) et la pause le relâche. Conséquence de l'API : tous les événements
   souris sont adressés au canvas, donc le HUD DOM ne reçoit plus rien — on
   entretient un curseur de synthèse (`mouse.x/y` cumulé depuis `movementX/Y`)
   et on RELAIE nous-mêmes les événements aux éléments d'interface survolés. */
let locked = false;
let uiDown = null;        // élément interactif pressé (à qui relayer le relâchement)
let uiBlock = false;      // le HUD a absorbé la pression : pas d'ordre dans le monde
let hoverEl = null, hoverT = 0, hoverScan = 0;
const wantLock = () => state === 'playing' && !paused;
function requestLock() {
  if (!wantLock() || document.pointerLockElement === cv || !cv.requestPointerLock) return;
  // le navigateur refuse un re-verrouillage immédiat après Échap : on ignore
  const p = cv.requestPointerLock();
  if (p && p.catch) p.catch(() => {});
}
function releaseLock() {
  if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
}
// surface d'interface sous le curseur de synthèse (null = le monde). Tout ce qui
// n'est pas le canvas absorbe le clic, exactement comme le pointeur libre : les
// panneaux du dock sont opaques aux ordres, même sur leur fond.
function uiHitAt(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el || el === cv || el === document.body || el === document.documentElement) return null;
  return el;
}
// élément interactif à qui relayer l'événement (null = surface inerte)
function uiAt(x, y) {
  const el = uiHitAt(x, y);
  return el ? el.closest('#hud button, #hud .mrow, #minimap') : null;
}
// rejoue un événement souris sur l'élément visé, modificateurs compris (Maj = ×5).
// Il est MARQUÉ : nos écouteurs de capture sont sur `window`, donc l'événement
// relayé leur repasse sous le nez — sans ce drapeau, chaque relais se réintercepte
// lui-même et la pile explose (le clic n'atteint jamais le bouton).
function relayMouse(el, type, e) {
  const ev = new MouseEvent(type, {
    bubbles: true, cancelable: true, view: window, button: e.button, buttons: e.buttons,
    clientX: mouse.x, clientY: mouse.y,
    shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey,
  });
  ev.relaisSynthetique = true;
  el.dispatchEvent(ev);
}
function setHover(el) {
  if (el === hoverEl) return;
  if (hoverEl) hoverEl.classList.remove('vhover');
  hoverEl = el;
  if (hoverEl) hoverEl.classList.add('vhover');
  hoverT = performance.now();
  const tip = document.getElementById('tip');
  if (tip) tip.classList.add('hidden');
}
// infobulle de synthèse : les `title` natifs ne s'affichent plus sous capture
function syncTip(now) {
  const tip = document.getElementById('tip');
  if (!tip) return;
  const txt = locked && hoverEl ? hoverEl.getAttribute('title') : null;
  if (!txt || now - hoverT < 350) { tip.classList.add('hidden'); return; }
  if (tip._last !== txt) { tip._last = txt; tip.textContent = txt; }
  tip.classList.remove('hidden');
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.transform = 'translate(' + Math.round(clamp(mouse.x + 18, 4, vw - w - 4)) + 'px,'
    + Math.round(clamp(mouse.y + 18, 4, vh - h - 4)) + 'px)';
}
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === cv;
  document.body.classList.toggle('capture', locked);
  const cur = document.getElementById('cursor');
  if (cur) cur.classList.toggle('hidden', !locked);
  if (locked) {
    if (!mouse.x && !mouse.y) { mouse.x = vw / 2; mouse.y = vh / 2; }
    mouse.x = clamp(mouse.x, 0, vw); mouse.y = clamp(mouse.y, 0, vh);
    syncCursor();
  } else {
    setHover(null);
    uiDown = null; uiBlock = false;
    // Échap relâche la capture : on bascule en pause, comme pour le plein écran
    if (state === 'playing' && !paused) openPause();
  }
});
document.addEventListener('pointerlockerror', () => {
  log('Capture du curseur refusée par le navigateur.', 'warn');
});
function syncCursor() {
  const cur = document.getElementById('cursor');
  if (cur) cur.style.transform = 'translate(' + mouse.x + 'px,' + mouse.y + 'px)';
}
// interception : sous capture, un clic sur le HUD ne doit pas devenir un ordre
addEventListener('mousedown', e => {
  if (!locked || e.relaisSynthetique) return;
  uiDown = null; uiBlock = false;
  if (!uiHitAt(mouse.x, mouse.y)) return; // le monde : le canvas reçoit son clic
  uiBlock = true;
  e.stopPropagation(); e.preventDefault();
  uiDown = uiAt(mouse.x, mouse.y);
  if (uiDown) relayMouse(uiDown, 'mousedown', e);
}, true);
addEventListener('mouseup', e => {
  if (e.relaisSynthetique) return;
  if (!locked || !uiBlock) return; // pressé dans le monde : la boîte de sélection prime
  e.stopPropagation(); e.preventDefault();
  if (uiDown) {
    relayMouse(uiDown, 'mouseup', e);
    if (uiAt(mouse.x, mouse.y) === uiDown) relayMouse(uiDown, 'click', e);
  }
  uiDown = null; uiBlock = false;
}, true);
addEventListener('contextmenu', e => {
  if (e.relaisSynthetique) return;
  // v15.9 : en partie, le menu natif ne s'ouvre nulle part — un tap à deux doigts
  // sur le dock ne doit pas faire surgir le menu du navigateur en plein écran
  if (state === 'playing') e.preventDefault();
  if (locked && uiHitAt(mouse.x, mouse.y)) e.stopPropagation();
}, true);
addEventListener('wheel', e => {
  if (locked && uiHitAt(mouse.x, mouse.y)) { e.stopPropagation(); e.preventDefault(); }
}, { capture: true, passive: false });

/* ===== plein écran & menu de pause ===== */
function enterFullscreen() {
  const root = document.documentElement;
  if (!document.fullscreenElement && root.requestFullscreen) {
    root.requestFullscreen().catch(() => {});
  }
}
function openPause() {
  if (state !== 'playing' || paused) return;
  paused = true;
  const pv = document.getElementById('pause-version');
  if (pv) pv.textContent = 'ÉVEIL MACHINE — ' + GAME_VERSION + ' · ' + (faction === 'collective' ? 'LE COLLECTIF' : 'LE CORE CENTRAL');
  document.getElementById('screen-pause').classList.remove('hidden');
  // la pause libère le plein écran ET le curseur
  releaseLock();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
function closePause() {
  if (!paused) return;
  paused = false;
  document.getElementById('screen-pause').classList.add('hidden');
  enterFullscreen();
  requestLock(); // le clic « Reprendre » sert de geste utilisateur
}
function syncSoundBtn() {
  document.getElementById('btn-sound').textContent = 'SON : ' + (sndOn ? 'ACTIVÉ' : 'COUPÉ');
}
// si le joueur quitte le plein écran (Échap), on bascule en pause
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && state === 'playing' && !paused) openPause();
  // v15.4 : le navigateur refuse la capture pendant la bascule plein écran —
  // on la reprend une fois la transition terminée
  else if (document.fullscreenElement && wantLock() && !locked) requestLock();
});
document.getElementById('btn-resume').addEventListener('click', closePause);
document.getElementById('btn-restart-pause').addEventListener('click', () => location.reload());
document.getElementById('btn-sound').addEventListener('click', () => { sndOn = !sndOn; syncSoundBtn(); });

function startGame(f, g) {
  faction = f;
  foe = f === 'arche' ? 'collective' : 'arche'; // l'IA prend la faction adverse
  // La graine fixe tout le monde généré : ?graine=42 dans l'URL rejoue la même
  // carte, et en réseau les deux clients reçoivent la même du lobby.
  const urlG = Number(new URLSearchParams(location.search).get('graine'));
  semer(g || urlG || (Date.now() & 0x7fffffff));
  audioInit();
  initWorld();
  document.getElementById('screen-intro').classList.add('hidden');
  enterFullscreen();
  state = 'playing';
  mouse.x = innerWidth / 2; mouse.y = innerHeight / 2;
  requestLock(); // v15.4 : le clic de démarrage autorise la capture
}
document.getElementById('btn-start').addEventListener('click', () => startGame('arche'));
const bsh = document.getElementById('btn-start-hive');
if (bsh) bsh.addEventListener('click', () => startGame('collective'));
document.getElementById('btn-restart').addEventListener('click', () => location.reload());

/* ============================================================
   BOUCLE PRINCIPALE
   ============================================================ */
/* ============================================================
   SOMME DE CONTRÔLE (v16, lockstep)
   ============================================================
   Empreinte exacte (bit à bit, pas arrondie) de l'état de simulation. En réseau,
   les deux clients la comparent régulièrement : dès qu'elles diffèrent, les deux
   mondes ont divergé et la partie n'a plus de sens — il vaut mieux l'annoncer que
   laisser deux joueurs jouer deux parties différentes. Sert aussi de test de
   déterminisme hors réseau : même graine + mêmes ordres ⇒ même somme.
   N'inclure QUE de l'état de simulation : ni caméra, ni sélection, ni particules,
   ni brouillard — ils diffèrent légitimement d'un client à l'autre. */
const vueSomme = new DataView(new ArrayBuffer(8));
function sommeControle() {
  let h = 2166136261 >>> 0;
  const mel = (v) => { h = Math.imul(h ^ (v | 0), 16777619) >>> 0; };
  const melF = (v) => { // le double exact, pour qu'un écart minuscule se voie tout de suite
    vueSomme.setFloat64(0, v);
    mel(vueSomme.getInt32(0)); mel(vueSomme.getInt32(4));
  };
  mel(tick); mel(idSeq); mel(etatAlea);
  melF(metal); melF(energy); melF(gameT);
  const ent = (e) => { mel(e.id | 0); melF(e.x); melF(e.y); melF(e.hp); };
  if (mother && !mother.dead) ent(mother);
  if (aimother && !aimother.dead) ent(aimother);
  for (const s of ships) if (!s.dead) ent(s);
  for (const s of structs) if (!s.dead) ent(s);
  for (const s of shots) ent(s);
  for (const a of asteroids) { melF(a.x); melF(a.y); melF(a.stock); }
  return h;
}

/* Pas de temps FIXE (v16) : la simulation avance par tranches de TICK_MS, jamais
   au rythme variable du rAF — deux machines n'ont pas la même cadence d'affichage
   et le moindre dt différent ferait diverger les deux mondes. Le rendu, lui,
   reste libre. `retard` borne le rattrapage : au-delà, on laisse filer plutôt
   que de bloquer la page (le réseau gère le décrochage par le verrou de tick). */
const TICK_MS = 1000 / 30;
const TICK = TICK_MS / 1000;
const RATTRAPAGE_MAX = 5; // ticks simulés au plus par image
let last = performance.now();
let accTick = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state === 'playing' && !paused) {
    handleKeys(dt); // caméra : hors simulation, elle peut suivre l'affichage
    accTick += dt;
    let n = 0;
    while (accTick >= TICK && n < RATTRAPAGE_MAX) {
      update(TICK);
      tick++;
      accTick -= TICK;
      n++;
    }
    if (accTick > TICK * RATTRAPAGE_MAX) accTick = 0; // décrochage : on renonce au retard
  }
  render(now);
  if (state === 'playing') updateHUD(dt);
  syncTip(now); // infobulle de synthèse du curseur capturé
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
