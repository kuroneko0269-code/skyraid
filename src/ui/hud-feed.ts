// ゲームの状態から HUD に渡す 1 フレーム分の値を作る（毎フレーム同じオブジェクトに書き込む）
import { TEAM_PLAYER } from '../combat/target';
import { HUD_ASSIST_CONFIG } from '../data/assist';
import type { Aircraft, GroundHeightFn } from '../entities/aircraft';
import { inverseRotateVec3, vec3 } from '../flight/math';
import type { FlightSession } from '../missions/flight-session';
import { createAssistFrame, type HudAssistFrame } from './hud-assist';
import type { HudFrame } from './hud-frame';
import { createOrdnanceFrame } from './hud-ordnance';
import { createRadarFrame, type HudRadarFrame } from './hud-radar';
import { createWeaponsFrame } from './hud-weapons';

export function createHudFrame(aircraft: Aircraft): HudFrame {
  return {
    speed: 0,
    throttle: 0,
    afterburnerGauge: 0,
    afterburnerActive: false,
    afterburnerLocked: false,
    x: 0,
    y: 0,
    z: 0,
    altitudeAboveGround: 0,
    stall: 0,
    orientation: aircraft.state.orientation,
    flightPath: null,
    gunHeat: 0,
    gunOverheated: false,
    hitMarker: false,
    kills: 0,
    weapons: createWeaponsFrame(),
    hp: 0,
    maxHp: 1,
    missileWarning: false,
    radar: createRadarFrame(),
    ordnance: createOrdnanceFrame(),
    assist: createAssistFrame(),
  };
}

const DEG = 180 / Math.PI;
const local = vec3();

/**
 * 機体と射撃の状態を frame に書く。画面座標（進行方向マーカー flightPath、対象のマーカー・予測照準点）は
 * 呼び出し側で入れる（render/target-projection.ts）
 */
export function fillHudFrame(
  frame: HudFrame,
  ff: FlightSession,
  groundHeight: GroundHeightFn,
  /** 設定「HUD 補助」（4-12） */
  assist = false,
): void {
  const { aircraft, combat, player } = ff;
  const state = aircraft.state;
  const p = state.position;
  frame.speed = state.speed;
  frame.throttle = aircraft.throttle;
  frame.afterburnerGauge = state.afterburnerGauge;
  frame.afterburnerActive = state.afterburnerActive;
  frame.afterburnerLocked = state.afterburnerLocked;
  frame.x = p.x;
  frame.y = p.y;
  frame.z = p.z;
  frame.altitudeAboveGround = p.y - groundHeight(p.x, p.z);
  frame.stall = state.stall;
  frame.gunHeat = combat.gun.heat.value;
  frame.gunOverheated = combat.gun.heat.overheated;
  frame.hitMarker = combat.hitMarkerTimer > 0;
  frame.kills = combat.kills;
  const w = frame.weapons;
  w.missiles = combat.missileAmmo.count;
  w.flares = combat.flares.magazine.count;
  w.flareCooling = combat.flares.magazine.cooldown > 0;
  w.lockProgress = combat.targeting.lockProgress;
  w.locked = combat.targeting.locked;
  w.distance = combat.targeting.selectedDistance;
  frame.hp = player.hp;
  frame.maxHp = player.maxHp;
  frame.missileWarning = ff.incomingMissiles > 0;
  const o = frame.ordnance;
  o.rockets = combat.rockets.count;
  o.bombs = combat.bombs.count;
  o.aaaWarning = player.active && ff.props.aaa.warning;
  fillRadar(frame.radar, ff, assist);
  fillAssist(frame.assist, ff, assist, frame.radar);
}

/**
 * HUD 補助（4-12）: 選択中の対象への角度差（機体ローカルで、機首 -Z との角と、画面の上から時計回りの向き）と、
 * 接近 / 離脱（相対速度の視線方向の成分。しきい値の間では前の値のまま）。後方の敵機はレーダーの点から
 */
export function fillAssist(
  a: HudAssistFrame,
  ff: FlightSession,
  enabled: boolean,
  radar: Readonly<HudRadarFrame>,
): void {
  a.enabled = enabled;
  a.arrowShown = false;
  a.behind = false;
  const target = ff.combat.targeting.selected;
  if (!enabled || !ff.player.active) return;
  for (let i = 0; i < radar.count; i++) if (radar.contacts[i]?.behind) a.behind = true;
  if (!target) {
    a.closing = 'none';
    return;
  }
  const p = ff.aircraft.state.position;
  const t = target.position;
  local.x = t.x - p.x;
  local.y = t.y - p.y;
  local.z = t.z - p.z;
  const distance = Math.hypot(local.x, local.y, local.z);
  if (distance < 1e-6) return;
  const pv = ff.player.velocity;
  const tv = target.velocity;
  // 接近の速さ = −（相対速度 · 視線の単位ベクトル）
  const closure =
    -((tv.x - pv.x) * local.x + (tv.y - pv.y) * local.y + (tv.z - pv.z) * local.z) / distance;
  const c = HUD_ASSIST_CONFIG;
  if (closure > c.closureThreshold) a.closing = 'approach';
  else if (closure < -c.closureThreshold) a.closing = 'recede';
  else if (a.closing === 'none') a.closing = 'approach';
  inverseRotateVec3(local, ff.aircraft.state.orientation, local);
  a.distance = distance;
  a.angleDeg = Math.atan2(Math.hypot(local.x, local.y), -local.z) * DEG;
  a.arrowDeg = Math.atan2(local.x, local.y) * DEG;
  a.arrowShown = a.angleDeg >= c.minAngleDeg;
}

/**
 * レーダーの点: 出撃中の敵機と、自機を追っている敵のミサイル。assist（HUD 補助。4-12）なら敵機に
 * 高度差（±altitudeThreshold を超えたら上 / 下）と、後方（尾部から rearConeDeg・range 以内）の印を付ける
 */
export function fillRadar(r: HudRadarFrame, ff: FlightSession, assist = false): void {
  let n = 0;
  const max = r.contacts.length;
  r.assist = assist;
  const hc = HUD_ASSIST_CONFIG;
  const p = ff.aircraft.state.position;
  const q = ff.aircraft.state.orientation;
  const rearCos = Math.cos(hc.behind.rearConeDeg / DEG);
  for (const e of ff.enemies) {
    const c = r.contacts[n];
    if (!e.active || !c || n >= max) continue;
    c.x = e.position.x;
    c.z = e.position.z;
    c.kind = 'enemy';
    const dy = e.position.y - p.y;
    c.altitude = dy > hc.altitudeThreshold ? 'above' : dy < -hc.altitudeThreshold ? 'below' : '';
    c.behind = false;
    if (assist && ff.player.active) {
      local.x = e.position.x - p.x;
      local.y = dy;
      local.z = e.position.z - p.z;
      const d = Math.hypot(local.x, local.y, local.z);
      inverseRotateVec3(local, q, local);
      // 機体ローカルの後ろは +Z
      c.behind = d <= hc.behind.range && d > 0 && local.z / d >= rearCos;
    }
    n++;
  }
  const pool = ff.combat.missiles.missiles;
  for (let i = 0; i < pool.count && n < max; i++) {
    const m = pool.get(i);
    const c = r.contacts[n];
    if (!c || m.owner === TEAM_PLAYER || m.target !== ff.player) continue;
    c.x = m.position.x;
    c.z = m.position.z;
    c.kind = 'missile';
    c.altitude = '';
    c.behind = false;
    n++;
  }
  r.count = n;
}
