export type PlayerId = 0 | 1;
export type CardType = 'generateur' | 'vaisseau' | 'module' | 'tactique';
export type ShipClass =
  | 'chasseur'
  | 'intercepteur'
  | 'corvette'
  | 'croiseur'
  | 'capital'
  | 'soutien';
export type Rarity = 'commune' | 'rare' | 'epique' | 'legendaire';
export type Faction = 'neutre' | 'federation' | 'ceinture';

/** Référence à une cible sur le plateau. */
export interface TargetRef {
  kind: 'ship' | 'module' | 'station';
  player: PlayerId;
  uid?: number;
}

export interface ShipInstance {
  uid: number;
  defId: string;
  owner: PlayerId;
  damage: number;
  /** turnCounter au moment de l'arrivée (mal de saut). */
  enteredTurn: number;
  attacksUsed: number;
  stealthBroken: boolean;
  /** Brouillé tant que turnCounter < jammedUntil. */
  jammedUntil: number;
  /** En garde : intercepte la prochaine attaque ennemie non furtive. */
  guarding: boolean;
  /** Bonus d'attaque « jusqu'à la fin du tour ». */
  tempAtk: number;
  /** Ignore Escorte ce tour (Flotte fantôme). */
  tempFurtif: boolean;
  lastDamagedBy?: { player: PlayerId; uid: number };
}

export interface ModuleInstance {
  uid: number;
  defId: string;
  owner: PlayerId;
}

export interface PlayerState {
  stationHp: number;
  stationMaxHp: number;
  /** Bouclier : absorbe les dégâts avant la coque, +1 par tour jusqu'au max. */
  shield: number;
  shieldMax: number;
  deck: string[];
  hand: string[];
  discard: string[];
  generators: string[];
  fleet: ShipInstance[];
  modules: ModuleInstance[];
  energy: number;
  playedGenerator: boolean;
  /** Station protégée tant que turnCounter < stationImmuneUntil. */
  stationImmuneUntil: number;
  fatigue: number;
}

export interface PendingDecision {
  kind: 'scry1' | 'destroyModule';
  /** Joueur qui doit décider. */
  player: PlayerId;
  /** scry1 : carte au-dessus du deck. */
  cardId?: string;
  /** destroyModule : joueur dont un module sera détruit. */
  targetPlayer?: PlayerId;
}

export interface GameState {
  players: [PlayerState, PlayerState];
  active: PlayerId;
  /** Compteur global, +1 à chaque tour de joueur. Commence à 1. */
  turnCounter: number;
  shipsDestroyedThisTurn: number;
  nextUid: number;
  rng: { seed: number };
  pendingDecision?: PendingDecision;
  over: boolean;
  winner?: PlayerId;
  log: string[];
}

export interface EffectCtx {
  state: GameState;
  /** Contrôleur de la carte. */
  owner: PlayerId;
  selfUid?: number;
  targets?: TargetRef[];
  mode?: number;
  destroyer?: { player: PlayerId; uid: number };
  attackerUid?: number;
}

export interface TargetSpec {
  required: boolean;
  hint: string;
  validate: (state: GameState, owner: PlayerId, t: TargetRef) => boolean;
}

export interface CardDef {
  id: string;
  name: string;
  faction: Faction;
  type: CardType;
  rarity: Rarity;
  cost: number;
  text: string;
  // Vaisseau
  shipClass?: ShipClass;
  atk?: number;
  hp?: number;
  armor?: number;
  furtif?: boolean;
  frappeRapide?: boolean;
  escorte?: boolean;
  mustAttack?: boolean;
  token?: boolean;
  // Générateur
  energyOutput?: number;
  // Ciblage
  targetSpec?: TargetSpec;
  modes?: { hint: string; targetSpec?: TargetSpec }[];
  // Déclencheurs
  onEnter?: (ctx: EffectCtx) => void;
  onDestroyed?: (ctx: EffectCtx) => void;
  startOfTurn?: (ctx: EffectCtx) => void;
  onEnemyAttacksStation?: (ctx: EffectCtx) => void;
  onDealStationDamage?: (ctx: EffectCtx) => void;
  play?: (ctx: EffectCtx) => void;
  // Effets statiques
  shipCostDelta?: number;
  moduleCostDelta?: number;
  tacticCostDelta?: number;
  stationArmor?: number;
  auraAtk?: (state: GameState, self: ShipInstance, other: ShipInstance) => number;
  auraHp?: (state: GameState, self: ShipInstance, other: ShipInstance) => number;
}
