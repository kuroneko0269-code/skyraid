// 協力のレイドの PvpArena の部品（6-2。pvp-arena.ts から分けた）: スタン中の操作、怪獣の部位のロックの見直しと
// ミサイルの範囲ダメージ。6-6: ロック中の部位の番号・レイドの復帰。Three.js 非依存
import type { MissileSpec } from '../data/weapons';
import { splashDamage, type Detonation } from './missile';
import { nearestPerGroup, type CombatTarget } from './target';
import { PvpFighter, RewoundTarget } from './pvp-fighter';
import { KaijuPart } from '../entities/kaiju-part';
import { farthestSpawn } from './pvp-spawn';
import { isRookie } from './pvp-rules';
import { PVP_SPAWN_POINTS } from '../data/pvp';
import type { PvpControls } from './arena-types';
import { DEFENSE_ID_BASE, KAIJU_ID_BASE, NOBODY, RESPAWN_BOOST } from './arena-types';
import { PVP_CONFIG } from '../data/pvp';
import { headingQuat } from '../entities/enemy-aircraft';
import type { Quat } from '../flight/math';
import { inCone } from './targeting';
import type { Vec3 } from '../flight/math';

/** ミサイルの信管・誘導の対象: 機体か怪獣の部位か防衛戦の敵（7-2） */
export type ArenaFuseTarget = PvpFighter | KaijuPart | CombatTarget;

/** スタン中の操作（操縦・射撃なし。オートレベルと反転の設定はそのまま） */
export const NEUTRAL = { pitch: 0, roll: 0, yaw: 0, throttle: 0, afterburner: false };

/** ミサイルの発射で、ロックした部位が円錐（+ 余裕）の中か見直す。外れていれば null（無誘導） */
export function lockablePart(
  part: KaijuPart,
  from: Readonly<Vec3>,
  forward: Readonly<Vec3>,
  range: number,
  coneDeg: number,
): KaijuPart | null {
  return part.active && inCone(from, forward, part.position, range, coneDeg) ? part : null;
}

/** 爆心から半径以内の部位のうち、最も近い 1 つに撃った人の ID 付きで範囲ダメージ */
export function splashKaijuParts(
  parts: readonly KaijuPart[],
  d: Readonly<Detonation<unknown>>,
  spec: MissileSpec,
): void {
  if (parts.length === 0) return;
  const list: KaijuPart[] = [];
  const dist: number[] = [];
  for (const p of parts) {
    if (!p.active) continue;
    const q = p.position;
    const r = Math.hypot(q.x - d.x, q.y - d.y, q.z - d.z) - p.hitRadius;
    if (r >= spec.blastRadius) continue;
    list.push(p);
    dist.push(r);
  }
  for (const p of nearestPerGroup(list, dist, [])) {
    p.damageBy(splashDamage(spec, dist[list.indexOf(p)] ?? 0), d.owner);
  }
}

/** 防衛戦の敵（7-2）: 爆心から半径以内のすべてに、撃った人の ID 付きで範囲ダメージ */
export function splashExtras(
  list: readonly CombatTarget[],
  d: Readonly<Detonation<unknown>>,
  spec: MissileSpec,
  onDamage: (shooter: number, target: CombatTarget, amount: number) => void,
): void {
  for (const t of list) {
    if (!t.active) continue;
    const q = t.position;
    const r = Math.hypot(q.x - d.x, q.y - d.y, q.z - d.z) - t.hitRadius;
    if (r >= spec.blastRadius) continue;
    const amount = splashDamage(spec, r);
    if (amount > 0) onDamage(d.owner, t, amount);
  }
}

/** ロックしている部位の番号（6-6。ロックしていない・部位でなければ -1） */
export function lockedPartIndex(
  parts: readonly KaijuPart[],
  locked: boolean,
  index: number,
): number {
  return locked && parts[index] ? index : -1;
}

/** レイドの復帰（6-6）: 開始位置へ置いて 3 秒無敵（初心者保護はなし）。置いた位置を返す */
export function raidRespawn<P extends Readonly<Vec3 & { headingDeg: number }>>(
  f: PvpFighter,
  p: P,
  orientation: Quat,
): P {
  f.aircraft.respawn(p, headingQuat(orientation, p.headingDeg));
  f.revive(PVP_CONFIG.invulnerableSeconds, false);
  return p;
}

/**
 * ミサイルの目標の見直し（pvp-arena.ts から分けた）: 怪獣の部位（6-2）・防衛戦の敵（7-2）は巻き戻さずに、他機は巻き戻した位置で
 * ロックの円錐（+ 余裕）の中か見る。外れていれば null（無誘導）
 */
export function lockTargetOf(
  f: PvpFighter,
  c: Readonly<PvpControls>,
  fwd: Readonly<Vec3>,
  parts: readonly KaijuPart[],
  extras: readonly CombatTarget[],
): ArenaFuseTarget | null {
  if (!c.locked) return null;
  const s = f.spec.targeting;
  const cone = s.lockConeDeg + PVP_CONFIG.lockConeToleranceDeg;
  const part = parts[c.targetId - KAIJU_ID_BASE];
  if (part) return lockablePart(part, f.position, fwd, s.lockRange, cone);
  const extra = extras[c.targetId - DEFENSE_ID_BASE];
  if (extra)
    return extra.active && inCone(f.position, fwd, extra.position, s.lockRange, cone)
      ? extra
      : null;
  const o = f.others.find((r) => r.fighter.id === c.targetId);
  if (!o?.fighter.alive) return null;
  return inCone(f.position, fwd, o.position, s.lockRange, cone) ? o.fighter : null;
}

/** 機銃・信管の対象を作り直す（pvp-arena.ts から分けた）: 他機（味方を除く）・怪獣の部位・防衛戦の敵 */
export function rebuildTargets(
  fighters: ReadonlyMap<number, PvpFighter>,
  list: PvpFighter[],
  parts: readonly KaijuPart[],
  extras: readonly CombatTarget[],
  fuseList: ArenaFuseTarget[],
  sameSide: (a: number, b: number) => boolean,
): void {
  list.length = 0;
  for (const f of fighters.values()) list.push(f);
  for (const f of list) {
    f.others.length = 0;
    for (const o of list) if (!sameSide(f.id, o.id)) f.others.push(new RewoundTarget(o));
    f.gunTargets.splice(0, f.gunTargets.length, ...f.others, ...parts, ...extras);
  }
  fuseList.splice(0, fuseList.length, ...list, ...parts, ...extras);
}

/** 起爆の event の b（当たった相手の ID。7-2 で防衛戦の敵を足した） */
export function hitIdOf(t: ArenaFuseTarget | null, extras: readonly CombatTarget[]): number {
  if (t instanceof PvpFighter) return t.id;
  if (t instanceof KaijuPart) return KAIJU_ID_BASE + t.index;
  return t ? DEFENSE_ID_BASE + extras.indexOf(t) : NOBODY;
}

/**
 * 復帰（pvp-arena.ts から分けた）: respawnPoint があれば（レイド・防衛戦）その位置へ（b = 0）、なければ PvP の輪の中で
 * 他機から最も遠い所へ（b = 出現位置の番号 + 初心者保護の印）。send に b と位置を渡す
 */
export function respawnFighter(
  f: PvpFighter,
  arena: {
    readonly all: readonly PvpFighter[];
    readonly respawnPoint: ((id: number) => Readonly<Vec3 & { headingDeg: number }>) | null;
    readonly rookieGuard: boolean;
  },
  orientation: Quat,
  send: (b: number, p: Readonly<Vec3>) => void,
): void {
  const { all: list, respawnPoint, rookieGuard } = arena;
  if (respawnPoint) {
    send(0, raidRespawn(f, respawnPoint(f.id), orientation));
    return;
  }
  const i = farthestSpawn(list, f.id);
  const s = PVP_SPAWN_POINTS[i] ?? PVP_SPAWN_POINTS[0];
  if (!s) return;
  f.aircraft.respawn(s, headingQuat(orientation, s.headingDeg));
  const boost = rookieGuard && isRookie(f.id, list);
  f.revive(PVP_CONFIG.invulnerableSeconds, boost);
  send(i | (boost ? RESPAWN_BOOST : 0), s);
}
