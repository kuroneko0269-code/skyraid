// 10-4a: メカ怪獣ゴウライの 1 ステップの続き（gourai-ai.ts から分けた）: 弾を進めて当てる（ミサイルはフレアに乗り換える）・
// 見た目の姿勢を段から寄せる。決まった計算・Three.js 非依存
import { findDecoy, type Flare } from '../combat/flare';
import type { Pool } from '../combat/pool';
import { GOURAI_CONFIG as C, GOURAI_TURRETS } from '../data/gourai';
import { attackTimes } from './gourai-attacks';
import type { GouraiHit, GouraiKaiju, GouraiTarget } from './gourai-ai';
import type { ShotVictim } from './raid-kit/shots';

const DECOY_OWNER = -3;
const DEFAULT_RADIUS = 8;
const DECOY_COS = Math.cos((C.decoy.deg * Math.PI) / 180);
/** 弾の当たる人の一覧（使い回す。状態の走査に入れないよう本体には持たない） */
const victimList: ShotVictim[] = [];

/** 弾を進める・当てる（当てた数・フレアに乗り換えたミサイルの数を数える） */
export function stepGouraiShots(
  k: GouraiKaiju,
  dt: number,
  crowd: readonly GouraiTarget[],
  flares: Pool<Flare> | null,
  onHit: GouraiHit,
): void {
  const victims = victimList;
  victims.length = 0;
  crowd.forEach((c, i) => {
    if (c.active)
      victims.push({ id: c.id ?? i, position: c.position, radius: c.radius ?? DEFAULT_RADIUS });
  });
  const byId = (id: number): GouraiTarget | undefined =>
    crowd.find((c, i) => (c.id ?? i) === id && c.active);
  k.shots.step(
    dt,
    victims,
    (id) => byId(id)?.position ?? null,
    (hit) => {
      const who = byId(hit.targetId);
      if (!who) return;
      k.hits[hit.shot.kind]++;
      onHit(hit.shot.kind, hit.damage * k.damageScale, who);
    },
    (from, dir) => {
      if (!flares) return null;
      const fl = findDecoy(from, dir, DECOY_OWNER, -1, flares, DECOY_COS, C.decoy.range);
      return fl ? fl.position : null;
    },
  );
  k.shots.shots.forEach((s, i) => {
    if (!s.active) k.decoyedSeen[i] = 0;
    else if (s.decoyed && k.decoyedSeen[i] === 0) {
      k.decoyedSeen[i] = 1;
      k.decoyed++;
    }
  });
}

/** 見た目の姿勢（段から。固定ステップで寄せる） */
export function stepGouraiPose(k: GouraiKaiju, dt: number): void {
  const pose = k.body.pose;
  const a = k.attack;
  const act = k.action;
  const toward = (v: number, want: number, rate: number): number =>
    v + Math.max(-rate * dt, Math.min(rate * dt, want - v));
  const busy = act === 'windup' || act === 'active';
  pose.armorOpen = toward(pose.armorOpen, act === 'vent' && k.phase === 1 ? 1 : 0, 1.6);
  pose.hatch = toward(pose.hatch, a === 'volley' && busy ? 1 : 0, 2);
  pose.gunGlow = toward(pose.gunGlow, a === 'sweep' && busy ? 1 : 0, 2.5);
  pose.exhaust = toward(pose.exhaust, act === 'vent' ? 1 : k.heat / C.heat.max, 1.5);
  pose.purge = toward(pose.purge, k.phase === 2 ? 1 : 0, 1 / C.phases.purgeSeconds);
  pose.spin = a === 'sweep' && act === 'active' ? k.sweepAngle : toward(pose.spin, 0, 90);
}

/** 出すときに状態を戻す（部位・砲台・弾・段・数え。体力の割合と壊れた部位で始める） */
export function resetGourai(k: GouraiKaiju, hpRatio: number, broken: readonly string[]): void {
  const p = k.parts;
  for (let i = 0; i < p.count; i++) p.partHp[i] = p.partMaxHp[i] ?? 0;
  p.brokenOrder.length = 0;
  for (const row of p.damageBy) row.fill(0);
  p.breaksBy.fill(0);
  for (const id of broken) {
    const i = p.indexOf(id);
    if (i >= 0 && p.specs[i]?.breakable) p.partHp[i] = 0;
  }
  p.hp = p.maxHp * Math.max(0.01, Math.min(1, hpRatio));
  const b = k.barrage;
  GOURAI_TURRETS.forEach((t, i) => {
    b.cooldown[i] = t.firstDelay;
    b.burstLeft[i] = 0;
    b.gapLeft[i] = 0;
    b.aimAt[i] = -1;
    b.fired[i] = 0;
  });
  k.shots.clear();
  k.shots.dropped = 0;
  k.action = 'idle';
  k.attack = null;
  k.actionTime = 0;
  k.cooldown = C.dev.firstAttackDelay;
  k.lastAttack = null;
  k.repeat = 0;
  k.phase = 1;
  k.heat = 0;
  k.sweepAngle = 0;
  k.sweepGap = 0;
  k.attacksUsed.volley = 0;
  k.attacksUsed.sweep = 0;
  k.vents = 0;
  k.fired.gun = 0;
  k.fired.missile = 0;
  k.hits.gun = 0;
  k.hits.missile = 0;
  k.decoyed = 0;
  k.decoyedSeen.fill(0);
  k.elapsed = 0;
}

/** 今の段の残り秒（値の表示） */
export function actionLeftOf(k: GouraiKaiju): number {
  const a = k.attack;
  if (k.action === 'purge') return Math.max(0, C.phases.purgeSeconds - k.actionTime);
  if (k.action === 'vent') {
    const total = k.phase === 2 ? C.heat.ventSecondsLate : C.heat.ventSeconds;
    return Math.max(0, total - k.actionTime);
  }
  if (!a || k.action === 'idle') return Math.max(0, k.cooldown);
  const tm = attackTimes(a);
  const total = k.action === 'windup' ? tm.windup : k.action === 'active' ? tm.active : tm.recover;
  return Math.max(0, total - k.actionTime);
}
