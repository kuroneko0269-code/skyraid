// 10-5b: UFO ゼノリスの光の弾のばらまき（xenolith-ai.ts から分けた）: 光線の間だけ interval 秒ごとに予兆（縁が白く光る）→ 扇に撃つ。
// 飛んでいる弾の当たり（光線の当たりと同じ口 onHit に 'orbs' で渡す）。決まった計算・Three.js 非依存
import { XENOLITH_CONFIG as C } from '../data/xenolith';
import { fireOrbs } from './xenolith-attacks';
import type { XenolithHit, XenolithKaiju, XenolithTarget } from './xenolith-ai';

const DEFAULT_RADIUS = 8;

/** 10-5b: 光の弾のばらまき（光線の間だけ。予兆の後に撃つ）と、飛んでいる弾の当たり */
export function stepOrbs(
  k: XenolithKaiju,
  dt: number,
  target: XenolithTarget,
  onHit: XenolithHit,
  crowd: readonly XenolithTarget[],
): void {
  const O = C.orbs;
  if (k.orbPhase === 'warn') {
    k.orbTime += dt;
    if (k.orbTime >= O.warn) {
      k.orbPhase = 'idle';
      k.orbTime = 0;
      if (target.active) {
        k.orbVolleys++;
        fireOrbs(k, target);
      }
    }
  } else if (k.orbsEnabled && target.active && !k.beam.busy && k.warp.phase !== 'telegraph') {
    k.orbTimer -= dt;
    const p = k.body.position;
    const q = target.position;
    const near = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) <= O.range;
    if (k.orbTimer <= 0 && k.cooldown > O.minCooldown && near) {
      k.orbPhase = 'warn';
      k.orbTime = 0;
      k.orbTimer = O.interval;
    } else if (k.orbTimer <= 0 && k.cooldown <= O.minCooldown) {
      // 光線の後へ回す（光線の硬直が終わってから少し空ける）
      k.orbTimer = O.interval * 0.5;
    }
  }
  // 当たる人（毎ステップの配列を作らない: 入れ物を使い回す）
  const victims = k.orbVictims;
  victims.length = 0;
  crowd.forEach((c, i) => {
    if (!c.active) return;
    victims.push({ id: i, position: c.position, radius: c.radius ?? DEFAULT_RADIUS });
  });
  k.orbs.step(
    dt,
    victims,
    () => null,
    (hit) => {
      const who = crowd[hit.targetId];
      if (!who) return;
      k.orbHits++;
      onHit('orbs', hit.damage * k.damageScale, who);
    },
  );
}
