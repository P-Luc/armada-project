import type { DragEvent, ReactNode } from 'react';
import {
  effAtk,
  effHp,
  getCost,
  isJammed,
  isSick,
  isStealthed,
  stationArmor,
} from '../core/game';
import { getDef } from '../core/cards';
import type {
  GameState,
  ModuleInstance,
  PlayerId,
  ShipInstance,
} from '../core/types';

export const CLASS_LABEL: Record<string, string> = {
  chasseur: 'Chasseur',
  intercepteur: 'Intercepteur',
  corvette: 'Corvette',
  croiseur: 'Croiseur',
  capital: 'Capital',
  soutien: 'Soutien',
};

export function typeLabel(defId: string): string {
  const d = getDef(defId);
  if (d.type === 'generateur') return 'Générateur';
  if (d.type === 'module') return 'Module de station';
  if (d.type === 'tactique') return 'Tactique';
  return `Vaisseau · ${CLASS_LABEL[d.shipClass ?? '']}`;
}

// ---------------------------------------------------------------------------

export function HandCard(props: {
  g: GameState;
  pid: PlayerId;
  defId: string;
  index: number;
  count: number;
  playable: boolean;
  selected: boolean;
  onClick: () => void;
  onDragStart: (e: DragEvent) => void;
  onZoom?: (defId: string) => void;
}) {
  const { g, pid, defId, index, count } = props;
  const d = getDef(defId);
  const cost = d.type === 'generateur' ? null : getCost(g, pid, defId);
  return (
    <button
      className={[
        'card',
        `f-${d.faction}`,
        props.playable ? 'playable' : 'locked',
        props.selected ? 'selected' : '',
      ].join(' ')}
      style={{ ['--i' as string]: index, ['--n' as string]: count }}
      draggable
      onDragStart={props.onDragStart}
      onClick={props.onClick}
      onContextMenu={
        props.onZoom
          ? (e) => {
              e.preventDefault();
              props.onZoom!(defId);
            }
          : undefined
      }
      title={d.text || d.name}
    >
      <span className="card-head">
        <span className={cost === null ? 'cost cost-gen' : 'cost'}>
          {cost === null ? '⌬' : cost}
        </span>
        <span className="card-name">{d.name}</span>
      </span>
      <span className="card-type">
        {typeLabel(defId)}
        <i className={`rar rar-${d.rarity}`} />
      </span>
      <span className="card-text">{d.text}</span>
      {d.type === 'vaisseau' && (
        <span className="card-stats">
          <b className="atk">{d.atk}</b>
          <b className="hp">{d.hp}</b>
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------

export function ShipToken(props: {
  g: GameState;
  ship: ShipInstance;
  mine: boolean;
  selected: boolean;
  canAct: boolean;
  highlighted: boolean;
  onClick: () => void;
  onDragStart?: (e: DragEvent) => void;
  onDropTarget?: (e: DragEvent) => void;
  onZoom?: (defId: string) => void;
}) {
  const { g, ship, mine } = props;
  const d = getDef(ship.defId);
  const hp = effHp(g, ship) - ship.damage;
  const badges: string[] = [];
  if (d.escorte) badges.push('Escorte');
  if (isStealthed(ship)) badges.push('Furtif');
  if (ship.tempFurtif) badges.push('Furtif ∗');
  if ((d.armor ?? 0) > 0) badges.push(`Blindage ${d.armor}`);
  if (d.mustAttack) badges.push('Bélier');
  if (ship.guarding) badges.push('⛨ Garde');
  if (isJammed(g, ship)) badges.push('Brouillé');
  if (isSick(g, ship)) badges.push('Mal de saut');
  else if (mine && ship.attacksUsed > 0) badges.push('Épuisé');
  return (
    <button
      className={[
        'ship',
        `f-${d.faction}`,
        mine ? 'mine' : 'enemy',
        props.selected ? 'selected' : '',
        props.canAct ? 'can-act' : '',
        props.highlighted ? 'highlighted' : '',
        ship.guarding ? 'guarding' : '',
        mine && !props.canAct && !ship.guarding ? 'spent' : '',
      ].join(' ')}
      onClick={props.onClick}
      draggable={!!props.onDragStart}
      onDragStart={props.onDragStart}
      onDragOver={props.onDropTarget ? (e) => e.preventDefault() : undefined}
      onDrop={props.onDropTarget}
      onContextMenu={
        props.onZoom
          ? (e) => {
              e.preventDefault();
              props.onZoom!(ship.defId);
            }
          : undefined
      }
      title={d.text || d.name}
    >
      <span className="ship-name">{d.name}</span>
      <span className="ship-class">{CLASS_LABEL[d.shipClass ?? '']}</span>
      <span className="ship-stats">
        <b className="atk">{effAtk(g, ship)}</b>
        <b className={hp < effHp(g, ship) ? 'hp hurt' : 'hp'}>{hp}</b>
      </span>
      {badges.length > 0 && (
        <span className="ship-badges">
          {badges.map((b) => (
            <i key={b}>{b}</i>
          ))}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------

export function StationPanel(props: {
  g: GameState;
  pid: PlayerId;
  label: string;
  accent: 'federation' | 'ceinture';
  highlighted: boolean;
  onClick: () => void;
  onDropTarget?: (e: DragEvent) => void;
}) {
  const { g, pid } = props;
  const p = g.players[pid];
  const armor = stationArmor(g, pid);
  const immune = g.turnCounter < p.stationImmuneUntil;
  const ratio = Math.max(0, p.stationHp) / p.stationMaxHp;
  return (
    <button
      className={[
        'station',
        `f-${props.accent}`,
        props.highlighted ? 'highlighted' : '',
        ratio <= 0.3 ? 'critical' : '',
      ].join(' ')}
      onClick={props.onClick}
      onDragOver={props.onDropTarget ? (e) => e.preventDefault() : undefined}
      onDrop={props.onDropTarget}
    >
      <span className="station-label">{props.label}</span>
      <span className="station-hp">
        <b>{Math.max(0, p.stationHp)}</b>
        <small>/ {p.stationMaxHp} PV</small>
        <span className="station-shield" title="Bouclier (absorbé avant la coque)">
          {Array.from({ length: p.shieldMax }, (_, i) => (
            <i key={i} className={i < p.shield ? 'on' : 'off'} />
          ))}
        </span>
      </span>
      <span className="station-gauge">
        <i style={{ width: `${ratio * 100}%` }} />
      </span>
      <span className="station-tags">
        {armor > 0 && <i>Blindage {armor}</i>}
        {immune && <i className="immune">Déflecteurs actifs</i>}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------

export function ModulePill(props: {
  m: ModuleInstance;
  highlighted: boolean;
  onClick: () => void;
  onDropTarget?: (e: DragEvent) => void;
  onZoom?: (defId: string) => void;
}) {
  const d = getDef(props.m.defId);
  return (
    <button
      className={`module ${props.highlighted ? 'highlighted' : ''}`}
      onClick={props.onClick}
      onDragOver={props.onDropTarget ? (e) => e.preventDefault() : undefined}
      onDrop={props.onDropTarget}
      onContextMenu={
        props.onZoom
          ? (e) => {
              e.preventDefault();
              props.onZoom!(props.m.defId);
            }
          : undefined
      }
      title={d.text}
    >
      ⬡ {d.name}
    </button>
  );
}

// ---------------------------------------------------------------------------

export function EnergyPips(props: { current: number; capacity: number }) {
  const n = Math.max(props.capacity, props.current);
  return (
    <span className="energy">
      <b>{props.current}</b>
      <span className="pips">
        {Array.from({ length: n }, (_, i) => (
          <i key={i} className={i < props.current ? 'on' : 'off'} />
        ))}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------

/** Gros plan d'une carte (clic droit). Cliquer n'importe où referme. */
export function CardZoom(props: { defId: string; onClose: () => void }) {
  const d = getDef(props.defId);
  const cost = d.type === 'generateur' ? null : d.cost ?? 0;
  return (
    <div className="zoom-overlay" onClick={props.onClose} onContextMenu={(e) => { e.preventDefault(); props.onClose(); }}>
      <div className={`card card-zoom f-${d.faction}`} onClick={(e) => e.stopPropagation()}>
        <span className="card-head">
          <span className={cost === null ? 'cost cost-gen' : 'cost'}>
            {cost === null ? '⌬' : cost}
          </span>
          <span className="card-name">{d.name}</span>
        </span>
        <span className="card-type">
          {typeLabel(props.defId)}
          <i className={`rar rar-${d.rarity}`} />
        </span>
        <span className="card-text">{d.text}</span>
        {d.type === 'vaisseau' && (
          <span className="card-stats">
            <b className="atk">{d.atk}</b>
            <b className="hp">{d.hp}</b>
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function Modal(props: { title: string; children: ReactNode }) {
  return (
    <div className="overlay">
      <div className="modal">
        <h2>{props.title}</h2>
        {props.children}
      </div>
    </div>
  );
}
