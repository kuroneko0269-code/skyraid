// 10-3c: 白鯨アルビオンの攻撃の段の進め方（albion-ai.ts から分けた。Three.js 非依存・決まった計算）: 何もしない → 予兆 → 攻撃 →
// 硬直・吠える。人を狙う攻撃は予兆に入るときの狙い（水柱の進む先・横転の側・呼び声に応える子分）・攻撃に入るとき（歌の輪の
// 中心・呼び声の突撃の向き）・当たり（水柱・横転は狙う人、歌は輪が通った全員。呼び声は子分の体当たり）・横転の傾き・
// 見た目の姿勢（予兆・攻撃の段から）
import { ALBION_CONFIG as C, type AlbionAttack } from '../data/albion';
import type { AlbionHit, AlbionKaiju, AlbionTarget } from './albion-ai';
import { bodyLocal, geyserAimOf, inGeyser, inRoll, sonarPassed } from './albion-aimed';
import { attackTimes, chooseAttack, inSlam, inSpout, slamRadius } from './albion-attacks';
import { beginCharge, markCallers } from './albion-minions';

/** 10-3c: 横転の傾き（予兆は人の反対へ傾いて胸びれを上げ、攻撃で人の側へ横転、硬直で戻す）。写しも同じ式 */
export function applyRoll(k: AlbionKaiju): void {
  const b = k.body;
  const R = C.attacks.roll;
  const DEG = Math.PI / 180;
  if (k.attack !== 'roll' || k.action === 'idle' || k.action === 'roar') {
    b.rollOn = false;
    return;
  }
  b.rollOn = true;
  if (k.action === 'windup') {
    b.rollBank = k.rollSide * R.windupBankDeg * DEG;
    b.rollRate = 40 * DEG;
  } else if (k.action === 'active') {
    b.rollBank = k.rollSide * R.bankDeg * DEG;
    b.rollRate = R.bankRate * DEG;
  } else {
    b.rollBank = b.turning ? C.route.bankDeg * DEG : 0;
    b.rollRate = 50 * DEG;
  }
}

/** 10-3c: 予兆に入るときに狙いを決める（水柱の進む先・横転の側・呼び声に応える子分） */
export function beginWindup(k: AlbionKaiju, a: AlbionAttack, target: AlbionTarget): void {
  const p = target.active ? target.position : null;
  if (!p) return;
  if (a === 'geyser') geyserAimOf(p, target.velocity, k.body, k);
  else if (a === 'roll') k.rollSide = bodyLocal(k.body, p).side >= 0 ? 1 : -1;
  else if (a === 'call') markCallers(k, p);
}

/** 10-3c: 攻撃に入るとき（歌の輪の中心・子分の突撃の向き。構えの始めに決め、構えの間はその向きで止まってから突っ込む） */
export function beginActive(k: AlbionKaiju, a: AlbionAttack, target: AlbionTarget): void {
  if (a === 'sonar') {
    const b = k.body.position;
    k.sonarX = b.x;
    k.sonarY = b.y - k.body.pose.sink;
    k.sonarZ = b.z;
  } else if (a === 'call') beginCharge(k, target);
}

/** 10-3c: 人を狙う攻撃の当たり（水柱・横転は狙う人、歌は輪が通った全員） */
export function aimedHit(
  k: AlbionKaiju,
  a: AlbionAttack,
  dt: number,
  target: AlbionTarget,
  onHit: AlbionHit,
  crowd: readonly AlbionTarget[],
): void {
  const A = C.attacks;
  if (a === 'call') return;
  if (a === 'sonar') {
    crowd.forEach((who, i) => {
      const bit = 1 << Math.min(30, i);
      if (!who.active || (k.hitMask & bit) !== 0) return;
      if (!sonarPassed(k, k.actionTime, dt, who.position)) return;
      k.hitMask |= bit;
      if (who === target) k.hitsOnPlayer++;
      onHit('sonar', A.sonar.damage * k.damageScale, who);
    });
    return;
  }
  if (k.hitDone || !target.active) return;
  const p = target.position;
  const hit =
    a === 'geyser'
      ? inGeyser(k.body, k, k.actionTime, p)
      : a === 'roll' && inRoll(k.body, k.rollSide, p);
  if (!hit) return;
  k.hitDone = true;
  k.hitsOnPlayer++;
  onHit(a, (a === 'geyser' ? A.geyser.damage : A.roll.damage) * k.damageScale, target);
}

/** 10-3c の狙いと数えを戻す（出すとき） */
export function resetAimed(k: AlbionKaiju): void {
  for (const key of Object.keys(k.attacksUsed) as AlbionAttack[]) k.attacksUsed[key] = 0;
  k.aimX = 0;
  k.aimZ = 0;
  k.aimAngle = 0;
  k.sonarX = 0;
  k.sonarY = 0;
  k.sonarZ = 0;
  k.hitMask = 0;
  k.rollSide = 1;
  k.callMask = 0;
}

/** 見た目の姿勢（予兆・攻撃の段から。固定ステップで寄せる） */
export function stepAlbionPose(k: AlbionKaiju, dt: number): void {
  const pose = k.body.pose;
  const a = k.attack;
  const act = k.action;
  const toward = (v: number, want: number, rate: number): number =>
    v + Math.max(-rate * dt, Math.min(rate * dt, want - v));
  const spoutOn = a === 'spout' && (act === 'windup' || act === 'active');
  pose.spoutSwell = toward(pose.spoutSwell, spoutOn ? 1 : 0, 1.2);
  pose.sink = toward(pose.sink, a === 'spout' && act === 'windup' ? C.attacks.spout.sink : 0, 12);
  let lift = 0;
  if (a === 'slam' && act === 'windup') lift = 1;
  else if (a === 'slam' && act === 'active') lift = -1;
  pose.tailLift = toward(pose.tailLift, lift, act === 'active' ? 6 : 0.9);
  pose.mist = toward(pose.mist, a === 'cloud' && act === 'windup' ? 1 : 0, 0.6);
  // 10-3c: 呼び声の予兆・歌の予兆と攻撃も口を開ける
  const mouthOpen =
    act === 'roar' ||
    ((a === 'cloud' || a === 'call') && act === 'windup') ||
    (a === 'sonar' && (act === 'windup' || act === 'active'));
  pose.mouth = toward(pose.mouth, mouthOpen ? 1 : 0, 1.5);
}

/** 攻撃の段を 1 ステップ進める（選ぶ・予兆・攻撃と当たり・硬直・吠える） */
export function stepAlbionAction(
  k: AlbionKaiju,
  dt: number,
  target: AlbionTarget,
  onHit: AlbionHit,
  crowd: readonly AlbionTarget[],
): void {
  k.actionTime += dt;
  const t = k.actionTime;
  const a = k.attack;
  const p = target.active ? target.position : null;
  switch (k.action) {
    case 'idle': {
      k.cooldown -= dt;
      if (k.cooldown > 0) return;
      const pick = chooseAttack(k, p, k.random.next);
      if (!pick) {
        k.cooldown = 1;
        return;
      }
      k.repeat = pick === k.lastAttack ? k.repeat + 1 : 1;
      k.lastAttack = pick;
      k.attacksUsed[pick]++;
      k.setAction('windup', pick);
      beginWindup(k, pick, target);
      return;
    }
    case 'roar':
      if (t >= C.phases.roarSeconds) {
        k.setAction('idle', null);
        k.cooldown = Math.min(k.cooldown, 2);
      }
      return;
    case 'windup':
      if (!a) return;
      // 予兆の間に部位が壊れて使えなくなったら取り消す
      if (k.disabled(a)) {
        k.setAction('idle', null);
        k.cooldown = 2;
        return;
      }
      if (t >= attackTimes(a).windup) {
        if (a === 'cloud') {
          k.cloudLeft = C.attacks.cloud.seconds;
          k.setAction('recover', a);
        } else {
          k.setAction('active', a);
          beginActive(k, a, target);
        }
      }
      return;
    case 'active':
      if (!a) return;
      if (a !== 'spout' && a !== 'slam') {
        aimedHit(k, a, dt, target, onHit, crowd);
        if (t >= attackTimes(a).active) k.setAction('recover', a);
        return;
      }
      if (!k.hitDone && p) {
        const hit = a === 'spout' ? inSpout(k.body, k.phase, p) : inSlam(k.body, slamRadius(k), p);
        if (hit) {
          k.hitDone = true;
          k.hitsOnPlayer++;
          const base = a === 'spout' ? C.attacks.spout.damage : C.attacks.slam.damage;
          onHit(a, base * k.damageScale, target);
        }
      }
      if (t >= attackTimes(a).active) k.setAction('recover', a);
      return;
    case 'recover':
      if (!a) return;
      if (t >= attackTimes(a).recover) {
        let cd = C.attackInterval * (C.phases.interval[k.phaseIndex] ?? 1) * k.intervalScale;
        if (a === 'spout' && k.nestsGone) cd *= C.attacks.spout.nestsGoneInterval;
        k.setAction('idle', null);
        k.cooldown = cd;
      }
      return;
  }
}
